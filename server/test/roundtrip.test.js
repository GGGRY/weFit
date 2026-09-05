'use strict';
/* =====================================================
   鉴权 + 账户隔离 + 单用户往返一致性测试(真实 HTTP + 临时库,无测试框架)
   核心不变量:登录某账户后 PUT 进去的本人数树,GET 出来必须深度相等;
   任何账户的读写都不得影响其他账户(数据、rev、库)。
   服务器规范化约定:补齐 7 个集合字段(meals/plans/workouts/body/habits/sleep/water)
   与 theme 默认值;composeUser 恒带 id 键(值 = 服务端 uid)。
   运行:node test/roundtrip.test.js
   ===================================================== */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* 临时数据库,必须在 require('../server') 之前设置 */
const TMP_DB = path.join(os.tmpdir(), 'jjhealth-test-' + process.pid + '.db');
try { fs.rmSync(TMP_DB, { force: true }); } catch (e) {}
process.env.DB_PATH = TMP_DB;

const { start } = require('../server');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8'));

/* ---------- 深度相等比较(数组讲顺序,对象讲键集合,失败报路径) ---------- */
function deepEq(a, b, p) {
  p = p || '$';
  if (a === b) return true;
  if (typeof a !== typeof b) return fail(p, 'type ' + typeof a + ' vs ' + typeof b);
  if (a === null || b === null) return fail(p, String(a) + ' vs ' + String(b));
  if (typeof a !== 'object') return fail(p, String(a) + ' vs ' + String(b));
  if (Array.isArray(a) !== Array.isArray(b)) return fail(p, 'array vs object');
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length || ka.some(k => !kb.includes(k))) {
    const missing = ka.filter(k => !kb.includes(k)).map(k => p + '.' + k + '(丢失)')
      .concat(kb.filter(k => !ka.includes(k)).map(k => p + '.' + k + '(多出)'));
    return fail(p, '键不一致: ' + missing.join(', '));
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) return fail(p, '长度 ' + a.length + ' vs ' + b.length);
    for (let i = 0; i < a.length; i++) if (!deepEq(a[i], b[i], p + '[' + i + ']')) return false;
    return true;
  }
  for (const k of ka) if (!deepEq(a[k], b[k], p + '.' + k)) return false;
  return true;
}
let LAST_FAIL = '';
function fail(p, msg) { LAST_FAIL = p + ': ' + msg; return false; }

/* ---------- 测试骨架 ---------- */
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('[PASS] ' + name); }
  else { failed++; console.log('[FAIL] ' + name + (detail ? '  →  ' + detail : '')); }
}
/* 规范化期望值:服务端补齐 7 个集合字段、id 恒为服务端 uid */
function normalizeExpected(state, uid) {
  const out = JSON.parse(JSON.stringify(state));
  for (const id of Object.keys(out.users)) {
    const u = out.users[id];
    if (u.meals === undefined) u.meals = {};
    if (u.plans === undefined) u.plans = {};
    if (u.workouts === undefined) u.workouts = [];
    if (u.body === undefined) u.body = [];
    if (u.habits === undefined) u.habits = [];
    if (u.sleep === undefined) u.sleep = {};
    if (u.water === undefined) u.water = {};
    if (id === uid) u.id = uid;
  }
  return out;
}

