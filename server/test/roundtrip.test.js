'use strict';
/* =====================================================
   鉴权 + 账户隔离 + 单用户往返一致性测试(真实 HTTP + 临时库,无测试框架)
   核心不变量:登录某账户后 PUT 进去的本人数树,GET 出来必须深度相等;
   任何账户的读写都不得影响其他账户(数据、rev、库)。
   服务器规范化约定:补齐 6 个集合字段(meals/workouts/body/habits/sleep/water)
   与 theme 默认值;composeUser 恒带 id 键(值 = 服务端 uid)。
   运行:node test/roundtrip.test.js
   ===================================================== */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* 临时数据库,必须在 require('../server') 之前设置 */
const TMP_DB = path.join(os.tmpdir(), 'wefit-test-' + process.pid + '.db');
try { fs.rmSync(TMP_DB, { force: true }); } catch (e) {}
process.env.DB_PATH = TMP_DB;

const { start } = require('../server');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8'));
/* 睡眠形状契约仍唯一来源于前端目录（服务端 mapper 也 require 它），测试不另拄上限 */
const { SLEEP_MAX_SEGS } = require('../../public/js/sleep-shape.js');
/* 同步切片契约（v4.20）同样在前端目录：用它做「逐片写 == 客户端 writeSlice」的对账 */
const SL = require('../../public/js/slices.js');
/* 系统库种子条数不写死：断言「新账户个人库 = 当前种子」，种子增删后测试不再漂移 */
const { SEED_FOODS, SEED_EXERCISES } = require('../../public/js/seed-data.js');

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
/* 规范化期望值:服务端补齐 6 个集合字段、id 恒为服务端 uid */
function normalizeExpected(state, uid) {
  const out = JSON.parse(JSON.stringify(state));
  for (const id of Object.keys(out.users)) {
    const u = out.users[id];
    if (u.meals === undefined) u.meals = {};
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
  const { server, port, db: srvDb } = await start({ port: 0, quiet: true });
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
  r = await anon.req('POST', '/api/register', { username: 'alice', password: '123', name: '爱丽丝' });
  ok('T3b 密码过短→400', r.status === 400);
  r = await anon.req('POST', '/api/register', { username: 'alice', password: 'secret123' });
  ok('T3c 昵称缺失→400', r.status === 400);

  r = await A.req('POST', '/api/register', { username: 'alice', password: 'secret123', name: '爱丽丝' });
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
  ok('T7a 新账户 state:rev=0+个人库初始为空(不自动导入系统库)', r.status === 200 && r.json.rev === 0
    && r.json.data && r.json.data.shared.foods.length === 0 && r.json.data.shared.exercises.length === 0
    && Object.keys(r.json.data.users).length === 1, JSON.stringify(r.json).slice(0, 160));
  uidA = Object.keys(r.json.data.users)[0];
  /* 空个人库 ≠ 空系统库：系统库本身仍是完整种子（新用户要条目走「＋我的库」挑入） */
  r = await A.req('GET', '/api/system/library');
  ok('T7a2 同一时刻系统库仍为完整种子', r.status === 200
    && r.json.foods.length === SEED_FOODS.length && r.json.exercises.length === SEED_EXERCISES.length,
    (r.json.foods || []).length + '/' + (r.json.exercises || []).length);

  const stateA = { theme: 'dark', onboarded: true, shared: fixture.shared, users: { [uidA]: fixture.users.u_alice }, active: uidA };
  r = await A.req('PUT', '/api/state', { data: stateA });
  ok('T8a 盲写→rev:1', r.status === 200 && r.json.rev === 1, JSON.stringify(r.json));
  r = await A.req('GET', '/api/state');
  const expA = normalizeExpected(stateA, uidA);
  ok('T8b GET→与 PUT 深度一致(边界形状)', r.status === 200 && r.json.rev === 1 && deepEq(expA, r.json.data), LAST_FAIL || JSON.stringify(r.json).slice(0, 200));
  /* T8b 的 sleep 段缺 wake/quality（2026-09-02）与同日多段（09-01/09-03）验证了多段数组的键缺失+seq 保真 */

  r = await A.req('PUT', '/api/state', { rev: 0, data: stateA });
  ok('T9a 过期rev→409', r.status === 409 && r.json.error === 'rev_conflict' && r.json.rev === 1, JSON.stringify(r.json));
  r = await A.req('GET', '/api/state');
  ok('T9b 409 后数据未变', r.json.rev === 1 && deepEq(expA, r.json.data), LAST_FAIL);

  r = await A.req('PUT', '/api/state', { rev: 99, data: stateA });
  ok('T10a 未来rev→409', r.status === 409);
  r = await A.req('PUT', '/api/state', { data: stateA });
  ok('T10b 缺省rev→盲写成功 rev:2', r.status === 200 && r.json.rev === 2);

  /* 替换语义:第二次写入覆盖第一次 */
  const small = { theme: 'light', onboarded: false, shared: { foods: [{ id: 'f0', name: '米饭', per100: { kcal: 116, p: 2.6, c: 25.9, f: 0.3 } }], exercises: [{ id: 'e0', name: '卧推', cat: '力量', muscle: '胸', mode: 'reps' }] }, users: { [uidA]: { id: uidA, name: '爱丽丝', body: [{ date: '2026-01-01', weight: 70 }] } }, active: uidA };
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
    && r.json.data.shared.foods.length === 0 && Object.keys(r.json.data.users).length === 1, JSON.stringify(r.json).slice(0, 120));
  uidB = Object.keys(r.json.data.users)[0];
  const snapshotB = JSON.stringify(r.json);
  ok('T13b B 看不到 A 的任何数据', snapshotB.indexOf('爱丽丝') < 0 && snapshotB.indexOf('u_alice') < 0
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

  /* v4.12 新增 users.home_order_json（概览卡片拖动顺序）：新列写入→读出保真；
   * 且「键缺失 vs 空数组」都必须原样往返（replaceUser 用 jz、composeUser 用 put，不可用 || [] 之类抹平） */
  const withHO = JSON.parse(JSON.stringify(small));
  withHO.users[uidA].homeOrder = ['habits', 'sleep', 'water', 'workout', 'diet'];
  let hoRev = (await A.req('GET', '/api/state')).json.rev;
  r = await A.req('PUT', '/api/state', { rev: hoRev, data: withHO });
  ok('T14d homeOrder 落库 → rev+1', r.status === 200 && r.json.rev === hoRev + 1, JSON.stringify(r.json).slice(0, 120));
  r = await A.req('GET', '/api/state');
  ok('T14e homeOrder 原序读出（新列不是只写不读）',
     deepEq(normalizeExpected(withHO, uidA), r.json.data)
     && JSON.stringify(r.json.data.users[uidA].homeOrder) === JSON.stringify(withHO.users[uidA].homeOrder),
     LAST_FAIL || JSON.stringify(r.json.data.users[uidA].homeOrder));
  const emptyHO = JSON.parse(JSON.stringify(withHO));
  emptyHO.users[uidA].homeOrder = [];
  r = await A.req('PUT', '/api/state', { data: emptyHO });
  r = await A.req('GET', '/api/state');
  ok('T14f 空数组也保真（不被 || [] 一类的写法吃掉）',
     Array.isArray(r.json.data.users[uidA].homeOrder) && r.json.data.users[uidA].homeOrder.length === 0,
     JSON.stringify(r.json.data.users[uidA].homeOrder));
  const noHO = JSON.parse(JSON.stringify(withHO));
  delete noHO.users[uidA].homeOrder;
  r = await A.req('PUT', '/api/state', { data: noHO });
  r = await A.req('GET', '/api/state');
  ok('T14g 树里无 homeOrder 键 → 读回也不凭空多出该键',
     !('homeOrder' in r.json.data.users[uidA]) && deepEq(normalizeExpected(noHO, uidA), r.json.data), LAST_FAIL);

  /* 2026-09-12（未标版号）新增 users.body_hidden_json（身体页隐藏项 = 显示项开关的反面）：
     与 homeOrder 完全同一套读写（jz / put），所以形状谱系也一致：数组保真、空数组保真、键缺失不多出 */
  const withBH = JSON.parse(JSON.stringify(noHO));
  withBH.users[uidA].bodyHidden = ['calf', 'dbp'];
  let bhRev = (await A.req('GET', '/api/state')).json.rev;
  r = await A.req('PUT', '/api/state', { rev: bhRev, data: withBH });
  ok('T14i bodyHidden 落库 → rev+1', r.status === 200 && r.json.rev === bhRev + 1, JSON.stringify(r.json).slice(0, 120));
  r = await A.req('GET', '/api/state');
  ok('T14j bodyHidden 原序读出（新列不是只写不读）',
     deepEq(normalizeExpected(withBH, uidA), r.json.data)
     && JSON.stringify(r.json.data.users[uidA].bodyHidden) === JSON.stringify(['calf', 'dbp']),
     LAST_FAIL || JSON.stringify(r.json.data.users[uidA].bodyHidden));
  const emptyBH = JSON.parse(JSON.stringify(withBH));
  emptyBH.users[uidA].bodyHidden = [];
  r = await A.req('PUT', '/api/state', { data: emptyBH });
  r = await A.req('GET', '/api/state');
  ok('T14k bodyHidden 空数组（= 全部显示）也保真',
     Array.isArray(r.json.data.users[uidA].bodyHidden) && r.json.data.users[uidA].bodyHidden.length === 0,
     JSON.stringify(r.json.data.users[uidA].bodyHidden));
  const noBH = JSON.parse(JSON.stringify(emptyBH));
  delete noBH.users[uidA].bodyHidden;
  r = await A.req('PUT', '/api/state', { data: noBH });
  r = await A.req('GET', '/api/state');
  ok('T14l 树里无 bodyHidden 键 → 读回也不凭空多出该键',
     !('bodyHidden' in r.json.data.users[uidA]) && deepEq(normalizeExpected(noBH, uidA), r.json.data), LAST_FAIL);

  /* 2026-09-12（未标版号）新增 users.chart_order_json（历史页图表卡拖动顺序）：
     同样走 jz / put，三种形状（有值 / 空数组 / 键缺失）都得保真 */
  const withCO = JSON.parse(JSON.stringify(noBH));
  withCO.users[uidA].chartOrder = ['water', 'weight', 'sleep', 'cal', 'macro', 'vol', 'mins'];
  let coRev = (await A.req('GET', '/api/state')).json.rev;
  r = await A.req('PUT', '/api/state', { rev: coRev, data: withCO });
  ok('T14m chartOrder 落库 → rev+1', r.status === 200 && r.json.rev === coRev + 1, JSON.stringify(r.json).slice(0, 120));
  r = await A.req('GET', '/api/state');
  ok('T14n chartOrder 原序读出（新列不是只写不读）',
     deepEq(normalizeExpected(withCO, uidA), r.json.data)
     && JSON.stringify(r.json.data.users[uidA].chartOrder) === JSON.stringify(withCO.users[uidA].chartOrder),
     LAST_FAIL || JSON.stringify(r.json.data.users[uidA].chartOrder));
  const emptyCO = JSON.parse(JSON.stringify(withCO));
  emptyCO.users[uidA].chartOrder = [];
  r = await A.req('PUT', '/api/state', { data: emptyCO });
  r = await A.req('GET', '/api/state');
  ok('T14o chartOrder 空数组也保真',
     Array.isArray(r.json.data.users[uidA].chartOrder) && r.json.data.users[uidA].chartOrder.length === 0,
     JSON.stringify(r.json.data.users[uidA].chartOrder));
  const noCO = JSON.parse(JSON.stringify(emptyCO));
  delete noCO.users[uidA].chartOrder;
  r = await A.req('PUT', '/api/state', { data: noCO });
  r = await A.req('GET', '/api/state');
  ok('T14p 树里无 chartOrder 键 → 读回也不凭空多出该键',
     !('chartOrder' in r.json.data.users[uidA]) && deepEq(normalizeExpected(noCO, uidA), r.json.data), LAST_FAIL);

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
  ok('T15g 新注册者个人库为空(含系统库新条目也不导入)', r.status === 200
    && r.json.data.shared.foods.length === 0 && r.json.data.shared.exercises.length === 0,
    JSON.stringify(r.json.data.shared).slice(0, 120));
  /* 系统库更新不追溯已注册用户 */
  r = await B.req('GET', '/api/state');
  ok('T15h 已注册用户个人库不受系统库更新影响', !r.json.data.shared.foods.some(f => f.name === '管理员新菜'));
  /* v4.3 回归：合法 JSON 但非对象 body → 400（旧版 readJson 让请求永无响应、连接挂死） */
  r = await anon.req('POST', '/api/login', 'null');
  ok('T15i body=null→400 不挂死', r.status === 400 && r.json.error === 'invalid_json_body');
  /* v4.3 回归：系统库超限 → 显式 400（旧版静默截断到 5000 还回 200，admin 端丢草稿） */
  const hugeFoods = Array.from({ length: 5001 }, (_, i) => ({ name: 'f' + i }));
  r = await A.req('PUT', '/api/system/library', { foods: hugeFoods, exercises: [] });
  ok('T15j 系统库超5000→400 library_too_large', r.status === 400 && r.json.error === 'library_too_large');

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
  /* v4.7：睡眠形状契约文件靠 STATIC_FILES 显式映射托管。漏了这条映射不会让任何服务端测试变红，
   * 但浏览器里 normalizeSleepDay 未定义、整个睡眠 UI 直接崩，故在此钉住 */
  r = await anon.req('GET', '/js/sleep-shape.js');
  ok('T17f sleep-shape.js→js', r.status === 200 && r.headers.get('content-type').includes('javascript'));
  /* v4.20：同步切片契约文件同样靠 STATIC_FILES 显式映射托管（漏了映射服务端不报错，
   * 但浏览器里 sliceKeysOf/writeSlice 未定义，整个按片同步直接崩） */
  r = await anon.req('GET', '/js/slices.js');
  ok('T17f2 slices.js→js', r.status === 200 && r.headers.get('content-type').includes('javascript'));
  r = await anon.req('GET', '/');
  ok('T17f3 index.html 在 app.js 前加载 slices.js（在 sleep-shape.js 之后）',
    r.text.includes('js/slices.js')
    && r.text.indexOf('js/sleep-shape.js') < r.text.indexOf('js/slices.js')
    && r.text.indexOf('js/slices.js') < r.text.indexOf('js/app.js'));
  /* 种子数据本体改由 seed-data.json 承载：浏览器经同步 XHR 读取，漏映射会直接丢种子 */
  r = await anon.req('GET', '/js/seed-data.json');
  ok('T17h seed-data.json→json 且含 foods/exercises', r.status === 200 && r.headers.get('content-type').includes('application/json')
    && (() => { try { const j = JSON.parse(r.text); return Array.isArray(j.foods) && Array.isArray(j.exercises); } catch (e) { return false; } })(), r.headers.get('content-type'));
  r = await anon.req('GET', '/');
  ok('T17g index.html 在 app.js 前加载 sleep-shape.js',
    r.text.includes('js/sleep-shape.js') && r.text.indexOf('js/sleep-shape.js') < r.text.indexOf('js/app.js'));
  r = await anon.req('GET', '/server.js');
  ok('T17d 目录外路径→404', r.status === 404);
  r = await B.req('GET', '/api/nope');
  ok('T17e 已登录未知API→404', r.status === 404);

  /* ============ 规模压测(重新登录 A;单人数树) ============ */
  r = await A.req('POST', '/api/login', { username: 'alice', password: 'secret123' });
  ok('T18a 重新登录', r.status === 200);

  /* v4.7 审查回归：脏睡眠形状必须被归一化到规范形状，而不是把 PUT 打成 500、
   * 或“存一半写一半”让 PUT≠GET（旧版：[null] 直接 TypeError；{t:{}} 绑不进 SQLite；
   * ["x"] 存成 [{}]；空数组存不进去但 GET 丢键） */
  const junk = { theme: 'light', onboarded: true, shared: { foods: [], exercises: [] },
    users: { [uidA]: { id: uidA, name: '爱丽丝', sleep: {
      '2026-01-01': [null, { t: 'nap', bed: '13:00', wake: '13:30', mins: 30, quality: 4 }],     // 脏元素丢，同其余段下标前移
      '2026-01-02': [{ t: { a: 1 }, bed: '23:00', wake: { h: 1 }, mins: '480', quality: 3 }],   // 类型不符的字段丢键
      '2026-01-03': 'x',                                                                          // 标量整天丢
      '2026-01-04': [],                                                                           // 空数组 = 无记录，不留幽灵键
      '2026-01-05': {},                                                                           // 空对象 = 同上
      '2026-01-06': [{ t: 'meditation', mins: 20 }],                                             // 未知类型原样保真
    } } }, active: uidA };
  r = await A.req('PUT', '/api/state', { data: junk });
  ok('T18m1 脏睡眠形状→200 不 500', r.status === 200, JSON.stringify(r.json).slice(0, 120));
  r = await A.req('GET', '/api/state');
  const gotSleep = (r.json.data.users[uidA] || {}).sleep || {};
  ok('T18m2 脏元素丢弃后其余段保序保真', JSON.stringify(gotSleep['2026-01-01']) ===
    JSON.stringify([{ t: 'nap', bed: '13:00', wake: '13:30', mins: 30, quality: 4 }]), JSON.stringify(gotSleep['2026-01-01']));
  ok('T18m3 类型不符字段丢键', JSON.stringify(gotSleep['2026-01-02']) ===
    JSON.stringify([{ bed: '23:00', quality: 3 }]), JSON.stringify(gotSleep['2026-01-02']));
  ok('T18m4 标量/空数组/空对象三类都不留键',
    !('2026-01-03' in gotSleep) && !('2026-01-04' in gotSleep) && !('2026-01-05' in gotSleep),
    JSON.stringify(Object.keys(gotSleep)));
  ok('T18m5 未知类型不篡改不丢弃', JSON.stringify(gotSleep['2026-01-06']) ===
    JSON.stringify([{ t: 'meditation', mins: 20 }]), JSON.stringify(gotSleep['2026-01-06']));

  /* 单日段数上限：显式 400（不静默截断），且整笔写入作废 */
  const over = JSON.parse(JSON.stringify(junk));
  over.users[uidA].sleep = { '2026-02-01': Array.from({ length: SLEEP_MAX_SEGS + 1 }, (_, i) => ({ t: 'rest', mins: i + 1 })) };
  r = await A.req('PUT', '/api/state', { data: over });
  ok('T18n1 单日超 ' + SLEEP_MAX_SEGS + ' 段→400', r.status === 400 && r.json.error === 'sleep_too_many_segments', JSON.stringify(r.json).slice(0, 120));
  r = await A.req('GET', '/api/state');
  ok('T18n2 被拒后原数据一字未改', deepEq(gotSleep, r.json.data.users[uidA].sleep), LAST_FAIL);
  const atLimit = JSON.parse(JSON.stringify(junk));
  atLimit.users[uidA].sleep = { '2026-02-01': Array.from({ length: SLEEP_MAX_SEGS }, (_, i) => ({ t: 'rest', mins: i + 1 })) };
  r = await A.req('PUT', '/api/state', { data: atLimit });
  ok('T18n3 正好在上限内→接受', r.status === 200, JSON.stringify(r.json).slice(0, 120));

  const curRev = (await A.req('GET', '/api/state')).json.rev;
  const u = {
    id: uidA, name: '大数据', avatar: '🦁', color: 'orange',
    profile: { gender: 'male', birthYear: 1990, height: 180, currentKg: 80 },
    goal: { mode: 'keep', startKg: 80, targetKg: 80, targetDate: '2027-01-01', note: '' },
    activity: 1.2, waterTarget: 8,
    nutrition: { auto: false, kcal: 2000, protein: 120, carbs: 250, fat: 60 },
    meals: {}, workouts: [], body: [], habits: [{ id: 'h1', name: '习惯', icon: '🔥', color: 'var(--cat1)', done: {} }],
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
    u.sleep[d] = [{ t: 'night', bed: '23:0' + (i % 10), wake: '07:00', mins: 480, quality: 1 + (i % 5) }];
    if (i % 2 === 0) u.sleep[d].push({ t: 'nap', bed: '13:00', wake: '13:30', mins: 30, quality: 4 });   /* 多段日的 seq 保序 */
    u.water[d] = i % 9;
    u.habits[0].done[d] = true;
  }
  for (let i = 0; i < 300; i++) u.body.push({ date: '2026-' + pad(1 + (i % 12)) + '-' + pad(1 + (i % 28)), weight: Math.round((80 - i * 0.013) * 10) / 10 });
  /* v4.12：一天一条（date 是主键），故日志用互不重复的日期；
   * v4.12：done 在每一项上——偶数日全勾，奇数日只勾第一项（部分完成也要往返保真） */
  const dayISO = i => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  for (let i = 0; i < 120; i++) {
    const full = i % 2 === 0;
    const run = { id: 'wj' + i, exId: 'e18', exName: '跑步', cat: '有氧', muscle: '全身', mins: 30 + (i % 20), km: Math.round((3 + i * 0.05) * 10) / 10 };
    if (full) run.done = true;   /* 假值不落键（服务端 NULL↔缺键），与客户端 normalize 同口径 */
    u.workouts.push({ id: 'w' + i, date: dayISO(i), name: '训' + i, items: [
      { id: 'wi' + i, exId: 'e0', exName: '卧推', cat: '力量', muscle: '胸', reps: 14, weight: 102.5, done: true },
      run,
    ] });
  }
  for (let i = 0; i < 8; i++) u.workouts.push({ id: 'p' + i, date: dayISO(200 + i), name: '计划' + i, items: [
    { id: 'pi' + i, exId: 'e0', exName: '卧推', cat: '力量', muscle: '胸', reps: 20, weight: 100 } ] });
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

  /* ============ v4.20 切片同步 ============
   * 核心不变量：逐片写的结果必须与「把同一片写进整树」的结果深度相等（前端 writeSlice 对账），
   * 否则整树客户端与切片客户端会互相把对方的数据洗掉。另守 CAS/删片/孤儿清理/兼容整树路径。
   * 用上面 T15f 注册的 carol（账户 C）——尚未登出，会话仍有效，与 A/B 数据互不干扰。 */
  r = await C.req('GET', '/api/state');
  ok('T19a 切片用例账户可读（carol 会话仍有效）', r.status === 200, JSON.stringify(r.json).slice(0, 120));
  const uidC = Object.keys(r.json.data.users)[0];
  const rev0 = r.json.rev;
  ok('T19b 未登录访问切片接口→401',
    (await anon.req('GET', '/api/slices')).status === 401 && (await anon.req('PUT', '/api/slices', { slices: {} })).status === 401);
  ok('T19c 整树响应带切片 manifest（新账户为空表）',
    r.json.slices && typeof r.json.slices === 'object' && Object.keys(r.json.slices).length === 0, JSON.stringify(r.json.slices));

  /* --- 逐片写：与客户端 writeSlice 对账 --- */
  const MEAL = { breakfast: [{ id: 'f1', name: '燕麦', per100: { kcal: 367, p: 13, c: 61, f: 7 }, g: 60 }], lunch: [], dinner: [], snack: [] };
  const expectTree = JSON.parse(JSON.stringify(r.json.data));
  SL.writeSlice(expectTree, 'meals:2026-09-13', MEAL);
  r = await C.req('PUT', '/api/slices', { slices: { 'meals:2026-09-13': { rev: 0, value: MEAL } } });
  ok('T19d 单片写入→200 + 新全局 rev + 该片 rev',
    r.status === 200 && r.json.rev === rev0 + 1 && r.json.slices['meals:2026-09-13'] === rev0 + 1, JSON.stringify(r.json));
  const revMeal = r.json.rev;
  r = await C.req('GET', '/api/state');
  ok('T19e 逐片写结果 == 客户端 writeSlice 的整树结果（防两侧漂移）', deepEq(expectTree, r.json.data), LAST_FAIL);
  ok('T19f manifest 记下该片新 rev，其余片不受影响',
    r.json.slices['meals:2026-09-13'] === revMeal && Object.keys(r.json.slices).length === 1);

  /* --- habits 定义 + 逐日打卡（两片） --- */
  r = await C.req('GET', '/api/state');
  const treeH = JSON.parse(JSON.stringify(r.json.data));
  const HABITS = [{ id: 'h1', name: '饮水达标', icon: '💧', color: 'var(--cat1)' }, { id: 'h2', name: '拉伸', icon: '🧘', color: 'var(--brand)' }];
  SL.writeSlice(treeH, 'habits', HABITS);
  SL.writeSlice(treeH, 'habitdone:2026-09-13', { h1: true, h9: true });   /* h9 未定义 → 服务端应丢弃 */
  r = await C.req('PUT', '/api/slices', { slices: {
    habits: { rev: 0, value: HABITS },
    'habitdone:2026-09-13': { rev: 0, value: { h1: true, h9: true } },
  } });
  ok('T19g 批量两片一次写（同事务、同一新 rev）',
    r.status === 200 && r.json.slices.habits === r.json.rev && r.json.slices['habitdone:2026-09-13'] === r.json.rev, JSON.stringify(r.json));
  r = await C.req('GET', '/api/state');
  SL.writeSlice(treeH, 'habits', HABITS);                                  /* 对账前去掉 h9 的痕迹（服务端会丢） */
  ok('T19h 未定义习惯的打卡被丢弃，已定义的保留',
    JSON.stringify(r.json.data.users[uidC].habits.map(h => [h.id, Object.keys(h.done)])) ===
    JSON.stringify([['h1', ['2026-09-13']], ['h2', []]]), JSON.stringify(r.json.data.users[uidC].habits));
  ok('T19i habits 片与客户端 writeSlice 结果一致（定义+按 id 保留的打卡）', deepEq(treeH, r.json.data), LAST_FAIL);

  /* --- CAS：一片过期 → 整批不写 --- */
  const revWater = (await C.req('GET', '/api/state')).json.rev;
  r = await C.req('PUT', '/api/slices', { slices: { 'water:2026-09-13': { rev: 0, value: 6 } } });
  ok('T19j 新片以 rev 0 写入→200', r.status === 200 && r.json.slices['water:2026-09-13'] === revWater + 1, JSON.stringify(r.json));
  r = await C.req('PUT', '/api/slices', { slices: {
    'water:2026-09-13': { rev: 0, value: 99 },                        /* 过期（服务器已到 revWater+1） */
    'sleep:2026-09-13': { rev: 0, value: [{ t: 'night', bed: '23:30', wake: '07:00', mins: 450 }] },
  } });
  ok('T19k 任一片过期→409，冲突片带当前 rev 与现值（供客户端直接裁决）',
    r.status === 409 && r.json.error === 'rev_conflict' && r.json.conflicts['water:2026-09-13']
    && r.json.conflicts['water:2026-09-13'].rev === revWater + 1 && r.json.conflicts['water:2026-09-13'].value === 6
    && !r.json.conflicts['sleep:2026-09-13'], JSON.stringify(r.json));
  r = await C.req('GET', '/api/state');
  ok('T19l 整批作废：同批里没过期的 sleep 片也没被写进去',
    r.json.data.users[uidC].water['2026-09-13'] === 6 && !('2026-09-13' in (r.json.data.users[uidC].sleep || {})));

  /* --- 盲写（离线回线首推 / 用户明确选择覆盖） --- */
  r = await C.req('PUT', '/api/slices', { slices: { 'water:2026-09-13': { value: 7 } } });
  ok('T19m 不带 rev = 盲写，直接覆盖', r.status === 200 && (await C.req('GET', '/api/state')).json.data.users[uidC].water['2026-09-13'] === 7);

  /* --- 删片 --- */
  const revBeforeDel = (await C.req('GET', '/api/state')).json; 
  r = await C.req('PUT', '/api/slices', { slices: { 'water:2026-09-13': { rev: revBeforeDel.slices['water:2026-09-13'], value: null } } });
  ok('T19n 值 null = 删片→200', r.status === 200, JSON.stringify(r.json));
  r = await C.req('GET', '/api/state');
  const revAfterDel = r.json.rev;
  ok('T19o 删后整树无该键，且 manifest **保留该片并抬 rev**（客户端才判得出「服务器删了它」）',
    !('2026-09-13' in (r.json.data.users[uidC].water || {}))
    && r.json.slices['water:2026-09-13'] === revAfterDel, JSON.stringify(r.json.slices));

  /* --- since 短路 / keys 取片 --- */
  r = await C.req('GET', '/api/slices?since=' + revAfterDel);
  ok('T19p since ≥ 当前全局 rev → unchanged 短路（不带 manifest）',
    r.status === 200 && r.json.unchanged === true && Object.keys(r.json.slices).length === 0, JSON.stringify(r.json));
  r = await C.req('GET', '/api/slices?since=' + rev0);
  ok('T19q since 落后 → 回整份 manifest',
    r.status === 200 && !r.json.unchanged && r.json.slices['meals:2026-09-13'] === revMeal);
  r = await C.req('GET', '/api/slices?keys=' + encodeURIComponent('meals:2026-09-13,water:2026-09-13'));
  ok('T19r keys= 同时回 rev 与 values（缺片 → null）',
    r.status === 200 && r.json.values['meals:2026-09-13'].breakfast[0].name === '燕麦'
    && r.json.values['water:2026-09-13'] === null && r.json.slices['water:2026-09-13'] === revAfterDel, JSON.stringify(r.json).slice(0, 160));
  r = await C.req('GET', '/api/slices?keys=bogus');
  ok('T19s keys 含未知片→400', r.status === 400 && r.json.error === 'unknown_slice');
  /* keys 与 since 同时给：keys = 明确要值，优先于 since 短路（契约无歧义） */
  r = await C.req('GET', '/api/slices?since=' + revAfterDel + '&keys=' + encodeURIComponent('meals:2026-09-13'));
  ok('T19s2 keys 与 since 同给：keys 优先（仍回值，不被 unchanged 短路）',
    r.status === 200 && !r.json.unchanged && r.json.values['meals:2026-09-13'].breakfast[0].name === '燕麦',
    JSON.stringify(r.json).slice(0, 160));

  /* --- 形状护栏 --- */
  r = await C.req('PUT', '/api/slices', { slices: { 'nope:2026-09-13': { value: 1 } } });
  ok('T19t 未知片名→400 unknown_slice', r.status === 400 && r.json.error === 'unknown_slice');
  r = await C.req('PUT', '/api/slices', { slices: { 'water:2026-09-13': { value: '六杯' } } });
  ok('T19u 类型不符（饮水给字符串）→400（宁可报错不静默变形）', r.status === 400 && r.json.error === 'invalid_slice_value');
  r = await C.req('PUT', '/api/slices', { slices: { 'water:2026-09-13': { value: 1, rev: 'x' } } });
  ok('T19v rev 非数字→400（绝不降级成盲写）', r.status === 400 && r.json.error === 'invalid_slice_rev');
  const many = {};
  for (let i = 0; i < 501; i++) {   /* 501 个互不相同的日期片（同一天只能一片） */
    many['water:' + new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)] = { value: i };
  }
  r = await C.req('PUT', '/api/slices', { slices: many });
  ok('T19w 单次超 500 片→400 too_many_slices（不是静默丢弃）', r.status === 400 && r.json.error === 'too_many_slices', JSON.stringify(r.json).slice(0, 120));
  r = await C.req('PUT', '/api/slices', { slices: { 'sleep:2026-09-13': { value: Array.from({ length: SLEEP_MAX_SEGS + 1 }, (_, i) => ({ t: 'rest', mins: i + 1 })) } } });
  ok('T19x 单日睡眠超上限→400（与整树路径同一上限）', r.status === 400 && r.json.error === 'sleep_too_many_segments');

  /* --- 孤儿打卡：写入侧存着（定义可能后到），读侧与整树同口径（只回已定义习惯） --- */  /* --- 孤儿打卡：写入侧存着（定义可能后到），读侧与整树同口径（只回已定义习惯） --- */
  r = await C.req('GET', '/api/state');
  const revHb = r.json.slices.habits || 0;
  r = await C.req('PUT', '/api/slices', { slices: {
    'habitdone:2026-09-13': { value: { h1: true, h_ghost: true } },   /* h_ghost 未定义 */
  } });
  ok('T19E 未定义习惯的打卡写入→200（存着，不静默丢）', r.status === 200, JSON.stringify(r.json).slice(0, 120));
  r = await C.req('GET', '/api/slices?keys=' + encodeURIComponent('habitdone:2026-09-13'));
  ok('T19F 读侧只回已定义习惯的打卡：与整树读同形状（h_ghost 不出现）',
    JSON.stringify(r.json.values['habitdone:2026-09-13']) === JSON.stringify({ h1: true }),
    JSON.stringify(r.json.values));
  r = await C.req('GET', '/api/state');
  const habitDoneTree = (r.json.data.users[uidC].habits || []).map(h => [h.id, Object.keys(h.done)]).sort();
  ok('T19G 整树读同样看不到孤儿打卡（两路一致；此时定义里还有 h2，它的打卡为空）',
    JSON.stringify(habitDoneTree) === JSON.stringify([['h1', ['2026-09-13']], ['h2', []]]), JSON.stringify(habitDoneTree));

  /* --- lib 片（个人库两份 JSON）逐片写 == 客户端 writeSlice：users 行列映射同源（防两份手抄漂移） --- */
  r = await C.req('GET', '/api/state');
  const tLib = JSON.parse(JSON.stringify(r.json.data));
  const LIB = { foods: [{ id: 'f9', name: '测试食物', per100: { kcal: 1 } }], exercises: [{ id: 'e9', name: '测试动作', cat: '力量' }] };
  SL.writeSlice(tLib, 'lib', LIB);
  r = await C.req('PUT', '/api/slices', { slices: { lib: { rev: r.json.slices.lib || 0, value: LIB } } });
  ok('T19C lib 片写入→200', r.status === 200, JSON.stringify(r.json).slice(0, 120));
  r = await C.req('GET', '/api/state');
  ok('T19D lib 片逐片写结果 == 客户端 writeSlice（users 行的库列映射同源）',
    deepEq(tLib, r.json.data) && r.json.data.shared.foods[0].name === '测试食物', LAST_FAIL);

  /* --- habits 改写时的孤儿打卡清理（不能顺手抹掉别人的打卡） --- */
  r = await C.req('GET', '/api/state');
  const revHab = r.json.slices.habits;
  r = await C.req('PUT', '/api/slices', { slices: { habits: { rev: revHab, value: [{ id: 'h1', name: '饮水达标', icon: '💧', color: 'var(--cat1)' }] } } });
  ok('T19y 删掉 h2 定义→200', r.status === 200, JSON.stringify(r.json));
  r = await C.req('GET', '/api/state');
  ok('T19z 孤儿打卡随定义删除消失，h1 的打卡完好',
    JSON.stringify(r.json.data.users[uidC].habits.map(h => [h.id, Object.keys(h.done)])) === JSON.stringify([['h1', ['2026-09-13']]]),
    JSON.stringify(r.json.data.users[uidC].habits));

  /* --- 兼容：整树 PUT（老客户端/备份导入）把**所有已知片**抬到新全局 rev --- */
  r = await C.req('GET', '/api/state');
  const legacyRev = r.json.rev;
  const legacyTree = r.json.data;
  r = await C.req('PUT', '/api/state', { rev: legacyRev, data: legacyTree });
  const newRev = r.json.rev;
  r = await C.req('GET', '/api/state');
  const known = Object.keys(r.json.slices);
  ok('T19A 整树 PUT 后：所有已知片（含已删的 water 片）rev 全部抬到新全局 rev',
    known.length >= 3 && known.every(k => r.json.slices[k] === newRev) && r.json.slices['water:2026-09-13'] === newRev, JSON.stringify(r.json.slices));
  r = await C.req('GET', '/api/slices?since=' + newRev);
  ok('T19B 抬完 rev 后 since 短路仍成立（不会让按片客户端反复重拉）', r.json.unchanged === true, JSON.stringify(r.json));

  /* --- B1：整树 PUT 删掉一天，也必须给这一天立墓碑 ——
   * 场景 = v4.20 之前的老账户（user_slices 表为空）+ 老客户端整树写删数据：
   * 旧写法只抬「表里已有行」和「新树里出现」的片，被删的这天两边都不在 → 没墓碑 →
   * 按片客户端永远不知道它被删了，之后还会以 rev 0 通过 CAS 把它复活。 */
  r = await C.req('GET', '/api/state');
  const treeB1 = JSON.parse(JSON.stringify(r.json.data));
  treeB1.users[uidC].meals['2026-09-20'] = { breakfast: [{ id: 'bx', name: '墓碑饭', g: 100 }], lunch: [], dinner: [], snack: [] };
  treeB1.users[uidC].water['2026-09-20'] = 3;
  r = await C.req('PUT', '/api/state', { rev: r.json.rev, data: treeB1 });
  ok('B1a 整树写先造出这天', r.status === 200);
  r = await C.req('GET', '/api/state');
  const revB1 = r.json.rev;
  const tombMeals = r.json.slices['meals:2026-09-20'], tombWater = r.json.slices['water:2026-09-20'];
  /* 模拟「老账户」：把用户切片表清空（老客户端 + v4.20 前的库就是这个状态），再整树删掉这天 */
  srvDb.exec('DELETE FROM user_slices');
  const treeB1b = JSON.parse(JSON.stringify(treeB1));
  delete treeB1b.users[uidC].meals['2026-09-20'];
  delete treeB1b.users[uidC].water['2026-09-20'];
  r = await C.req('PUT', '/api/state', { rev: revB1, data: treeB1b });
  ok('B1b 表清空后整树写删除这天→200', r.status === 200);
  const revB1b = r.json.rev;
  r = await C.req('GET', '/api/state');
  ok('B1c 被删的这天留下了**墓碑**（manifest 里仍有该片，且 rev 抬到新全局 rev）',
    r.json.slices['meals:2026-09-20'] === revB1b && r.json.slices['water:2026-09-20'] === revB1b,
    'slices=' + JSON.stringify(r.json.slices).slice(0, 200));
  ok('B1d 墓碑片读出来是「没有这一片」（值 null），按片客户端据此删掉本机那一份',
    typeof tombMeals === 'number' && typeof tombWater === 'number'
    && !r.json.data.users[uidC].meals['2026-09-20'] && r.json.data.users[uidC].water['2026-09-20'] === undefined);

  console.log('---');
  console.log(failed === 0
    ? '全部通过:' + passed + ' 项断言(鉴权 + 双账户隔离 + 系统库权限 + 真实规模往返 put ' + putMs + 'ms / get ' + getMs + 'ms)'
    : '通过 ' + passed + ',失败 ' + failed);
  server.close();
  try { fs.rmSync(TMP_DB, { force: true }); } catch (e) {}
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('测试崩溃:', e); process.exit(1); });
