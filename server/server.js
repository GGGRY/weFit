'use strict';
/* =====================================================
   健康管理 · 同步服务器（零 npm 依赖 · v4 账户鉴权版）
   node server.js  →  http://localhost:8123
   - 静态托管 ../public（页面 3 个文件，显式路径映射；登录页是前端的一部分，静态资源保持公开）
   - 鉴权中间件：除 login/register/health/静态文件外，/api/* 一律要求会话 Cookie
   - POST /api/register|/api/login：注册/登录（首个注册账户 = admin）
   - GET/PUT /api/state：本人数树读写（每用户 rev 乐观并发，写路径只触碰自己子树）
   - GET/PUT /api/slices：按片同步（v4.20；写只写脏片、CAS 按片、冲突只冲突同片）
   - GET /api/system/library：读系统共享库；PUT：仅 admin
   - /api/admin/*（v4.1，仅 admin）：用户列表 / 设撤管理员 / 重置密码（踢会话）/ 删除账户（CASCADE 清数据）
   - GET /api/health：诊断
   手机与电脑登录同一账户 = 同一份数据，天然同步；不同账户彼此隔离。
   ===================================================== */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const dbm = require('./db');
const mapper = require('./mapper');
const auth = require('./auth');
const { FOOD_NUM_KEYS, SEED_CATS, SEED_MUSCLES, SEED_MODES } = require('./seed');

const DEFAULT_PORT = Number(process.env.PORT || 8123);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY = 10 * 1024 * 1024;

/* ---------- 反向代理 / HTTPS 判定（v4.21 公网部署）----------
 * 反代（Caddy/nginx）终止 TLS 后转发到本进程，本进程看到的永远是明文 HTTP，
 * 所以「本请求是否 HTTPS」只能靠 COOKIE_SECURE 配置或 X-Forwarded-Proto。
 * 优先级：COOKIE_SECURE=1/0 显式强制 > auto（TRUST_PROXY=1 且 X-Forwarded-Proto=https）。
 * 默认 auto 且不信任代理头 = 不加 Secure，保住本地 localhost / 局域网明文可用
 * （浏览器会丢弃明文 HTTP 上的 Secure Cookie，无条件加 Secure 等于本地登不上）。
 * ⚠ X-Forwarded-* 只在 TRUST_PROXY=1 时才可信：同机反代会覆写这些头，
 * 而直连（8123 被暴露）者可以自己塞 `X-Forwarded-Proto: https` 伪装。
 * 公网部署必须让 8123 只监听 127.0.0.1（HOST=127.0.0.1）并由防火墙封住。 */
function trustProxy() { return String(process.env.TRUST_PROXY || '') === '1'; }
/* X-Forwarded-Proto 是被反代**覆写**的（Caddy 默认、nginx 的 proxy_set_header 都是覆盖式），取首段即可 */
function firstHeaderToken(v) { return String(v || '').split(',')[0].trim(); }
/* X-Forwarded-For 不同：反代多是**追加**而非覆写（nginx 的 $proxy_add_x_forwarded_for、Caddy 默认
 * 也会在已有值后添上客户端 IP），所以请求里完全可能带着攻击者自造的伪造前缀。
 * 只有「最近的受信反代添上的那一段」可信 = **最后一段**；若取首段，攻击者只要把
 * `X-Forwarded-For: <随机值>` 一路随请求变化，就能把限速桶全部洗牌，两档限速当场失效。
 * （多级代理链下最后一段是最靠近本进程的那跳；要让真实客户端 IP 落在这里请让反代**覆写**该头，
 *  样例 Caddyfile 已显式 header_up X-Forwarded-For，避免所有用户被并进同一个桶。） */
function lastHeaderToken(v) {
  const parts = String(v || '').split(',');
  for (let i = parts.length - 1; i >= 0; i--) { const s = parts[i].trim(); if (s) return s; }
  return '';
}
function reqIsSecure(req) {
  const mode = String(process.env.COOKIE_SECURE || 'auto').trim().toLowerCase();
  if (mode === '1' || mode === 'true' || mode === 'on') return true;
  if (mode === '0' || mode === 'false' || mode === 'off') return false;
  return trustProxy() && firstHeaderToken(req.headers['x-forwarded-proto']).toLowerCase() === 'https';
}
/* 限速/审计用的来源 IP：只在 TRUST_PROXY=1 时采信 XFF，且只取**最后一段**（见 lastHeaderToken
 * 的说明：反代追加式写头，前面的段全部不可信）。无 XFF 时退回 socket 地址 */