async function main() {
  const { server, port } = await start({ port: 0, quiet: true });
  const base = 'http://127.0.0.1:' + port;

  /* 简易 cookie jar:一个"浏览器"= 一个账户会话 */
  function makeJar() {
    const c = { sid: null };
    const req = async (method, p, body, opt) => {
      opt = opt || {};
      const headers = {};
      if (c.sid && !opt.noCookie) headers.cookie = 'wefit_sid=' + c.sid;
      if (body !== undefined && !opt.rawJson) headers['Content-Type'] = 'application/json';
      const r = await fetch(base + p, {
        method, headers,
        body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      });
      const sc = r.headers.get('set-cookie');
      if (sc) {
        const m = sc.match(/wefit_sid=([^;]*)/);   /* 清 Cookie 时 token 为空 → null */
        if (m) c.sid = m[1] || null;
      }
      let json = null;
      try { json = await r.clone().json(); } catch (e) { /* 非 JSON 响应 */ }
      const text = await r.text();
      return { status: r.status, json, text, headers: r.headers };
    };
    return { req, jar: c };
  }
  const anon = makeJar();
  const A = makeJar();   /* alice = 第一个账户 = admin */
  const B = makeJar();   /* bob = 普通账户 */
  let uidA = null, uidB = null;

  /* ============ 鉴权 ============ */
  let r = await anon.req('GET', '/api/health');
  ok('T1 health(空库,公开)', r.status === 200 && r.json.ok === true && r.json.accounts === 0, JSON.stringify(r.json));

  r = await anon.req('GET', '/api/state');
  ok('T2a 未登录 GET /state→401', r.status === 401 && r.json.error === 'unauthorized');
  r = await anon.req('PUT', '/api/state', { data: fixture });
  ok('T2b 未登录 PUT /state→401', r.status === 401);
  r = await anon.req('POST', '/api/logout', {});
  ok('T2c 未登录 logout→401', r.status === 401);

  r = await anon.req('POST', '/api/register', { username: 'a', password: '123456', name: '短名' });
  ok('T3a 用户名过短→400', r.status === 400 && r.json.error === 'invalid_credentials', JSON.stringify(r.json));
  r = await anon.req('POST', '/api/register', { username: 'alice', password: '123', name: '陈' });
  ok('T3b 密码过短→400', r.status === 400);
  r = await anon.req('POST', '/api/register', { username: 'alice', password: 'secret123' });
  ok('T3c 昵称缺失→400', r.status === 400);

  r = await A.req('POST', '/api/register', { username: 'alice', password: 'secret123', name: '陈' });
  ok('T4a 注册成功→201+Cookie+admin', r.status === 201 && r.json.role === 'admin' && !!A.jar.sid, 'sid=' + A.jar.sid);
  r = await anon.req('POST', '/api/register', { username: 'alice', password: 'secret123', name: '撞名' });
  ok('T4b 用户名重复→409', r.status === 409 && r.json.error === 'username_taken');
  r = await B.req('POST', '/api/register', { username: 'bob', password: 'hunter456', name: '示例成员🐱' });
  ok('T4c 第二个账户 role=user', r.status === 201 && r.json.role === 'user' && !!B.jar.sid);

  const a1 = makeJar();
  r = await a1.req('POST', '/api/login', { username: 'alice', password: 'wrong-pass' });
  ok('T5a 错密登录→401', r.status === 401 && r.json.error === 'bad_credentials' && !a1.jar.sid);
  r = await a1.req('POST', '/api/login', { username: 'ghost', password: 'whatever1' });
  ok('T5b 不存在用户→同样401(不泄露)', r.status === 401);
  r = await a1.req('POST', '/api/login', { username: 'alice', password: 'secret123' });
  ok('T5c 正确登录→200+Cookie', r.status === 200 && !!a1.jar.sid);
  r = await a1.req('GET', '/api/me');
  ok('T6a GET /me→身份', r.status === 200 && r.json.username === 'alice' && r.json.role === 'admin', JSON.stringify(r.json));
  uidA = r.json.user && r.json.user.id;
  r = await a1.req('GET', '/api/me', undefined, { noCookie: true });
  ok('T6b 不带 Cookie 的 /me→401', r.status === 401);

  /* ============ 单用户往返 ============ */
  r = await A.req('GET', '/api/state');
  ok('T7a 新账户 state:rev=0+个人库=系统种子', r.status === 200 && r.json.rev === 0
    && r.json.data && r.json.data.shared.foods.length === 14 && r.json.data.shared.exercises.length === 18
    && Object.keys(r.json.data.users).length === 1, JSON.stringify(r.json).slice(0, 160));
  uidA = Object.keys(r.json.data.users)[0];

  const stateA = { theme: 'dark', onboarded: true, shared: fixture.shared, users: { [uidA]: fixture.users.u_alice }, active: uidA };
  r = await A.req('PUT', '/api/state', { data: stateA });
  ok('T8a 盲写→rev:1', r.status === 200 && r.json.rev === 1, JSON.stringify(r.json));
  r = await A.req('GET', '/api/state');
  const expA = normalizeExpected(stateA, uidA);
  ok('T8b GET→与 PUT 深度一致(边界形状)', r.status === 200 && r.json.rev === 1 && deepEq(expA, r.json.data), LAST_FAIL || JSON.stringify(r.json).slice(0, 200));

  r = await A.req('PUT', '/api/state', { rev: 0, data: stateA });
  ok('T9a 过期rev→409', r.status === 409 && r.json.error === 'rev_conflict' && r.json.rev === 1, JSON.stringify(r.json));
  r = await A.req('GET', '/api/state');
  ok('T9b 409 后数据未变', r.json.rev === 1 && deepEq(expA, r.json.data), LAST_FAIL);

  r = await A.req('PUT', '/api/state', { rev: 99, data: stateA });
  ok('T10a 未来rev→409', r.status === 409);
  r = await A.req('PUT', '/api/state', { data: stateA });
  ok('T10b 缺省rev→盲写成功 rev:2', r.status === 200 && r.json.rev === 2);

  /* 替换语义:第二次写入覆盖第一次 */
  const small = { theme: 'light', onboarded: false, shared: { foods: [{ id: 'f0', name: '米饭', per100: { kcal: 116, p: 2.6, c: 25.9, f: 0.3 } }], exercises: [{ id: 'e0', name: '卧推', muscle: '胸' }] }, users: { [uidA]: { id: uidA, name: '陈', body: [{ date: '2026-01-01', weight: 70 }] } }, active: uidA };
  r = await A.req('PUT', '/api/state', { rev: 2, data: small });
  ok('T11a 正确rev→rev:3', r.status === 200 && r.json.rev === 3);
  r = await A.req('GET', '/api/state');
  ok('T11b 本人子树替换+深度一致', deepEq(normalizeExpected(small, uidA), r.json.data)
    && r.json.data.shared.foods.length === 1, LAST_FAIL);

  /* 坏请求 */
  r = await A.req('PUT', '/api/state', '{ not json');
  ok('T12a 坏JSON→400', r.status === 400 && r.json.error === 'invalid_json');
  r = await A.req('PUT', '/api/state', { data: { junk: 1 } });
  ok('T12b 缺users/shared→400', r.status === 400 && r.json.error === 'invalid_state');
  r = await A.req('PUT', '/api/state', 'x', { rawJson: true });
  ok('T12c 缺Content-Type→415', r.status === 415 && r.json.error === 'json_required');
  r = await A.req('PUT', '/api/state', { data: { theme: 'light', onboarded: false, shared: { foods: [], exercises: [] }, users: { u_stranger: { id: 'u_stranger', name: '错位客户端' } }, active: 'u_stranger' } });
  ok('T12d 树缺本人键→400(护栏防盲写清空)', r.status === 400 && r.json.error === 'invalid_state', JSON.stringify(r.json));
  r = await A.req('GET', '/api/state');
  ok('T12e 护栏拒绝后本人数据无恙', r.json.rev === 3 && deepEq(normalizeExpected(small, uidA), r.json.data), LAST_FAIL);

  /* ============ 双账户隔离 ============ */
  r = await B.req('GET', '/api/state');
  ok('T13a B 的初始树与 A 无关', r.status === 200 && r.json.rev === 0 && r.json.data.theme === 'light'
    && r.json.data.shared.foods.length === 14 && Object.keys(r.json.data.users).length === 1, JSON.stringify(r.json).slice(0, 120));
  uidB = Object.keys(r.json.data.users)[0];
  const snapshotB = JSON.stringify(r.json);
  ok('T13b B 看不到 A 的任何数据', snapshotB.indexOf('陈') < 0 && snapshotB.indexOf('u_alice') < 0
    && snapshotB.indexOf(uidA) < 0, 'B树含A痕迹');

  /* 恶意:在 A 的合法树里塞 B 的 uid 键 */
  const poisoned = JSON.parse(JSON.stringify(small));
  poisoned.users[uidB] = { id: uidB, name: '被注入', body: [{ date: '2026-01-01', weight: 1 }] };
  r = await A.req('PUT', '/api/state', { rev: 3, data: poisoned });
  ok('T14a 含伪造他人键的 PUT 成功(键被忽略)', r.status === 200 && r.json.rev === 4, JSON.stringify(r.json));
  r = await B.req('GET', '/api/state');
  ok('T14b B 的数据与 rev 分毫未动', JSON.stringify(r.json) === snapshotB, LAST_FAIL || JSON.stringify(r.json).slice(0, 160));
  r = await A.req('GET', '/api/state');
  ok('T14c A 的树里也只有自己', Object.keys(r.json.data.users).length === 1 && r.json.data.active === uidA);

  /* ============ 系统库 ============ */
  r = await anon.req('GET', '/api/system/library');
  ok('T15a 未登录读系统库→401', r.status === 401);
  r = await B.req('PUT', '/api/system/library', { foods: [], exercises: [] });
  ok('T15b 普通用户 PUT 系统库→403', r.status === 403 && r.json.error === 'admin_only');
  r = await A.req('PUT', '/api/system/library', { foods: 'nope' });
  ok('T15c 系统库形状非法→400', r.status === 400 && r.json.error === 'invalid_library');
  r = await A.req('GET', '/api/system/library');
  const sys = r.json;
  const newFood = { name: '管理员新菜', per100: { kcal: 100, p: 5, c: 5, f: 5 } };
  r = await A.req('PUT', '/api/system/library', { foods: sys.foods.concat([newFood]), exercises: sys.exercises });
  ok('T15d admin PUT 系统库→200', r.status === 200 && r.json.ok === true);
  r = await B.req('GET', '/api/system/library');
  ok('T15e 其他登录者读到新系统库', r.status === 200 && r.json.foods.some(f => f.name === '管理员新菜'));
  const C = makeJar();
  r = await C.req('POST', '/api/register', { username: 'carol', password: 'pw123456', name: '新来的' });
  ok('T15f 注册成功', r.status === 201);
  r = await C.req('GET', '/api/state');
  ok('T15g 新注册者个人库含系统库新条目', r.json.data.shared.foods.some(f => f.name === '管理员新菜'));
  /* 系统库更新不追溯已注册用户 */
  r = await B.req('GET', '/api/state');
  ok('T15h 已注册用户个人库不受系统库更新影响', !r.json.data.shared.foods.some(f => f.name === '管理员新菜'));

  /* ============ 登出 ============ */
  r = await A.req('POST', '/api/logout', {});
  ok('T16a logout 清 Cookie', r.status === 200 && !A.jar.sid);
  r = await A.req('GET', '/api/state');
  ok('T16b 登出后 401', r.status === 401);
  /* 其他会话不受影响 */
  r = await B.req('GET', '/api/state');
  ok('T16c B 的会话仍有效', r.status === 200);

  /* ============ 静态托管与 404 ============ */
  r = await anon.req('GET', '/');
  ok('T17a GET/→HTML(登录页公开)', r.status === 200 && r.headers.get('content-type').includes('text/html') && r.text.includes('健康管理'));
  r = await anon.req('GET', '/css/style.css');
  ok('T17b style.css→text/css', r.status === 200 && r.headers.get('content-type').includes('text/css'));
  r = await anon.req('GET', '/js/app.js');
  ok('T17c app.js→js', r.status === 200 && r.headers.get('content-type').includes('javascript'));
  r = await anon.req('GET', '/server.js');
  ok('T17d 目录外路径→404', r.status === 404);
  r = await B.req('GET', '/api/nope');
  ok('T17e 已登录未知API→404', r.status === 404);

  /* ============ 规模压测(重新登录 A;单人数树) ============ */
  r = await A.req('POST', '/api/login', { username: 'alice', password: 'secret123' });
  ok('T18a 重新登录', r.status === 200);
  const curRev = (await A.req('GET', '/api/state')).json.rev;
  const u = {
    id: uidA, name: '大数据', avatar: '🦁', color: 'orange',
    profile: { gender: 'male', birthYear: 1990, height: 180, currentKg: 80 },
    goal: { mode: 'keep', startKg: 80, targetKg: 80, targetDate: '2027-01-01', note: '' },
    activity: 1.2, waterTarget: 8,
    nutrition: { auto: false, kcal: 2000, protein: 120, carbs: 250, fat: 60 },
    meals: {}, plans: { '1': { id: 'p1', name: '计划', items: [{ id: 'i1', exId: 'e0', exName: '卧推', muscle: '胸', sets: 5, reps: 5, weight: 100 }] } },
    workouts: [], body: [], habits: [{ id: 'h1', name: '习惯', icon: '🔥', color: 'var(--cat1)', done: {} }],
    sleep: {}, water: {},
  };
  const pad = n => String(n).padStart(2, '0');
  for (let i = 0; i < 700; i++) {
    const d = '2025-' + pad(1 + (i % 12)) + '-' + pad(1 + (i % 28));
    u.meals[d] = {
      breakfast: [{ id: 'mb' + i, name: '燕麦', per100: { kcal: 367, p: 13, c: 61, f: 7 }, g: 60 }],
      lunch: [{ id: 'ml' + i, name: '米饭', per100: { kcal: 116, p: 2.6, c: 25.9, f: 0.3 }, g: 200 },
        { id: 'mc' + i, name: '鸡胸', per100: { kcal: 118, p: 22, c: 0.6, f: 3 }, g: 150 }],
      dinner: [], snack: [],
    };
    u.sleep[d] = { bed: '23:0' + (i % 10), wake: '07:00', mins: 480, quality: 1 + (i % 5) };
    u.water[d] = i % 9;
    u.habits[0].done[d] = true;
  }
  for (let i = 0; i < 300; i++) u.body.push({ date: '2026-' + pad(1 + (i % 12)) + '-' + pad(1 + (i % 28)), weight: Math.round((80 - i * 0.013) * 10) / 10 });
  for (let i = 0; i < 120; i++) {
    u.workouts.push({ id: 'w' + i, date: '2026-' + pad(1 + (i % 12)) + '-' + pad(1 + (i % 28)), name: '训' + i, note: i % 3 ? '' : '备注', items: [
      { id: 'wi' + i, exId: 'e0', exName: '卧推', muscle: '胸', sets: [{ reps: 5, weight: 100 }, { reps: 5, weight: 102.5 }, { reps: 4, weight: 105 }] },
    ] });
  }
  const big = { theme: 'light', onboarded: true, shared: fixture.shared, users: { [uidA]: u }, active: uidA };
  const t0 = Date.now();
  r = await A.req('PUT', '/api/state', { rev: curRev, data: big });
  const putMs = Date.now() - t0;
  ok('T18b 大规模PUT(' + putMs + 'ms)', r.status === 200 && r.json.rev === curRev + 1, JSON.stringify(r.json).slice(0, 120));
  const t1 = Date.now();
  r = await A.req('GET', '/api/state');
  const getMs = Date.now() - t1;
  ok('T18c 大规模GET(' + getMs + 'ms)+深度一致', deepEq(normalizeExpected(big, uidA), r.json.data), LAST_FAIL);
  ok('T18d 规模耗时合理(put<3s, get<3s)', putMs < 3000 && getMs < 3000, 'put=' + putMs + 'ms get=' + getMs + 'ms');
  r = await B.req('GET', '/api/state');
  ok('T18e 压测后 B 仍完好', r.status === 200 && JSON.stringify(r.json) === snapshotB);

  console.log('---');
  console.log(failed === 0
    ? '全部通过:' + passed + ' 项断言(鉴权 + 双账户隔离 + 系统库权限 + 真实规模往返 put ' + putMs + 'ms / get ' + getMs + 'ms)'
    : '通过 ' + passed + ',失败 ' + failed);
  server.close();
  try { fs.rmSync(TMP_DB, { force: true }); } catch (e) {}
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('测试崩溃:', e); process.exit(1); });
