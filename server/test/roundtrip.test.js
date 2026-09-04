'use strict';
/* =====================================================
   往返一致性测试（真实 HTTP + 临时库，无测试框架）
   核心不变量：PUT 进去的数据，GET 出来必须深度相等。
   服务器有一个明确的规范化约定：每个成员补齐 7 个集合字段
   （meals/plans/workouts/body/habits/sleep/water）与 theme 默认值。
   运行：node test/roundtrip.test.js
   ===================================================== */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* 临时数据库，必须在 require('../server') 之前设置 */
const TMP_DB = path.join(os.tmpdir(), 'jjhealth-test-' + process.pid + '.db');
try { fs.rmSync(TMP_DB, { force: true }); } catch (e) {}
process.env.DB_PATH = TMP_DB;

const { start } = require('../server');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8'));

/* ---------- 深度相等比较（数组讲顺序，对象讲键集合，失败报路径） ---------- */
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
/* 规范化期望值：服务端会为每位成员补齐 7 个集合字段 */
function normalizeExpected(state) {
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
  }
  return out;
}

async function main() {
  const { server, port } = await start({ port: 0, quiet: true });
  const base = 'http://127.0.0.1:' + port;
  const req = async (method, p, body) => {
    const r = await fetch(base + p, {
      method,
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    });
    let json = null;
    try { json = await r.clone().json(); } catch (e) { /* 非 JSON 响应 */ }
    const text = await r.text();
    return { status: r.status, json, text, headers: r.headers };
  };

  /* T1-T2 空库 */
  let r = await req('GET', '/api/health');
  ok('T1 health(空库)', r.status === 200 && r.json.ok === true && r.json.rev === 0 && r.json.users === 0, JSON.stringify(r.json));
  r = await req('GET', '/api/state');
  ok('T2 state(空库)→data:null', r.status === 200 && r.json.rev === 0 && r.json.data === null, JSON.stringify(r.json));

  /* T3 盲写整棵 fixture */
  r = await req('PUT', '/api/state', { data: fixture });
  ok('T3 PUT→rev:1', r.status === 200 && r.json.rev === 1, JSON.stringify(r.json));

  /* T4 往返深度一致 —— 本测试的灵魂 */
  r = await req('GET', '/api/state');
  const exp4 = normalizeExpected(fixture);
  ok('T4 GET→与 PUT 深度一致', r.status === 200 && r.json.rev === 1 && deepEq(exp4, r.json.data), LAST_FAIL || JSON.stringify(r.json).slice(0, 200));

  /* T5 过期 rev → 409，且不改库 */
  r = await req('PUT', '/api/state', { rev: 0, data: fixture });
  ok('T5 过期rev→409', r.status === 409 && r.json.error === 'rev_conflict' && r.json.rev === 1, JSON.stringify(r.json));

  /* T6 正确 rev 写入第二份数据，旧数据彻底消失 */
  const small = {
    theme: 'light',
    onboarded: false,
    shared: { foods: [{ id: 'f0', name: '米饭', per100: { kcal: 116, p: 2.6, c: 25.9, f: 0.3 } }], exercises: [{ id: 'e0', name: '卧推', muscle: '胸' }] },
    users: { u_solo: { id: 'u_solo', name: '我', body: [{ date: '2026-01-01', weight: 70 }] } },
    active: 'u_solo',
  };
  r = await req('PUT', '/api/state', { rev: 1, data: small });
  ok('T6a 带正确rev→rev:2', r.status === 200 && r.json.rev === 2, JSON.stringify(r.json));
  r = await req('GET', '/api/state');
  ok('T6b 整库替换+深度一致', deepEq(normalizeExpected(small), r.json.data)
    && r.json.data.shared.foods.length === 1 && Object.keys(r.json.data.users).length === 1, LAST_FAIL);

  /* T7 盲写（不带 rev）永远成功 */
  r = await req('PUT', '/api/state', { rev: 99, data: small });
  ok('T7a 过期rev→409', r.status === 409);
  r = await req('PUT', '/api/state', { data: fixture });
  ok('T7b 缺省rev→盲写成功', r.status === 200 && r.json.rev === 3, JSON.stringify(r.json));

  /* T8 非法请求 */
  r = await req('PUT', '/api/state', '{ not json');
  ok('T8a 坏JSON→400', r.status === 400 && r.json.error === 'invalid_json');
  r = await req('PUT', '/api/state', { data: { junk: 1 } });
  ok('T8b 缺users/shared→400', r.status === 400 && r.json.error === 'invalid_state');
  r = await req('PUT', '/api/state', { data: { users: {}, shared: { foods: 'not-array', exercises: [] } } });
  ok('T8c shared.foods非数组→400', r.status === 400);

  /* T9 静态托管与 404 */
  r = await req('GET', '/');
  ok('T9a GET/→HTML', r.status === 200 && r.headers.get('content-type').includes('text/html') && r.text.includes('健康管理'));
  r = await req('GET', '/css/style.css');
  ok('T9b style.css→text/css', r.status === 200 && r.headers.get('content-type').includes('text/css'));
  r = await req('GET', '/js/app.js');
  ok('T9c app.js→js', r.status === 200 && r.headers.get('content-type').includes('javascript'));
  r = await req('GET', '/server.js');
  ok('T9d 目录外路径→404', r.status === 404);
  r = await req('GET', '/api/nope');
  ok('T9e 未知API→404', r.status === 404);

  /* T10 真实规模压测：1 成员 × 700 天饮食/睡眠/饮水/打卡 + 300 身体记录 + 120 训练 */
  const big = {
    theme: 'light', onboarded: true,
    shared: fixture.shared,
    users: {}, active: 'u_big',
  };
  const u = {
    id: 'u_big', name: '大数据', avatar: '🦁', color: 'orange',
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
  big.users.u_big = u;
  const t0 = Date.now();
  r = await req('PUT', '/api/state', { rev: 3, data: big });
  const putMs = Date.now() - t0;
  ok('T10a 大规模PUT(' + putMs + 'ms)', r.status === 200 && r.json.rev === 4, JSON.stringify(r.json).slice(0, 120));
  const t1 = Date.now();
  r = await req('GET', '/api/state');
  const getMs = Date.now() - t1;
  ok('T10b 大规模GET(' + getMs + 'ms)+深度一致', deepEq(normalizeExpected(big), r.json.data), LAST_FAIL);
  ok('T10c 规模耗时合理(put<3s, get<3s)', putMs < 3000 && getMs < 3000, 'put=' + putMs + 'ms get=' + getMs + 'ms');

  console.log('---');
  console.log(failed === 0
    ? '全部通过：' + passed + ' 项断言（含 fixture 边界形状往返 + ' + '真实规模往返 put ' + putMs + 'ms / get ' + getMs + 'ms）'
    : '通过 ' + passed + '，失败 ' + failed);
  server.close();
  try { fs.rmSync(TMP_DB, { force: true }); } catch (e) {}
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('测试崩溃:', e); process.exit(1); });