function clientIP(req) {
  if (trustProxy()) {
    const xff = lastHeaderToken(req.headers['x-forwarded-for']);
    if (xff) return xff;
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
/* 回环监听判定（启动告警用）：TRUST_PROXY=1 只有配合「只监听回环 + 封端口」才安全 */
function isLoopbackHost(h) {
  const s = String(h || '').trim().toLowerCase();
  return /^127\./.test(s) || s === '::1' || s === 'localhost';
}
/* 注册开关（公网默认应关）：ALLOW_REGISTER=0/false/off 关闭，未设=开放（保住本地即开即用） */
function allowRegister() {
  const v = String(process.env.ALLOW_REGISTER === undefined ? '1' : process.env.ALLOW_REGISTER).trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}
function cookieModeDesc() {
  const mode = String(process.env.COOKIE_SECURE || 'auto').trim().toLowerCase();
  if (mode === '1' || mode === 'true' || mode === 'on') return 'Secure 强制开启';
  if (mode === '0' || mode === 'false' || mode === 'off') return 'Secure 强制关闭';
  return trustProxy() ? 'Secure auto（信 X-Forwarded-Proto）' : 'Secure auto（未开 TRUST_PROXY → 不加）';
}
/* 登录失败限速：进程级单例（单进程服务；测试各自单独跑一个 node 进程，互不污染） */
const loginLimiter = auth.createLoginLimiter();

const STATIC_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/css/style.css': { file: 'css/style.css', type: 'text/css; charset=utf-8' },
  '/js/seed-data.js': { file: 'js/seed-data.js', type: 'text/javascript; charset=utf-8' },
  '/js/seed-data.json': { file: 'js/seed-data.json', type: 'application/json; charset=utf-8' },
  /* 睡眠形状契约（v4.7）：与 server/mapper.js 共用同一份实现，故放在 public/js 下先行加载 */
  '/js/sleep-shape.js': { file: 'js/sleep-shape.js', type: 'text/javascript; charset=utf-8' },
  /* 同步切片契约（v4.20）：同样前后端共用（mapper.js require），先于 app.js 加载 */
  '/js/slices.js': { file: 'js/slices.js', type: 'text/javascript; charset=utf-8' },
  '/js/app.js': { file: 'js/app.js', type: 'text/javascript; charset=utf-8' },
  /* v4.16 调试钩子（?probe/?selftest/?ftest/?shot）专用：由 loadDev() 按需注入，用户路径不加载 */
  '/js/dev.js': { file: 'js/dev.js', type: 'text/javascript; charset=utf-8' },
  /* 管理后台(v4.1)：页面本身公开，数据面全部走 /api/admin/* 的 admin 守卫 */
  '/admin': { file: 'admin.html', type: 'text/html; charset=utf-8' },
  '/admin.html': { file: 'admin.html', type: 'text/html; charset=utf-8' },
};

/* v4.16：文本响应按客户端 Accept-Encoding 走 gzip（app.js 230KB→75KB、seed-data.json 62KB→9KB）。
 * `q=0` = 客户端明确不接受该编码，按 RFC 9110 得跳过（只做 token 级判断，不做权重排序与通配符）。 */
function acceptsGzip(req) {
  const raw = String((req && req.headers['accept-encoding']) || '');
  return raw.split(',').some(part => {
    const seg = part.trim().toLowerCase().split(';');
    if (seg[0] !== 'gzip' && seg[0] !== 'x-gzip') return false;
    return !seg.slice(1).some(p => /^\s*q=0(\.0*)?\s*$/.test(p));
  });
}

function sendJson(res, code, obj, extraHeaders) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }, extraHeaders || {});
  /* 大响应（/api/state 最大 ~35KB、/api/system/library ~32KB）也压缩；小响应压了反而更大 */
  if (res.__gz && body.length >= 1024) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    const gz = zlib.gzipSync(body);
    headers['Content-Length'] = gz.length;
    res.writeHead(code, headers);
    res.end(gz);
    return;
  }
  headers['Content-Length'] = body.length;
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

