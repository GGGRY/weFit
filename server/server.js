'use strict';
/* =====================================================
   健康管理 · 同步服务器（零 npm 依赖 · v4 账户鉴权版）
   node server.js  →  http://localhost:8123
   - 静态托管 ../public（页面 3 个文件，显式路径映射；登录页是前端的一部分，静态资源保持公开）
   - 鉴权中间件：除 login/register/health/静态文件外，/api/* 一律要求会话 Cookie
   - POST /api/register|/api/login：注册/登录（首个注册账户 = admin）
   - GET/PUT /api/state：本人数树读写（每用户 rev 乐观并发，写路径只触碰自己子树）
   - GET /api/system/library：读系统共享库；PUT：仅 admin
   - /api/admin/*（v4.1，仅 admin）：用户列表 / 设撤管理员 / 重置密码（踢会话）/ 删除账户（CASCADE 清数据）
   - GET /api/health：诊断
   手机与电脑登录同一账户 = 同一份数据，天然同步；不同账户彼此隔离。
   ===================================================== */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const dbm = require('./db');
const mapper = require('./mapper');
const auth = require('./auth');
const { copyLibrary, FOOD_NUM_KEYS, SEED_CATS, SEED_MUSCLES, SEED_MODES } = require('./seed');

const DEFAULT_PORT = Number(process.env.PORT || 8123);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY = 10 * 1024 * 1024;

const STATIC_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/css/style.css': { file: 'css/style.css', type: 'text/css; charset=utf-8' },
  '/js/seed-data.js': { file: 'js/seed-data.js', type: 'text/javascript; charset=utf-8' },
  '/js/seed-data.json': { file: 'js/seed-data.json', type: 'application/json; charset=utf-8' },
  /* 睡眠形状契约（v4.7）：与 server/mapper.js 共用同一份实现，故放在 public/js 下先行加载 */
  '/js/sleep-shape.js': { file: 'js/sleep-shape.js', type: 'text/javascript; charset=utf-8' },
  '/js/app.js': { file: 'js/app.js', type: 'text/javascript; charset=utf-8' },
  /* 管理后台(v4.1)：页面本身公开，数据面全部走 /api/admin/* 的 admin 守卫 */
  '/admin': { file: 'admin.html', type: 'text/html; charset=utf-8' },
  '/admin.html': { file: 'admin.html', type: 'text/html; charset=utf-8' },
};

function sendJson(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }, extraHeaders || {});
  res.writeHead(code, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
        const err = new Error('payload too large');
        err.code = 'PAYLOAD_TOO_LARGE';
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* 读 JSON body；PAYLOAD_TOO_LARGE → 413，坏 JSON/坏类型 → 4xx；失败时返回 null（已响应） */
async function readJson(req, res) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.includes('application/json')) { sendJson(res, 415, { error: 'json_required' }); return null; }
  let raw;
  try { raw = (await readBody(req)).toString('utf8'); }
  catch (e) {
    if (e && e.code === 'PAYLOAD_TOO_LARGE') { sendJson(res, 413, { error: 'payload_too_large' }); return null; }
    sendJson(res, 400, { error: 'read_failed' });
    return null;
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { sendJson(res, 400, { error: 'invalid_json' }); return null; }
  /* v4.3：合法 JSON 但非对象（null / false / 0 / "str"）此前会让各调用点
   * `if(!body) return;` 直接返回而从不响应 → 连接挂死。统一在此拒绝。 */
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    sendJson(res, 400, { error: 'invalid_json_body', hint: 'body 必须是 JSON 对象' });
    return null;
  }
  return parsed;
}

