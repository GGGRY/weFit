'use strict';
/* =====================================================
   鉴权层(零依赖:node:crypto + SQLite 持久会话)
   - 密码:scrypt(随机盐),存储格式 scrypt$<saltHex>$<hashHex>
   - 会话:随机 token → sessions 表,30 天有效,HttpOnly Cookie 下发
   - 进程重启会话不丢(存库,不落内存)
   ===================================================== */
const crypto = require('node:crypto');

const COOKIE_NAME = 'wefit_sid';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const SCRYPT_KEYLEN = 64;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, SCRYPT_KEYLEN);
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}

function verifyPassword(pw, stored) {
  try {
    const [tag, saltHex, hashHex] = String(stored).split('$');
    if (tag !== 'scrypt' || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const want = Buffer.from(hashHex, 'hex');
    const got = crypto.scryptSync(String(pw), salt, want.length);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  } catch (e) { return false; }
}

function newToken() { return crypto.randomBytes(32).toString('hex'); }

/* 与前端 uid() 同风格的短 id(Date36 + rand36),供服务端建档使用 */
function genId() { return Date.now().toString(36) + crypto.randomBytes(4).toString('hex'); }

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieHeader(token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return COOKIE_NAME + '=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + maxAge;
}
function clearCookieHeader() {
  return COOKIE_NAME + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
}

function createSession(db, username) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  const token = newToken();
  const now = Date.now();
  db.prepare('INSERT INTO sessions(token, username, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, username, now, now + SESSION_TTL_MS);
  return token;
}

/* token → {username, role, userId},无效/过期/账号已删 → null */
function getSessionUser(db, token) {
  if (!token) return null;
  const row = db.prepare(
    'SELECT s.username, s.expires_at, a.role, a.user_id FROM sessions s JOIN accounts a ON a.username = s.username WHERE s.token = ?'
  ).get(token);
  if (!row || row.expires_at < Date.now()) return null;
  return { username: row.username, role: row.role, userId: row.user_id };
}

function deleteSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/* 用户名/密码最低校验(局域网场景,不做失败限速——见 memo 技术债) */
const USERNAME_RE = /^[a-zA-Z0-9_-]{2,32}$/;
function checkCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return '用户名需为 2-32 位字母/数字/下划线/连字符';
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    return '密码需为 6-128 位';
  }
  return null;
}

module.exports = {
  COOKIE_NAME, hashPassword, verifyPassword, genId,
  parseCookies, cookieHeader, clearCookieHeader,
  createSession, getSessionUser, deleteSession, checkCredentials,
};
