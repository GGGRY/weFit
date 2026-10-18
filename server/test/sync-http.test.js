'use strict';
/* =====================================================
   按片同步的**真链路**端到端测试（v4.20）
   定位：render.test.js 拿 fetch 桩验客户端渲染、roundtrip.test.js 拿 HTTP 请求验服务端；
   两者之间还剩一条缝——「真实 app.js 同步层 + 真实 server + 真实 SQLite」拼起来到底跑不跑得通。
   这里就补这条缝：N 台「设备」= 各自独立 localStorage + 独立 Cookie + 独立 vm 上下文，
   每个上下文都跑真的 public/js/app.js，网络走真的 http://127.0.0.1:<port>。
   验的正是本轮改动的卖点：
     · 两台设备改不同日期 → 互不覆盖、也不弹窗；
     · 干净时的 30s 轮询 → 只拉变过的片（since 短路 + keys 拉值）；
     · 改同一天 → 只有这一片冲突，同一批里其余脏片照常上传；
     · 用户选「本机覆盖」→ 只有冲突片盲写。
   运行：node test/sync-http.test.js
   ===================================================== */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const TMP_DB = path.join(os.tmpdir(), 'wefit-synchttp-' + process.pid + '.db');
try { fs.rmSync(TMP_DB, { force: true }); } catch (e) {}
process.env.DB_PATH = TMP_DB;