function serveStatic(res, key) {
  const entry = STATIC_FILES[key];
  const full = path.normalize(path.join(PUBLIC_DIR, entry.file));
  if (!full.startsWith(PUBLIC_DIR)) { sendJson(res, 403, { error: 'forbidden' }); return; }
  fs.readFile(full, (err, buf) => {
    if (err) { sendJson(res, 404, { error: 'not_found', path: key }); return; }
    res.writeHead(200, { 'Content-Type': entry.type, 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

/* ---------- 系统库读写 ---------- */
function readSystemLibrary(db) {
  const row = db.prepare('SELECT system_json FROM app WHERE id = 1').get();
  try {
    const j = JSON.parse(row && row.system_json);
    if (j && Array.isArray(j.foods) && Array.isArray(j.exercises)) return j;
  } catch (e) { /* fallthrough */ }
  return { foods: [], exercises: [] };
}

const LIB_MAX_ENTRIES = 5000;
function sanitizeLibrary(body) {
  if (!body || !Array.isArray(body.foods) || !Array.isArray(body.exercises)) return null;
  /* v4.3：旧版 slice(0,5000) 静默丢弃超限条目、admin 端收 200 还丢了草稿；改为显式报错 */
  if (body.foods.length > LIB_MAX_ENTRIES || body.exercises.length > LIB_MAX_ENTRIES) {
    return { error: 'library_too_large', max: LIB_MAX_ENTRIES };
  }
  const foods = [];
  for (const f of body.foods) {
    if (!f || typeof f.name !== 'string' || !f.name.trim()) return null;
    const o = { id: typeof f.id === 'string' && f.id ? f.id : auth.genId(), name: f.name.trim().slice(0, 80) };
    const per = {};
    if (f.per100 && typeof f.per100 === 'object') {
      FOOD_NUM_KEYS.forEach(k => { const n = Number(f.per100[k]); if (Number.isFinite(n) && n >= 0) per[k] = n; });   /* 负数营养值丢弃 */
    }
    if (Object.keys(per).length) o.per100 = per;
    /* 营养来源(src)：展示用自由文本（当前系统库全为 USDA，用户自录为「用户」），限长防灌库 */
    if (typeof f.src === 'string' && f.src.trim()) o.src = f.src.trim().slice(0, 24);
    foods.push(o);
  }
  const exercises = [];
  for (const e of body.exercises) {
    if (!e || typeof e.name !== 'string' || !e.name.trim()) return null;
    const o = { id: typeof e.id === 'string' && e.id ? e.id : auth.genId(), name: e.name.trim().slice(0, 80) };
    /* v4.11：cat/muscle/mode 三件套按 seed-data.js 的枚举白名单收（单一数据源）；
     * 非法取值静默丢弃该键——客户端有默认值兜底，不因一个脏字段 400 整库 */
    if (SEED_CATS.includes(e.cat)) o.cat = e.cat;
    if (SEED_MUSCLES.includes(e.muscle)) o.muscle = e.muscle;
    if (SEED_MODES.includes(e.mode)) o.mode = e.mode;
    exercises.push(o);
  }
  return { foods, exercises };
}

/* ---------- 鉴权端点 ---------- */
async function handleRegister(db, req, res) {
  const body = await readJson(req, res); if (!body) return;
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const name = String(body.name || '').trim().slice(0, 40);
  const bad = auth.checkCredentials(username, password);
  if (bad) { sendJson(res, 400, { error: 'invalid_credentials', message: bad }); return; }
  if (!name) { sendJson(res, 400, { error: 'invalid_credentials', message: '请填写昵称' }); return; }
  if (db.prepare('SELECT 1 FROM accounts WHERE username = ?').get(username)) {
    sendJson(res, 409, { error: 'username_taken' }); return;
  }
  const uid = auth.genId();
  const lib = copyLibrary(readSystemLibrary(db));
  const pwdHash = await auth.hashPassword(password);   /* v4.3：CPU 密集哈希在开写事务之前完成，不持锁跑 scrypt */
  let isFirst;
  try {
    db.exec('BEGIN IMMEDIATE');
    /* 首账户判定放进写事务内：BEGIN IMMEDIATE 串行化写者，杜绝并发首注册双 admin */
    isFirst = !db.prepare('SELECT 1 FROM accounts LIMIT 1').get();
    /* v4.4:事务内重查用户名——上方的预检与写事务之间隔着几十 ms 的 scrypt 异步哈希,
     * 并发同名注册此前只靠 accounts UNIQUE 主键兜底(走异常路径也能 409,但显式重查
     * 让败者在事务内干净收场,语义清晰) */
    if (db.prepare('SELECT 1 FROM accounts WHERE username = ?').get(username)) {
      db.exec('ROLLBACK');
      sendJson(res, 409, { error: 'username_taken' }); return;
    }
    mapper.createUser(db, uid, { name, library: lib });
    db.prepare('INSERT INTO accounts(username, user_id, pwd, role, created_at) VALUES (?,?,?,?,?)')
      .run(username, uid, pwdHash, isFirst ? 'admin' : 'user', Date.now());
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (e2) { /* ignore */ }
    if (/UNIQUE/i.test(String(e && e.message))) { sendJson(res, 409, { error: 'username_taken' }); return; }
    throw e;
  }
  const token = auth.createSession(db, username);
  sendJson(res, 201, { ok: true, username, role: isFirst ? 'admin' : 'user' },
    { 'Set-Cookie': auth.cookieHeader(token) });
}

async function handleLogin(db, req, res) {
  const body = await readJson(req, res); if (!body) return;
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const acc = db.prepare('SELECT pwd, role FROM accounts WHERE username = ?').get(username);
  if (!acc || !(await auth.verifyPassword(password, acc.pwd))) {   /* v4.3：异步 scrypt，不阻塞事件循环 */
    sendJson(res, 401, { error: 'bad_credentials' }); return;
  }
  const token = auth.createSession(db, username);
  sendJson(res, 200, { ok: true, username, role: acc.role },
    { 'Set-Cookie': auth.cookieHeader(token) });
}

/* ---------- 业务路由（命中并已响应 → 返回 undefined；未命中 → false） ---------- */
async function handleState(db, req, res, sessionUser, pathname) {
  if (req.method === 'GET' && pathname === '/api/state') {
    sendJson(res, 200, mapper.composeUser(db, sessionUser.userId));
    return;
  }
  if (req.method === 'PUT' && pathname === '/api/state') {
    const body = await readJson(req, res);
    if (!body) return;
    if (!mapper.isValidUserState(body.data)) {
      sendJson(res, 400, { error: 'invalid_state', hint: 'data 需包含本人 users 与 shared:{foods,exercises}' });
      return;
    }
    /* 数量级护栏（如单日睡眠段数上限）：命中就 400 说清是哪一天，不静默截断。
     * 形状脏值不在这里拒——mapper 的 normalizeSleepDay 清洗脏值 */
    const bad = mapper.validateUserData(body.data, sessionUser.userId);
    if (bad) {
      sendJson(res, 400, { error: bad.error, hint: '单日睡眠最多 ' + bad.max + ' 段（日期 ' + bad.date + '）' });
      return;
    }
    /* 只取本人那一份：树里其他用户的键一律忽略（A 永远写不到 B） */
    const result = mapper.replaceUser(db, sessionUser.userId, body.data, body.rev);
    if (!result.ok) {
      if (result.error === 'rev_conflict') { sendJson(res, 409, { error: 'rev_conflict', rev: result.rev }); return; }
      if (result.error === 'no_self') { sendJson(res, 400, { error: 'invalid_state', hint: '树中必须包含当前登录账户的成员档案' }); return; }
      sendJson(res, 401, { error: 'unauthorized' }); return;
    }
    sendJson(res, 200, { rev: result.rev });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/logout') {
    const cookies = auth.parseCookies(req);
    auth.deleteSession(db, cookies[auth.COOKIE_NAME]);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookieHeader() });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/me') {
    const u = db.prepare('SELECT id, name, avatar, color, onboarded FROM users WHERE id = ?').get(sessionUser.userId) || {};
    sendJson(res, 200, { ok: true, username: sessionUser.username, role: sessionUser.role, user: u });
    return;
  }
  return false;
}

/* ---------- 管理后台 API（v4.1：仅 admin；撤权即时生效——role 每请求现查） ---------- */
/* v4.3：角色守卫收敛——特权路由一律过 requireAdmin，杜绝逐处手抄两行检查的遗漏风险 */
function requireAdmin(res, sessionUser) {
  if (sessionUser.role === 'admin') return true;
  sendJson(res, 403, { error: 'admin_only' });
  return false;
}
async function handleAdmin(db, req, res, sessionUser, pathname) {
  if (!pathname.startsWith('/api/admin/')) return false;
  if (!requireAdmin(res, sessionUser)) return;

  const adminCount = () => db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role = 'admin'").get().n;
  const findAccount = username => db.prepare('SELECT a.username, a.role, a.user_id FROM accounts a WHERE a.username = ?').get(username);

  if (req.method === 'GET' && pathname === '/api/admin/users') {
    const rows = db.prepare(`
      SELECT a.username, a.role, a.created_at, u.name, u.rev,
             (SELECT COUNT(*) FROM body_records b WHERE b.user_id = u.id) AS body_n,
             (SELECT COUNT(DISTINCT wi.date) FROM workout_items wi WHERE wi.user_id = u.id AND wi.done = 1) AS wk_n,   /* v4.12：完成在项上，按「有打勾项的天数」计 */
             (SELECT COUNT(*) FROM meals m WHERE m.user_id = u.id) AS meal_n
      FROM accounts a JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at`).all();
    sendJson(res, 200, { users: rows.map(r => ({
      username: r.username, name: r.name, role: r.role, createdAt: r.created_at, rev: r.rev,
      counts: { body: r.body_n, workouts: r.wk_n, meals: r.meal_n },
    })) });
    return;
  }

  if (req.method === 'PUT' && pathname === '/api/admin/role') {
    const body = await readJson(req, res); if (!body) return;
    const username = String(body.username || '');
    const role = body.role;
    if (role !== 'admin' && role !== 'user') { sendJson(res, 400, { error: 'invalid_role' }); return; }
    const acc = findAccount(username);
    if (!acc) { sendJson(res, 404, { error: 'not_found', path: pathname }); return; }
    if (role === 'user' && acc.role === 'admin' && adminCount() <= 1) {
      sendJson(res, 400, { error: 'last_admin', message: '系统至少保留一名管理员' }); return;
    }
    db.prepare('UPDATE accounts SET role = ? WHERE username = ?').run(role, username);
    sendJson(res, 200, { ok: true, self: username === sessionUser.username, username, role });
    return;
  }

  if (req.method === 'PUT' && pathname === '/api/admin/password') {
    const body = await readJson(req, res); if (!body) return;
    const username = String(body.username || '');
    const password = String(body.password || '');
    const acc = findAccount(username);
    if (!acc) { sendJson(res, 404, { error: 'not_found', path: pathname }); return; }
    if (password.length < 6 || password.length > 128) {
      sendJson(res, 400, { error: 'invalid_password', message: '密码需为 6-128 位' }); return;
    }
    db.prepare('UPDATE accounts SET pwd = ? WHERE username = ?').run(await auth.hashPassword(password), username);
    db.prepare('DELETE FROM sessions WHERE username = ?').run(username);  /* 强制该账户全部会话下线 */
    sendJson(res, 200, { ok: true, kicked: true, self: username === sessionUser.username });
    return;
  }

  if (req.method === 'DELETE' && pathname === '/api/admin/users') {
    const body = await readJson(req, res); if (!body) return;
    const username = String(body.username || '');
    const acc = findAccount(username);
    if (!acc) { sendJson(res, 404, { error: 'not_found', path: pathname }); return; }
    if (username === sessionUser.username) { sendJson(res, 400, { error: 'cannot_delete_self' }); return; }
    if (acc.role === 'admin' && adminCount() <= 1) {
      sendJson(res, 400, { error: 'last_admin', message: '不能删除最后一名管理员' }); return;
    }
    try {
      db.exec('BEGIN IMMEDIATE');
      db.prepare('DELETE FROM sessions WHERE username = ?').run(username);
      /* 删 users 行:accounts(FK→users CASCADE)与其下 12 张子表一并级联清空 */
      db.prepare('DELETE FROM users WHERE id = ?').run(acc.user_id);
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (e2) { /* ignore */ }
      throw e;
    }
    sendJson(res, 200, { ok: true, username });
    return;
  }

  return false;
}

async function handleSystemLibrary(db, req, res, sessionUser, pathname) {
  if (req.method === 'GET' && pathname === '/api/system/library') {
    sendJson(res, 200, readSystemLibrary(db));
    return;
  }
  if (req.method === 'PUT' && pathname === '/api/system/library') {
    if (!requireAdmin(res, sessionUser)) return;
    const body = await readJson(req, res);
    if (!body) return;
    const lib = sanitizeLibrary(body);
    /* v4.3：超限不再静默 slice 截断（admin 以为全量保存、草稿还被丢弃），显式 400 */
    if (lib && lib.error === 'library_too_large') { sendJson(res, 400, { error: lib.error, message: '食物与动作各限 ' + lib.max + ' 条，请精简后再保存' }); return; }
    if (!lib) { sendJson(res, 400, { error: 'invalid_library', hint: '需 {foods:[{name,per100}], exercises:[{name,muscle}]}' }); return; }
    db.prepare('UPDATE app SET system_json = ? WHERE id = 1').run(JSON.stringify(lib));
    sendJson(res, 200, { ok: true });
    return;
  }
  return false;
}

async function handle(db, req, res) {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch { sendJson(res, 400, { error: 'bad_url' }); return; }

  try {
    /* ---- 公开端点 ---- */
    if (req.method === 'GET' && pathname === '/api/health') {
      const accounts = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
      sendJson(res, 200, { ok: true, accounts, auth: true });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/register') { await handleRegister(db, req, res); return; }
    if (req.method === 'POST' && pathname === '/api/login') { await handleLogin(db, req, res); return; }
    if ((req.method === 'GET' || req.method === 'HEAD') && STATIC_FILES[pathname]) { serveStatic(res, pathname); return; }

    /* ---- 鉴权中间件：其余 /api/* 必须登录 ---- */
    if (pathname.startsWith('/api/')) {
      const cookies = auth.parseCookies(req);
      const sessionUser = auth.getSessionUser(db, cookies[auth.COOKIE_NAME]);
      if (!sessionUser) { sendJson(res, 401, { error: 'unauthorized' }); return; }
      if (await handleState(db, req, res, sessionUser, pathname) !== false) return;
      if (await handleSystemLibrary(db, req, res, sessionUser, pathname) !== false) return;
      if (await handleAdmin(db, req, res, sessionUser, pathname) !== false) return;
      sendJson(res, 404, { error: 'not_found', path: pathname });
      return;
    }
    sendJson(res, 404, { error: 'not_found', path: pathname });
  } catch (e) {
    console.error('[server] 处理失败:', e && e.message);
    sendJson(res, 500, { error: 'internal', message: String((e && e.message) || e) });
  }
}

function lanIPs() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, ip: a.address });
    }
  }
  return out;
}