/* ---------- 静态资源：ETag 校验(304) + gzip ----------
 * v4.16 前的写法是 `Cache-Control: no-store` 且不压缩：手机每刷新一次就要重下
 * 361KB（app.js 258KB + seed-data.json 62KB…），是「局域网刷新有点慢」的主因。
 * 这里用 no-cache + ETag（而非 max-age）：每次刷新仍会带 If-None-Match 回服务器校验，
 * 未改动 → 304（约 300B），改动 → 立刻下发新内容。项目无构建、无版本号，
 * 靠 304 既省掉重复下载，又不会出现「改了代码手机还拿旧文件」。
 * 内容按 (size,mtime) 缓存在内存：文件数很少，无需淘汰策略。 */
const staticCache = new Map();
function serveStatic(req, res, key) {
  const entry = STATIC_FILES[key];
  const full = path.normalize(path.join(PUBLIC_DIR, entry.file));
  if (!full.startsWith(PUBLIC_DIR)) { sendJson(res, 403, { error: 'forbidden' }); return; }
  fs.stat(full, (err, st) => {
    if (err) { sendJson(res, 404, { error: 'not_found', path: key }); return; }
    /* ETag = 大小 + mtime(ms)。mtime 精度取决于文件系统（本项目所在的 NTFS/exFAT fuse 挂载
     * 实测只有 10ms 粒度）：同一时间窗内「等长改动」理论上会撞成同一个 ETag。人工编辑不现实，
     * 但别用「改内容不改 mtime」的方式写文件（连续写入的自动化验证同样要当心）。 */
    const etag = '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    /* 200 与 304 都带 Vary：响应体随 Accept-Encoding 变化，304 也得按同一规则缓存 */
    const headers = { 'ETag': etag, 'Cache-Control': 'no-cache', 'Vary': 'Accept-Encoding' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
    let c = staticCache.get(full);
    if (!c || c.etag !== etag) {
      let raw;
      try { raw = fs.readFileSync(full); }
      catch (e) { sendJson(res, 404, { error: 'not_found', path: key }); return; }
      c = { etag: etag, raw: raw, gz: null };
      staticCache.set(full, c);
    }
    const gz = acceptsGzip(req);
    /* 惰性压：不接受 gzip 的客户端不为它白压一次（压缩缓存留在条目上，下次复用） */
    if (gz && !c.gz) c.gz = zlib.gzipSync(c.raw);
    const body = gz ? c.gz : c.raw;
    res.writeHead(200, Object.assign({
      'Content-Type': entry.type,
      'Content-Length': body.length,
    }, gz ? { 'Content-Encoding': 'gzip' } : {}, headers));
    res.end(req.method === 'HEAD' ? undefined : body);
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
/* 一次 PUT /api/slices 最多带多少片：正常一次编辑脏 1~3 片（习惯改名会带上若干打卡日），
 * 500 只防「整库搬运」这种异常调用；超限显式报错不静默截断 */
const SLICE_MAX_PER_WRITE = 500;
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
  /* 2026-09-12 用户裁定：新注册用户**不再**整份拷贝系统库，个人库初始为空
   * （旧的 copyLibrary(readSystemLibrary(db)) 已删；系统库不追溯、要什么去系统库页
   *  「＋我的库」挑入，个人库只装用户自己挑/录的条目）。copyLibrary 仍留在 seed.js
   *  供一次性工具 server/test/reset-food-library.js 使用。 */
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
    mapper.createUser(db, uid, { name });
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
    { 'Set-Cookie': auth.cookieHeader(token, { secure: reqIsSecure(req) }) });
}

async function handleLogin(db, req, res) {
  const body = await readJson(req, res); if (!body) return;
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  /* 限速挡在验密之前：既省 CPU，也堵住「拿 scrypt 当放大器」的路子 */
  const ip = clientIP(req);
  /* 用户名参与限速 key，登录名本身长度不受限（body 上限 10MB）——截断后再拼，
   * 否则一个 10MB 的用户名就能在限速表里存下一大块内存 */
  const uname = username.slice(0, 64);
  const rules = [
    { key: 'u:' + ip + '|' + uname, max: loginLimiter.caps.maxPerUser },
    { key: 'i:' + ip, max: loginLimiter.caps.maxPerIP },
  ];
  const limited = loginLimiter.check(rules);
  if (limited) {
    sendJson(res, 429, { error: 'too_many_attempts', message: '登录失败次数过多，请稍后再试', retry_after: limited.retryAfter },
      { 'Retry-After': String(limited.retryAfter) });
    return;
  }
  const acc = db.prepare('SELECT pwd, role FROM accounts WHERE username = ?').get(username);
  if (!acc || !(await auth.verifyPassword(password, acc.pwd))) {   /* v4.3：异步 scrypt，不阻塞事件循环 */
    const justBlocked = loginLimiter.fail(rules);
    if (justBlocked.length) {
      console.warn('[auth] 登录失败次数触顶，临时拒绝 ' + Math.round(loginLimiter.caps.blockMs / 1000) + 's：' + justBlocked.join(', '));
    }
    sendJson(res, 401, { error: 'bad_credentials' }); return;
  }
  loginLimiter.reset(rules[0].key);   /* 成功只清本组合；IP 计数保留，防「猜中一个就整台洗白」 */
  const token = auth.createSession(db, username);
  sendJson(res, 200, { ok: true, username, role: acc.role },
    { 'Set-Cookie': auth.cookieHeader(token, { secure: reqIsSecure(req) }) });
}

/* ---------- 业务路由（命中并已响应 → 返回 undefined；未命中 → false） ---------- */
async function handleState(db, req, res, sessionUser, pathname) {
  if (req.method === 'GET' && pathname === '/api/state') {
    /* v4.20：整树响应顺带带上切片 manifest（{key: 该片最后一次改动的全局 rev}），
     * 让客户端开一次机就拿到全部基线；解析不了该字段的老客户端不受影响 */
    const out = mapper.composeUser(db, sessionUser.userId);
    out.slices = mapper.sliceManifest(db, sessionUser.userId);
    sendJson(res, 200, out);
    return;
  }
  /* ---------- 切片同步（v4.20）----------
   * GET /api/slices[?since=<全局rev>][&keys=a,b]：
   *   · since ≥ 当前全局 rev → {rev, unchanged:true}（30s 轮询的常见路径，不传整份 manifest）
   *   · 带 keys → 追加 values（拿变过的片）；不带 → 只回整份 manifest
   * PUT /api/slices {slices:{key:{rev?,value}}}：整批原子，任一片 CAS 不过 → 409 + 冲突片现值，
   *   一片也不写（客户端拿到现值直接裁决，无需二次请求）。rev 缺省 = 盲写。 */
  if (req.method === 'GET' && pathname === '/api/slices') {
    const uid = sessionUser.userId;
    const q = new URL(req.url, 'http://localhost').searchParams;
    const cur = mapper.userRev(db, uid);
    const since = q.get('since');
    const keys = String(q.get('keys') || '').split(',').map(s => s.trim()).filter(Boolean);
    /* 带 keys = 明确要值，优先于 since 短路（两者含义不同；客户端本次不组合使用，但契约要无歧义） */
    if (!keys.length && since !== null && since !== '' && Number(since) >= cur) {
      sendJson(res, 200, { rev: cur, unchanged: true, slices: {} });
      return;
    }
    const slices = {}, values = {};
    if (keys.length) {
      for (const k of keys) {
        if (!mapper.isValidSliceKey(k)) { sendJson(res, 400, { error: 'unknown_slice', key: k }); return; }
        slices[k] = mapper.sliceRev(db, uid, k);
        const v = mapper.readSlice(db, uid, k);
        values[k] = v === undefined ? null : v;   /* 缺片 → null（客户端按「删片」处理） */
      }
      sendJson(res, 200, { rev: cur, slices: slices, values: values });
      return;
    }
    sendJson(res, 200, { rev: cur, slices: mapper.sliceManifest(db, uid) });
    return;
  }
  if (req.method === 'PUT' && pathname === '/api/slices') {
    const body = await readJson(req, res);
    if (!body) return;
    const raw = body.slices;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      sendJson(res, 400, { error: 'invalid_slices', hint: '需 {slices:{key:{rev?,value}}}' });
      return;
    }
    const keys = Object.keys(raw);
    if (!keys.length) { sendJson(res, 400, { error: 'invalid_slices', hint: 'slices 不能为空' }); return; }
    if (keys.length > SLICE_MAX_PER_WRITE) {
      sendJson(res, 400, { error: 'too_many_slices', max: SLICE_MAX_PER_WRITE });
      return;
    }
    const entries = [];
    for (const k of keys) {
      const item = raw[k];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        sendJson(res, 400, { error: 'invalid_slices', key: k, hint: '每片需 {rev?, value}' });
        return;
      }
      const bad = mapper.validateSliceValue(k, item.value);
      if (bad) {
        if (bad.error === 'unknown_slice') { sendJson(res, 400, { error: 'unknown_slice', key: k }); return; }
        if (bad.error === 'sleep_too_many_segments') {
          /* key 必须带上：客户端靠它把「这一片」挂起来跳过，否则同一批会被无限重试（400 死循环）。
           * key 由 validateSliceValue 用 slices.js 的 sliceDayKey 拼好，不在路由里手拼 */
          sendJson(res, 400, { error: bad.error, key: bad.key,
            hint: '单日睡眠最多 ' + bad.max + ' 段（日期 ' + bad.date + '）' });
          return;
        }
        sendJson(res, 400, { error: bad.error, key: k, hint: '切片值类型不符' });
        return;
      }
      let rev;
      if (item.rev === undefined || item.rev === null) rev = undefined;          /* 盲写 */
      else if (typeof item.rev === 'number' && Number.isFinite(item.rev)) rev = item.rev;
      else { sendJson(res, 400, { error: 'invalid_slice_rev', key: k }); return; }
      entries.push({ key: k, value: item.value, rev: rev });
    }
    const result = mapper.writeSlices(db, sessionUser.userId, entries);
    if (!result.ok) {
      if (result.error === 'rev_conflict') {
        sendJson(res, 409, { error: 'rev_conflict', rev: result.rev, conflicts: result.conflicts });
        return;
      }
      sendJson(res, 401, { error: 'unauthorized' }); return;
    }
    sendJson(res, 200, result);
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
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookieHeader({ secure: reqIsSecure(req) }) });
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
  res.__gz = acceptsGzip(req);   /* sendJson 据此决定是否 gzip（不逐处传 req） */
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
    if (req.method === 'POST' && pathname === '/api/register') {
      /* 公网部署应设 ALLOW_REGISTER=0：开放注册意味着任何人都能自助建号；
       * 更要紧的是「首个注册账户 = admin」——公开注册的站点上，第一个访客就是管理员。 */
      if (!allowRegister()) {
        sendJson(res, 403, { error: 'register_closed', message: '本站已关闭注册' });
        return;
      }
      await handleRegister(db, req, res); return;
    }
    if (req.method === 'POST' && pathname === '/api/login') { await handleLogin(db, req, res); return; }
    if ((req.method === 'GET' || req.method === 'HEAD') && STATIC_FILES[pathname]) { serveStatic(req, res, pathname); return; }

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
  /* v4.16：Node 默认 keepAliveTimeout=5s，比浏览器 socket 池的空闲时间短——
   * 手机放一会儿再刷新时，浏览器可能复用「服务端已关掉」的连接，白白等一轮超时
   * （表现就是「有时候要等几秒 / 系统库偶发假离线」）。设成 65s 并配 headersTimeout。 */
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
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
        console.log('   HTTPS/Cookie ' + cookieModeDesc() + ' · ' + (allowRegister() ? '注册开放' : '注册已关闭'));
        if (/^(1|true|on)$/i.test(String(process.env.COOKIE_SECURE || '').trim())) {
          console.log('   ⚠ 已强制 Secure Cookie：明文 HTTP 访问将无法登录（局域网调试请设 COOKIE_SECURE=0）');
        }
        /* 错配告警：TRUST_PROXY=1 的可信前提是「只有反代能进得来」。
         * 若同时监听非回环地址，直连者自塞 X-Forwarded-Proto/X-Forwarded-For 就能分别伪装
         * HTTPS 判定与限速来源 IP（也能绕过 IP 档限速）——文档写了铁律，这里给一句硬提醒。 */
        if (trustProxy() && !isLoopbackHost(opts.host || HOST)) {
          console.log('   ⚠ TRUST_PROXY=1 却监听 ' + (opts.host || HOST) + '（非回环）：直连者能伪造 X-Forwarded-* 骗过 HTTPS 判定并绕过限速分桶。');
          console.log('     公网部署请改 HOST=127.0.0.1，并由防火墙封住端口（只放行反代端口）');
        }
        if (!allowRegister() && n === 0) {
          console.log('   ⚠ 注册已关闭且库中还没有任何账户：先临时 ALLOW_REGISTER=1 建好管理员，再关掉注册上线');
        }
        if (!allowRegister() && n > 0) {
          console.log('   新增账户   需临时 ALLOW_REGISTER=1 注册后再关闭（管理后台没有建号入口）');
        }
        console.log('   账户       ' + (n === 0
          ? (allowRegister() ? '尚无任何账户 — 打开网页注册第一个账户（自动成为管理员）' : '尚无任何账户（注册已关闭）')
          : '已注册 ' + n + ' 个账户'));
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
