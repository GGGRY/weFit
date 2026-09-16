'use strict';
/* =====================================================
   鉴权层(零依赖:node:crypto + SQLite 持久会话)
   - 密码:scrypt(随机盐),存储格式 scrypt$<saltHex>$<hashHex>
   - 会话:随机 token → sessions 表,30 天有效,HttpOnly Cookie 下发
   - 进程重启会话不丢(存库,不落内存)
   ===================================================== */
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scryptAsync = promisify(crypto.scrypt);

const COOKIE_NAME = 'wefit_sid';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const SCRYPT_KEYLEN = 64;

/* v4.3：scrypt 改异步——同步版一次约 50-150ms，会卡死单线程事件循环
 * （所有用户的请求排队），注册路径此前还把它夹在 BEGIN IMMEDIATE 里持写锁跑完。
 * 存储格式不变（scrypt$盐$哈希），既有口令散列照常验证。 */
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(String(pw), salt, SCRYPT_KEYLEN);
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}

async function verifyPassword(pw, stored) {
  try {
    const [tag, saltHex, hashHex] = String(stored).split('$');
    if (tag !== 'scrypt' || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const want = Buffer.from(hashHex, 'hex');
    const got = await scryptAsync(String(pw), salt, want.length);
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

/* v4.21 公网部署：反代终止 TLS 时必须给会话 Cookie 加 Secure（否则明文链路也能带上会话
 * Cookie）。但**不能写死**——浏览器会直接丢弃明文 HTTP 上的 Secure Cookie，写死就等于
 * 本地 localhost / 手机局域网访问全部登不上。故由调用方按请求判定后传 opts.secure。
 * 登出下发的清除 Cookie 必须与下发时属性一致（含 Secure），否则浏览器可能删不掉会话。 */
function cookieHeader(token, opts) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return COOKIE_NAME + '=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + maxAge
    + (opts && opts.secure ? '; Secure' : '');
}
function clearCookieHeader(opts) {
  return COOKIE_NAME + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
    + (opts && opts.secure ? '; Secure' : '');
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

/* ---------- 登录失败限速（v4.21，公网部署必备）---------
 * 内存计数：进程重启即清零。可接受——攻击者无法预知/触发重启，而重启本身很罕见；
 * 上持久化反而要为每次失败写一次库（DoS 放大器）。
 * 两个维度，任一命中即拒：
 *   u:<ip>|<用户名>  同一来源对同一账户连续失败（默认 5 次 / 15 分钟）→ 挡住定向爆破
 *   i:<ip>           同一来源对任意账户失败总数（默认 20 次 / 15 分钟）→ 挡住扫号撞库
 * 命中后锁 blockMs（默认 15 分钟）；成功登录只清「本组合」的计数，**不清 IP 计数**
 * ——否则攻击者只要猜中任意一个弱口令就把整台 IP 的失败记录洗白。
 * now 可注入，便于测试直接验证窗口过期/解锁语义。 */
function numEnv(name, dflt) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}
const MAX_LIMITER_KEYS = 5000;
function createLoginLimiter(opts) {
  opts = opts || {};
  const windowMs = opts.windowMs || numEnv('LOGIN_WINDOW_MS', 15 * 60 * 1000);
  const blockMs = opts.blockMs || numEnv('LOGIN_BLOCK_MS', 15 * 60 * 1000);
  const maxPerUser = opts.maxPerUser || numEnv('LOGIN_MAX_FAILS', 5);
  const maxPerIP = opts.maxPerIP || numEnv('LOGIN_MAX_FAILS_IP', 20);
  const fails = new Map();   /* key → {n, first, until} */

  /* 过期条目惰性清理：只在集合膨胀时扫一遍，避免每请求全表遍历 */
  function prune(now) {
    if (fails.size <= MAX_LIMITER_KEYS) return;
    for (const [k, s] of fails) { if (s.until <= now && now - s.first > windowMs) fails.delete(k); }
    /* 仍超上限（大量互不相同的 key 在同一窗口内涌入）→ 按插入序淘汰最旧的。
     * 给表一个**硬上限**：宁可丢掉最老的封锁记录，也不能让限速器自己变成内存放大器。
     * 注：key 里的用户名已在 handleLogin 侧截断，此处只管条目数。 */
    while (fails.size > MAX_LIMITER_KEYS) fails.delete(fails.keys().next().value);
  }
  /* 取有效状态：窗口内、或仍在封锁期的保留；两者都过期则丢弃（重新计数） */
  function state(key, now) {
    const s = fails.get(key);
    if (!s) return null;
    if (s.until <= now && now - s.first > windowMs) { fails.delete(key); return null; }
    return s;
  }
  /* rules = [{key, max}]；返回 {retryAfter} 或 null */
  function check(rules, now) {
    now = now === undefined ? Date.now() : now;
    prune(now);
    let until = 0;
    for (const r of rules) {
      const s = state(r.key, now);
      if (s && s.until > now && s.until > until) until = s.until;
    }
    return until > now ? { retryAfter: Math.max(1, Math.ceil((until - now) / 1000)) } : null;
  }
  /* 记一次失败；返回本次「刚刚被锁」的 key 列表（供日志），空数组 = 还没触顶 */
  function fail(rules, now) {
    now = now === undefined ? Date.now() : now;
    const justBlocked = [];
    for (const r of rules) {
      let s = state(r.key, now);
      if (!s) { s = { n: 0, first: now, until: 0 }; fails.set(r.key, s); }
      s.n++;
      if (s.n >= r.max && s.until <= now) { s.until = now + blockMs; justBlocked.push(r.key); }
    }
    prune(now);
    return justBlocked;
  }
  function reset(key) { fails.delete(key); }
  function size() { return fails.size; }
  return { check, fail, reset, size, caps: { windowMs, blockMs, maxPerUser, maxPerIP, maxKeys: MAX_LIMITER_KEYS } };
}

/* 用户名/密码最低校验 */
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
  parseCookies, cookieHeader, clearCookieHeader, createLoginLimiter,
  createSession, getSessionUser, deleteSession, checkCredentials,
};
