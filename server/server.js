'use strict';
/* =====================================================
   健康管理 · 本地同步服务器（零 npm 依赖）
   node server.js  →  http://localhost:8123
   - 静态托管 ../public（页面 3 个文件，显式路径映射）
   - GET/PUT /api/state：整体状态读写（rev 乐观并发）
   - GET /api/health：诊断
   手机与电脑访问同一进程 = 同一份数据库，天然同步。
   注意：v1 面向可信局域网，无鉴权；上云前必须加登录/token。
   ===================================================== */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const dbm = require('./db');
const mapper = require('./mapper');

const DEFAULT_PORT = Number(process.env.PORT || 8123);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY = 10 * 1024 * 1024;

const STATIC_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/css/style.css': { file: 'css/style.css', type: 'text/css; charset=utf-8' },
  '/js/app.js': { file: 'js/app.js', type: 'text/javascript; charset=utf-8' },
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
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

async function handle(db, req, res) {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch { sendJson(res, 400, { error: 'bad_url' }); return; }

  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      const n = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
      sendJson(res, 200, { ok: true, rev: mapper.currentRev(db), users: n });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/state') {
      sendJson(res, 200, mapper.compose(db));
      return;
    }
    if (req.method === 'PUT' && pathname === '/api/state') {
      let payload;
      try { payload = JSON.parse((await readBody(req)).toString('utf8')); }
      catch (e) {
        if (e && e.code === 'PAYLOAD_TOO_LARGE') { sendJson(res, 413, { error: 'payload_too_large' }); return; }
        sendJson(res, 400, { error: 'invalid_json' });
        return;
      }
      if (!payload || !mapper.isValidState(payload.data)) {
        sendJson(res, 400, { error: 'invalid_state', hint: 'data 需包含 users 与 shared:{foods,exercises}' });
        return;
      }
      const cur = mapper.currentRev(db);
      /* rev 缺省视为盲写（离线客户端回线首推的场景）；带 rev 且过期 → 409 */
      if (payload.rev !== undefined && payload.rev !== null && payload.rev !== cur) {
        sendJson(res, 409, { error: 'rev_conflict', rev: cur });
        return;
      }
      const rev = mapper.split(db, payload.data);
      sendJson(res, 200, { rev });
      return;
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && STATIC_FILES[pathname]) {
      serveStatic(res, pathname);
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
        console.log('💪 健康管理 · 同步服务器已启动');
        console.log('   本机访问   http://localhost:' + actual);
        for (const { ip } of lanIPs()) console.log('   手机/同网   http://' + ip + ':' + actual);
        console.log('   数据库     ' + (opts.dbPath || process.env.DB_PATH || dbm.DEFAULT_DB));
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