function start(opts) {
  opts = opts || {};
  const db = dbm.open(opts.dbPath);
  const server = http.createServer((req, res) => handle(db, req, res));
  const port = opts.port !== undefined ? opts.port : DEFAULT_PORT;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, opts.host || HOST, () => {
      const actual = server.address().port;
      if (!opts.quiet) {
        const n = db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
        console.log('💪 健康管理 · 同步服务器已启动');
        console.log('   本机访问   http://localhost:' + actual);
        for (const { ip } of lanIPs()) console.log('   手机/同网   http://' + ip + ':' + actual);
        console.log('   数据库     ' + (opts.dbPath || process.env.DB_PATH || dbm.DEFAULT_DB));
        console.log('   账户       ' + (n === 0 ? '尚无任何账户 — 打开网页注册第一个账户（自动成为管理员）' : '已注册 ' + n + ' 个账户'));
        console.log('   保持本窗口开启；Ctrl+C 或关闭窗口即停止服务');
      }
      resolve({ server, port: actual, db });
    });
  });
}

if (require.main === module) {
  start().catch(e => {
    if (e && e.code === 'EADDRINUSE') {
      console.error('端口 ' + DEFAULT_PORT + ' 已被占用：可能已有一个服务器在跑（直接用浏览器访问即可），或改端口：PORT=8124 node server.js');
    } else {
      console.error(e);
    }
    process.exit(1);
  });
}

module.exports = { start };