const { start } = require('../server');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('[PASS] ' + name); }
  else { failed++; console.log('[FAIL] ' + name + (detail ? '  →  ' + detail : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readPub = p => fs.readFileSync(path.join(__dirname, '..', '..', 'public', p), 'utf8');

/* ---------- 迷你 DOM 桩（取向同 render.test.js：选择器自动物化、事件全 no-op） ---------- */
function makeNode(tag) {
  const node = {
    __html: '', textContent: '', value: '', checked: false, disabled: false,
    dataset: {}, style: {}, children: [], tagName: String(tag || 'div').toUpperCase(),
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    insertAdjacentHTML(pos, h) { this.__html += String(h); },
    closest() { return null; }, focus() {}, blur() {}, click() {}, scrollIntoView() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
    querySelectorAll() { return []; },
    onclick: null,
  };
  Object.defineProperty(node, 'innerHTML', {
    get() { return this.__html; },
    set(h) { this.__html = String(h); },
  });
  const subs = new Map();
  node.querySelector = sel => { if (!subs.has(sel)) subs.set(sel, makeNode('div')); return subs.get(sel); };
  return node;
}
function makeLS() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
    key: () => null,
  };
}

let PORT = 0;

/* ---------- 一台「设备」：独立 localStorage / Cookie / vm 上下文，跑真实 app.js ---------- */
function makeDevice(sid, seed, who, opts) {
  const jar = { sid: sid || null };
  const ls = makeLS();
  /* 真实登录会写这两把键；离线启动靠它认出「上次登录过」（键名与 app.js 的 AUTH_KEY 一致）。
   * opts.legacyAuth = 模拟旧版本留下的 jjhealth_* 键（验 v4.23 键名迁移） */
  const authPrefix = (opts && opts.legacyAuth) ? 'jjhealth_' : 'wefit_';
  ls.setItem(authPrefix + 'auth_user', who || 'e2e');
  ls.setItem(authPrefix + 'auth_role', 'user');
  if (seed) Object.keys(seed).forEach(k => ls.setItem(k, seed[k]));
  const doc = makeNode('#document');
  doc.documentElement = makeNode('html');
  doc.head = makeNode('head');
  doc.body = makeNode('body');
  doc.createElement = t => makeNode(t);
  doc.getElementById = id => doc.querySelector('#' + id);
  const device = { confirmAnswer: true };
  let confirmCount = 0;
  const sandbox = {
    document: doc, localStorage: ls,
    location: { search: '', pathname: '/', hash: '', href: 'http://localhost/', reload() {} },
    history: { replaceState() {}, pushState() {} },
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    URLSearchParams, URL, AbortController, TextEncoder,
    alert() {}, confirm: () => { confirmCount++; return device.confirmAnswer; }, prompt: () => '',
    XMLHttpRequest: null,
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  sandbox.window.scrollTo = () => {};
  sandbox.window.addEventListener = () => {};
  sandbox.window.removeEventListener = () => {};
  sandbox.navigator = { vibrate() {} };
  /* 真·HTTP：相对路径补上本机端口，Cookie 用各自的 jar（= 两个浏览器各自的会话） */
  sandbox.fetch = (url, opts) => {
    const u = /^https?:/i.test(String(url)) ? String(url) : 'http://127.0.0.1:' + PORT + String(url);
    const o = Object.assign({}, opts || {});
    o.headers = Object.assign({}, o.headers || {});
    if (jar.sid) o.headers.cookie = 'wefit_sid=' + jar.sid;
    return fetch(u, o).then(r => {
      const sc = r.headers.get('set-cookie');
      if (sc) { const m = sc.match(/wefit_sid=([^;]*)/); if (m) jar.sid = m[1] || null; }
      return r;
    });
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/seed-data.js', 'js/sleep-shape.js', 'js/slices.js', 'js/app.js'])
    vm.runInContext(readPub(f), ctx, { filename: 'public/' + f });
  device.ev = code => vm.runInContext(code, ctx);
  device.doc = doc;
  device.jar = jar;
  device.ls = ls;
  device.confirms = () => confirmCount;   /* confirm 被调用次数＝弹过几次人工裁决 */
  device.localStorage = ls;
  /* 本机缓存的三个键（模拟「同一台机器重开」时原样搬过去） */
  device.snapshot = () => {
    const w = who || 'e2e', out = {};
    ['wefit_auth_user', 'wefit_auth_role', 'wefit_v3:' + w, 'wefit_v3meta:' + w]
      .forEach(k => { const v = ls.getItem(k); if (v !== null) out[k] = v; });
    return out;
  };
  return device;
}
/* 等启动链（/api/me → /api/state → 采纳 → 渲染）落地 */
async function booted(device, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    if (device.ev('USERS !== null && state !== null')) {
      /* 关掉首次引导浮层（真实用户点「直接开始」）：有弹窗开着时增量拉取会礼貌让路 */
      device.ev('curDialog && closeDialog()');
      return true;
    }
    await sleep(20);
  }
  ok('启动链落地（' + label + '）', false, '6s 超时：USERS/state 仍为空');
  return false;
}

async function main() {
  const { server, port } = await start({ port: 0, quiet: true });
  PORT = port;

  /* Node 侧直连（断言用）：带自己的 cookie 发请求 */
  async function raw(method, p, body, sid) {
    const headers = {};
    if (sid) headers.cookie = 'wefit_sid=' + sid;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch('http://127.0.0.1:' + port + p, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = r.headers.get('set-cookie');
    let nsid = sid;
    if (sc) { const m = sc.match(/wefit_sid=([^;]*)/); if (m) nsid = m[1] || null; }
    let json = null;
    try { json = await r.clone().json(); } catch (e) { /* 非 JSON */ }
    return { status: r.status, json, sid: nsid };
  }

  /* ---------- 建档：一个账户，两台设备 ---------- */
  let r = await raw('POST', '/api/register', { username: 'e2e', password: 'secret123', name: '端到端' });
  ok('E1 注册账户', r.status === 201 && !!r.sid, JSON.stringify(r.json));
  let sidA = r.sid;
  r = await raw('POST', '/api/login', { username: 'e2e', password: 'secret123' });
  ok('E2 同一账户在第二台设备登录', r.status === 200 && !!r.sid && r.sid !== sidA);
  const sidB = r.sid;

  const A = makeDevice(sidA);
  await booted(A, 'A');
  ok('E3 设备 A 采纳服务器空树（单人树 + 切片基线为空）',
    A.ev('Object.keys(USERS.users).length') === 1 && A.ev('Object.keys(srv.sliceRevs || {}).length') === 0,
    'sliceRevs=' + A.ev('JSON.stringify(srv.sliceRevs)'));

  /* A 记录一天饮水 → 只推这一片 */
  A.ev("state.water['2026-05-01'] = 3; save()");
  await A.ev('doPush()');
  r = await raw('GET', '/api/state', undefined, sidA);
  const uid = Object.keys(r.json.data.users)[0];
  ok('E4 A 的改动落库（水 3 杯）且该片进了 manifest',
    r.json.data.users[uid].water['2026-05-01'] === 3 && typeof r.json.slices['water:2026-05-01'] === 'number',
    JSON.stringify(r.json.slices));
  const revAfterA = r.json.rev;

  /* ---------- 设备 B（全新缓存）冷启动：应采纳 A 的数据 ---------- */
  const B = makeDevice(sidB);
  await booted(B, 'B');
  await sleep(200);   /* 让 init 的异步链把数据用到 state 上 */
  ok('E5 B 冷启动采纳到 A 的水记录（跨设备同步）',
    B.ev("state.water['2026-05-01']") === 3 && B.ev('srv.rev') === revAfterA,
    'water=' + B.ev("JSON.stringify(state.water)") + ' rev=' + B.ev('srv.rev'));

  /* B 改另一天 → 两台设备各改各的，互不覆盖 */
  B.ev("state.water['2026-05-02'] = 5; save()");
  await B.ev('doPush()');
  r = await raw('GET', '/api/state', undefined, sidA);
  ok('E6 B 改另一天：服务端两天都在（按片写不整树覆盖）',
    r.json.data.users[uid].water['2026-05-01'] === 3 && r.json.data.users[uid].water['2026-05-02'] === 5,
    JSON.stringify(r.json.data.users[uid].water));

  /* A 的 30s 轮询：干净路径只拉变过的片（不弹窗） */
  A.confirmAnswer = true;                 /* 干净轮询不该弹窗；一旦弹了这里也会被记录 */
  await A.ev('retrySync()');
  ok('E7 A 轮询拉到 B 改的那一天（增量拉片），自己的数据没被动',
    A.ev("state.water['2026-05-02']") === 5 && A.ev("state.water['2026-05-01']") === 3,
    'water=' + A.ev("JSON.stringify(state.water)"));

  /* ---------- 同一天冲突：只冲突这一片，同批其余脏片照常上传 ---------- */
  A.ev("state.water['2026-05-03'] = 1; state.sleep['2026-06-01'] = [{ t:'night', bed:'23:00', wake:'07:00', mins:480 }]; save()");
  B.ev("state.water['2026-05-03'] = 9; save()");
  await B.ev('doPush()');
  A.confirmAnswer = true;                 /* 用服务器 */
  await A.ev('doPush()');                 /* 命中 409 → 采纳服务器现值 */
  await A.ev('doPush()');                 /* 其余脏片（睡眠）继续推 */
  r = await raw('GET', '/api/state', undefined, sidA);
  const uA = r.json.data.users[uid];
  ok('E8 冲突片采纳服务器现值（5/3 = 9，不是本机的 1）', uA.water['2026-05-03'] === 9, JSON.stringify(uA.water));
  ok('E9 同一批里未冲突的睡眠片照常上传（旧版整树二选一会把它丢掉）',
    !!(uA.sleep && uA.sleep['2026-06-01'] && uA.sleep['2026-06-01'].length === 1), JSON.stringify(uA.sleep));
  ok('E10 A 本机也不再残留脏片', A.ev('(metaGet().dirtySlices || []).length') === 0 && A.ev('metaGet().dirty') === false);

  /* ---------- 用户选「本机覆盖」：只有冲突片盲写 ---------- */
  B.ev("state.water['2026-05-04'] = 2; save()");
  A.ev("state.water['2026-05-04'] = 8; save()");
  await A.ev('doPush()');                 /* A 先写：服务器 = 8 */
  r = await raw('GET', '/api/state', undefined, sidA);
  ok('E11a A 先写成功（服务器 5/4 = 8）', r.json.data.users[uid].water['2026-05-04'] === 8,
    JSON.stringify(r.json.data.users[uid].water));
  B.confirmAnswer = false;                /* B 选「本机覆盖」 */
  await B.ev('doPush()');                 /* 409 → 只对冲突片盲写、排入队列 */
  await sleep(700);                       /* 等 queuePush 的 600ms 防抖落地 */
  await B.ev('doPush()');
  r = await raw('GET', '/api/state', undefined, sidA);
  ok('E11b 选「本机覆盖」后冲突片变成 B 的值（2）', r.json.data.users[uid].water['2026-05-04'] === 2,
    JSON.stringify(r.json.data.users[uid].water));

  /* ---------- 旧客户端兼容：整树 PUT 之后，按片客户端仍能收敛（不丢 B 的新写入） ---------- */
  r = await raw('GET', '/api/state', undefined, sidA);
  const treeNow = r.json.data, revNow = r.json.rev;
  const legacy = JSON.parse(JSON.stringify(treeNow));
  legacy.users[uid].water['2026-05-05'] = 4;             /* 老客户端整树写：加一天 */
  r = await raw('PUT', '/api/state', { rev: revNow, data: legacy }, sidA);
  ok('E12 老客户端整树 PUT 仍可用', r.status === 200 && r.json.rev === revNow + 1, JSON.stringify(r.json));
  await A.ev('retrySync()');
  ok('E13 整树写之后 A 能收敛（manifest 全片抬 rev → 拉到变过的片，不弹窗也不丢）',
    A.ev("state.water['2026-05-05']") === 4 && A.ev("state.water['2026-05-04']") === 2,
    'water=' + A.ev("JSON.stringify(state.water)"));

  /* ---------- 新注册账户的第一次编辑：只推真正改动的那一片 ---------- */
  r = await raw('POST', '/api/register', { username: 'e2e2', password: 'secret123', name: '新账户' });
  ok('E14a 新账户注册', r.status === 201 && !!r.sid);
  const sidC = r.sid;
  const C = makeDevice(sidC);
  await booted(C, 'C');
  await sleep(200);
  r = await raw('GET', '/api/state', undefined, sidC);
  const uidC2 = Object.keys(r.json.data.users)[0];
  ok('E14b 新账户刚注册：服务器只有空档案，尚无任何切片',
    Object.keys(r.json.slices).length === 0 && !!r.json.data.users[uidC2], JSON.stringify(r.json.slices));
  C.ev("state.profile.currentKg = 70; save()");
  await C.ev('doPush()');
  r = await raw('GET', '/api/state', undefined, sidC);
  const pushedKeys = Object.keys(r.json.slices).sort();
  ok('E14c 第一次编辑只推「改动的片」（profile）+ 本机规范化补出的默认习惯定义',
    r.json.data.users[uidC2].profile.currentKg === 70 && typeof r.json.slices.profile === 'number'
    && JSON.stringify(pushedKeys) === JSON.stringify(['habits', 'profile']), JSON.stringify(r.json.slices));
  ok('E14d 渲染不再凭空物化空饮食日（历史页/概览只读渲染不该产生 meal_days）',
    !Object.keys(r.json.slices).some(k => k.indexOf('meals:') === 0), JSON.stringify(r.json.slices));
  ok('E14e 默认习惯定义按片上推（否则服务端没有习惯可挂，打卡会丢）：4 个默认习惯',
    Array.isArray(r.json.data.users[uidC2].habits) && r.json.data.users[uidC2].habits.length === 4,
    JSON.stringify(r.json.data.users[uidC2].habits));
  ok('E14f 推完无残留脏片/待推片', C.ev('(metaGet().dirtySlices || []).length') === 0
    && C.ev('(metaGet().pushSlices || []).length') === 0 && C.ev('pushKeys().length') === 0,
    'dirty=' + C.ev('JSON.stringify(metaGet().dirtySlices)') + ' push=' + C.ev('JSON.stringify(metaGet().pushSlices)'));

  /* ---------- v4.20 回归：带着「未推送改动」的缓存启动（改完关页 → 再开） ----------
   * 这是旧版「弹窗二选一/绝不静默丢改动」整套设计存在的理由，也是按片重构最容易踩空的一格：
   * 启动裁决要按片读**本机树**（旧写法那时 USERS 还是 null），而推进基线又不能把待推片抹掉。 */
  r = await raw('POST', '/api/register', { username: 'e2e5', password: 'secret123', name: '离线回线' });
  const sidE = r.sid;
  const F = makeDevice(sidE, null, 'e2e5');
  await booted(F, 'F');
  await sleep(150);
  F.ev("state.profile.currentKg = 68; state.water['2099-01-01'] = 3; save(); if(srv.pushTimer){ clearTimeout(srv.pushTimer); srv.pushTimer = null; }");
  ok('E16a 模拟「改完就关页」：两片脏着、还没推出去',
    F.ev("(metaGet().dirtySlices||[]).indexOf('water:2099-01-01')") >= 0
    && F.ev("(metaGet().dirtySlices||[]).indexOf('profile')") >= 0,
    'dirty=' + F.ev('JSON.stringify(metaGet().dirtySlices)'));
  r = await raw('GET', '/api/state', undefined, sidE);
  const uidE = Object.keys(r.json.data.users)[0];
  ok('E16b 此刻服务器上还没有这条记录（确实是「待推」状态）',
    r.json.data.users[uidE].water['2099-01-01'] === undefined && (r.json.data.users[uidE].profile || {}).currentKg !== 68);
  const seedCache = F.snapshot();

  /* ① 在线重开（服务器可达）：先读本机树再裁决，profile 不能炸、water 不能被读成 null 删掉 */
  const H = makeDevice(sidE, seedCache, 'e2e5');
  await booted(H, 'H');
  await sleep(400);
  ok('E16c 在线重开：本机改动原样保留（profile 不抛异常、water 不被读成 null 删掉）',
    H.ev('state.profile.currentKg') === 68 && H.ev("state.water['2099-01-01']") === 3,
    'kg=' + H.ev('state.profile.currentKg') + ' water=' + H.ev("state.water['2099-01-01']"));
  await H.ev('doPush()');
  await sleep(700);
  await H.ev('doPush()');
  r = await raw('GET', '/api/state', undefined, sidE);
  ok('E16d 补推成功：两片都落到服务器（没有被静默丢）',
    r.json.data.users[uidE].profile.currentKg === 68 && r.json.data.users[uidE].water['2099-01-01'] === 3,
    'server kg=' + r.json.data.users[uidE].profile.currentKg + ' water=' + JSON.stringify(r.json.data.users[uidE].water));

  /* ② 离线重开（服务器不可达）→ 回线后补推：推进基线时不能把待推清单当「已对齐」清空 */
  const livePort = PORT;
  PORT = 1;                                     /* 连接必失败：走完全离线启动分支 */
  const G = makeDevice(sidE, seedCache, 'e2e5');
  await booted(G, 'G');
  G.ev('curDialog && closeDialog()');
  ok('E16e 离线重开：待推片被转成 pushSlices（不是「已对齐」）',
    G.ev("(metaGet().pushSlices||[]).indexOf('water:2099-01-01')") >= 0
    && G.ev("(metaGet().pushSlices||[]).indexOf('profile')") >= 0,
    'push=' + G.ev('JSON.stringify(metaGet().pushSlices)') + ' dirty=' + G.ev('JSON.stringify(metaGet().dirtySlices)'));
  ok('E16f 离线重开：本机改动仍在树上', G.ev('state.profile.currentKg') === 68 && G.ev("state.water['2099-01-01']") === 3);
  PORT = livePort;                              /* 回线 */
  await G.ev('retrySync()');
  await sleep(700);
  await G.ev('doPush()');
  r = await raw('GET', '/api/state', undefined, sidE);
  ok('E16g 回线后自动补推（本机改动没被静默覆盖/丢弃）',
    G.ev('state.profile.currentKg') === 68 && r.json.data.users[uidE].profile.currentKg === 68,
    'local kg=' + G.ev('state.profile.currentKg') + ' server kg=' + r.json.data.users[uidE].profile.currentKg);

  /* ---------- A2 回归：离线冷启动（基线是内存态、重启即丢）后回线，不该对本机自己推过的片弹假冲突 ---------- */
  r = await raw('POST', '/api/register', { username: 'e2e7', password: 'secret123', name: '基线回线' });
  const sidF = r.sid;
  const P = makeDevice(sidF, null, 'e2e7');
  await booted(P, 'P');
  await sleep(200);
  P.ev("state.water['2099-02-02'] = 3; save()");
  await P.ev('doPush()');
  await sleep(700);
  await P.ev('doPush()');
  r = await raw('GET', '/api/state', undefined, sidF);
  const uidF = Object.keys(r.json.data.users)[0];
  ok('E17a 先推一天饮水落库（该片在服务器上已存在且有版本）',
    r.json.data.users[uidF].water['2099-02-02'] === 3 && typeof r.json.slices['water:2099-02-02'] === 'number',
    JSON.stringify(r.json.slices));

  /* 离线冷启动：srv.sliceRevs 丢了，再改「服务器已存在的那一片」→ 基线只能记 0 */
  const seedP = P.snapshot();
  const livePort2 = PORT;
  PORT = 1;
  const Q = makeDevice(sidF, seedP, 'e2e7');
  await booted(Q, 'Q');
  Q.ev('curDialog && closeDialog()');
  Q.ev("state.water['2099-02-02'] = 7; save(); if(srv.pushTimer){ clearTimeout(srv.pushTimer); srv.pushTimer = null; }");
  ok('E17b 离线冷启动后基线确实未知（dirtyRevs 记 null，不伪装成 0）',
    Q.ev("metaGet().dirtyRevs['water:2099-02-02']") === null,
    'revs=' + Q.ev('JSON.stringify(metaGet().dirtyRevs)'));
  PORT = livePort2;
  const confirmsBefore = Q.confirms();
  await Q.ev('retrySync()');
  await sleep(700);
  await Q.ev('doPush()');
  /* 网络往返+防抖都在真实时间轴上：等到服务器上真的变了再看结果（最多 3s） */
  for (let i = 0; i < 30; i++) {
    r = await raw('GET', '/api/state', undefined, sidF);
    if (r.json.data.users[uidF].water['2099-02-02'] === 7) break;
    await sleep(100);
  }
  r = await raw('GET', '/api/state', undefined, sidF);
  ok('E17c 回线：全局 rev 没动 → 直接补推成功（不弹假冲突、不丢这次编辑）',
    Q.confirms() === confirmsBefore && r.json.data.users[uidF].water['2099-02-02'] === 7
    && Q.ev("state.water['2099-02-02']") === 7,
    'confirms=' + Q.confirms() + '(before ' + confirmsBefore + ') local=' + Q.ev("state.water['2099-02-02']")
    + ' server=' + JSON.stringify(r.json.data.users[uidF].water));

  /* ---------- C6 回归：值一模一样的「冲突」不算冲突（两个标签页记了同一天同一个值） ---------- */
  r = await raw('POST', '/api/register', { username: 'e2e8', password: 'secret123', name: '同内容' });
  const sidG = r.sid;
  const R1 = makeDevice(sidG, null, 'e2e8');
  await booted(R1, 'R1');
  await sleep(200);
  const R2 = makeDevice(sidG, R1.snapshot(), 'e2e8');   /* 同一份缓存开第二个标签页：两边基线都不知道那一片 */
  await booted(R2, 'R2');
  await sleep(200);
  R1.ev("state.water['2099-05-05'] = 4; save()");
  R2.ev("state.water['2099-05-05'] = 4; save(); if(srv.pushTimer){ clearTimeout(srv.pushTimer); srv.pushTimer = null; }");
  await R1.ev('doPush()');
  await sleep(500);
  const confirmsBefore2 = R2.confirms();
  await R2.ev('doPush()');                 /* 基线 0 vs 服务器新 rev → 409，但内容一致 → 不该弹窗 */
  await sleep(400);
  await R2.ev('doPush()');
  r = await raw('GET', '/api/state', undefined, sidG);
  const uidG = Object.keys(r.json.data.users)[0];
  ok('E18a 同值「冲突」不弹窗（自动对齐，不打扰用户）', R2.confirms() === confirmsBefore2,
    'confirms=' + R2.confirms() + '(before ' + confirmsBefore2 + ')');
  ok('E18b 服务器与本地都保持 4（没有发生无意义的盲写覆盖）',
    r.json.data.users[uidG].water['2099-05-05'] === 4 && R2.ev("state.water['2099-05-05']") === 4,
    'server=' + JSON.stringify(r.json.data.users[uidG].water) + ' local=' + R2.ev("state.water['2099-05-05']"));
  ok('E18c 该片不再留在两套待推清单里',
    R2.ev("(metaGet().dirtySlices||[]).indexOf('water:2099-05-05')") < 0
    && R2.ev("(metaGet().pushSlices||[]).indexOf('water:2099-05-05')") < 0,
    'dirty=' + R2.ev('JSON.stringify(metaGet().dirtySlices)') + ' push=' + R2.ev('JSON.stringify(metaGet().pushSlices)'));

  /* ---------- v4.20 回归：服务端还没有习惯定义时，用户先打卡（旧实现会静默丢掉） ---------- */
  const D = makeDevice(sidC);
  await booted(D, 'D');
  await sleep(200);
  const habitId = D.ev('state.habits[0].id');
  const habitDay = D.ev('today()');
  D.ev("state.habits[0].done[today()] = true; save()");
  await D.ev('doPush()');
  await sleep(700);
  await D.ev('doPush()');
  r = await raw('GET', '/api/state', undefined, sidC);
  const uD = r.json.data.users[uidC2];
  const hD = (uD.habits || []).find(h => h.id === habitId) || { done: {} };
  ok('E15a 打卡落库：定义与打卡两片都上去了（定义先推/后推都不影响）',
    (uD.habits || []).length === 4 && Object.keys(hD.done).indexOf(habitDay) >= 0,
    'habits=' + (uD.habits || []).length + ' done=' + JSON.stringify(hD.done) + ' slices=' + Object.keys(r.json.slices).join(','));
  const E = makeDevice(sidC);
  await booted(E, 'E');
  await sleep(200);
  ok('E15b 同一账户换设备/重载后打卡仍在（不被静默丢）',
    E.ev("!!(state.habits.find(h => h.id === '" + habitId + "') || {done:{}}).done['" + habitDay + "']") === true,
    'habits=' + E.ev('JSON.stringify(state.habits.map(h => [h.id, Object.keys(h.done)]))'));

  /* ---------- v4.23：旧 localStorage 键（jjhealth_*）迁移到 wefit_* ---------- */
  r = await raw('POST', '/api/register', { username: 'e2e9', password: 'secret123', name: '键名迁移' });
  const sidH = r.sid;
  const MIG = makeDevice(sidH, {
    'jjhealth_view:e2e9': 'diet',
    'jjhealth_v3meta:e2e9': JSON.stringify({ rev: 0, gen: 0 }),
  }, 'e2e9', { legacyAuth: true });
  await booted(MIG, 'MIG');
  await sleep(200);
  ok('E19a 旧登录键迁移：jjhealth_auth_* → wefit_auth_*（旧键已删除）',
    MIG.ls.getItem('wefit_auth_user') === 'e2e9' && MIG.ls.getItem('jjhealth_auth_user') === null
    && MIG.ls.getItem('wefit_auth_role') === 'user' && MIG.ls.getItem('jjhealth_auth_role') === null,
    'user=' + MIG.ls.getItem('wefit_auth_user') + ' oldUser=' + MIG.ls.getItem('jjhealth_auth_user'));
  ok('E19b 旧页面记忆迁移：jjhealth_view:* → wefit_view:*（刷新后仍回到原页面）',
    MIG.ev('readView()') === 'diet' && MIG.ls.getItem('wefit_view:e2e9') === 'diet'
    && MIG.ls.getItem('jjhealth_view:e2e9') === null,
    'view=' + MIG.ls.getItem('wefit_view:e2e9') + ' oldView=' + MIG.ls.getItem('jjhealth_view:e2e9'));
  ok('E19c 旧同步元数据迁移：jjhealth_v3meta:* → wefit_v3meta:*（旧键已删除）',
    MIG.ls.getItem('jjhealth_v3meta:e2e9') === null && MIG.ls.getItem('wefit_v3meta:e2e9') !== null,
    'oldMeta=' + MIG.ls.getItem('jjhealth_v3meta:e2e9'));

  /* E19d：旧版留下的「带未推送改动的旧树」→ 新版重开迁移后仍能补推（不静默丢） */
  r = await raw('POST', '/api/register', { username: 'e2e10', password: 'secret123', name: '旧树补推' });
  const sidJ = r.sid;
  const J1 = makeDevice(sidJ, null, 'e2e10');
  await booted(J1, 'J1');
  await sleep(150);
  J1.ev("state.water['2099-06-06'] = 7; save(); if(srv.pushTimer){ clearTimeout(srv.pushTimer); srv.pushTimer = null; }");
  ok('E19d0 造出旧版脏缓存：水片已脏、尚未推送',
    J1.ev("(metaGet().dirtySlices||[]).indexOf('water:2099-06-06')") >= 0,
    'dirty=' + J1.ev('JSON.stringify(metaGet().dirtySlices)'));
  const legacyTree = J1.ls.getItem('wefit_v3:e2e10');
  const legacyMeta = J1.ls.getItem('wefit_v3meta:e2e10');
  r = await raw('GET', '/api/state', undefined, sidJ);
  const uidJ = Object.keys(r.json.data.users)[0];
  ok('E19d1 服务器上确实还没有这条记录', r.json.data.users[uidJ].water['2099-06-06'] === undefined,
    JSON.stringify(r.json.data.users[uidJ].water));
  const J2 = makeDevice(sidJ, {
    'jjhealth_v3:e2e10': legacyTree,
    'jjhealth_v3meta:e2e10': legacyMeta,
  }, 'e2e10', { legacyAuth: true });
  await booted(J2, 'J2');
  await sleep(300);
  await J2.ev('doPush()');
  await sleep(700);
  await J2.ev('doPush()');
  r = await raw('GET', '/api/state', undefined, sidJ);
  ok('E19d 旧树迁移后补推成功（离线编辑没被静默丢）',
    r.json.data.users[uidJ].water['2099-06-06'] === 7
    && J2.ev("state.water['2099-06-06']") === 7
    && J2.ls.getItem('jjhealth_v3:e2e10') === null
    && J2.ls.getItem('jjhealth_v3meta:e2e10') === null,
    'server=' + JSON.stringify(r.json.data.users[uidJ].water) + ' dirty=' + J2.ev('JSON.stringify(metaGet().dirtySlices)'));

  console.log('---');
  console.log(failed === 0 ? '全部通过:' + passed + ' 项断言(真链路：app.js 同步层 × http 服务 × SQLite)'
    : '通过 ' + passed + ',失败 ' + failed);
  server.close();
  try { fs.rmSync(TMP_DB, { force: true }); } catch (e) {}
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('测试崩溃:', e); process.exit(1); });
