'use strict';
/* =====================================================
   前端渲染逻辑无头验证(零依赖:node:vm + 迷你 DOM/fetch/localStorage 桩)
   定位:补上「数据 → 页面 HTML」最后一公里——启动冒烟、六页导航、
   关键结构与数据流(营养换算 / 饮水显隐 / 睡眠多段合计 / 打卡连续天数)。
   不验:布局、间距、配色等视觉表现(桩无渲染引擎)——仍留给用户目测。
   启动链与真实浏览器冷启动一致:init → /api/me → /api/state → converge 采纳
   服务器树 → go('home');树形夹具复用 fixture.json(与 roundtrip 同一形状)。
   运行:node test/render.test.js
   ===================================================== */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('[PASS] ' + name); }
  else { failed++; console.log('[FAIL] ' + name + (detail ? '  →  ' + detail : '')); }
}

/* ---------- 迷你 DOM 桩 ----------
 * 任意选择器自动物化并按 selector 持久复用(同一处多次查询是同一桩节点),
 * 渲染函数写进的 innerHTML 就能在 Node 侧读出来断言。
 * 事件绑定全部 no-op($$ 恒返回 [] → 监听器不挂),删除/弹窗等交互路径不在本测试范围。 */
function makeNode(tag) {
  const node = {
    __html: '', textContent: '', value: '', checked: false, disabled: false,
    dataset: {}, style: {}, children: [], tagName: String(tag || 'div').toUpperCase(),
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    appendChild(c){ this.children.push(c); return c; },
    removeChild(){}, remove(){},
    addEventListener(){}, removeEventListener(){},
    setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){},
    insertAdjacentHTML(pos, h){ this.__html += String(h); },
    closest(){ return null; }, focus(){}, blur(){}, click(){}, scrollIntoView(){},
    getBoundingClientRect(){ return { top:0, left:0, width:0, height:0, right:0, bottom:0 }; },
    querySelectorAll(){ return []; },
    onclick: null,
  };
  Object.defineProperty(node, 'innerHTML', {
    get(){ return this.__html; },
    set(h){ this.__html = String(h); },
  });
  const subs = new Map();
  node.querySelector = sel => {
    if (!subs.has(sel)) subs.set(sel, makeNode('div'));
    return subs.get(sel);
  };
  return node;
}
const doc = makeNode('#document');
doc.documentElement = makeNode('html');
doc.head = makeNode('head');
doc.body = makeNode('body');
doc.createElement = t => makeNode(t);
doc.getElementById = id => doc.querySelector('#' + id);   /* 与 $('#id') 共用同一桩节点 */

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

/* ---------- fetch 桩:/api/me 已登录(u_alice)+ /api/state 返回 fixture 树 ---------- */
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8'));
fixture.onboarded = true;                       /* 跳过首次引导浮层,直进主界面 */
const TREE = JSON.parse(JSON.stringify(fixture));

function res(status, body) {
  return { ok: status >= 200 && status < 300, status,
    json: async () => JSON.parse(JSON.stringify(body)),
    text: async () => JSON.stringify(body) };
}
async function fakeFetch(url, opts) {
  const u = String(url), m = ((opts && opts.method) || 'GET').toUpperCase();
  if (m === 'GET' && u.endsWith('/api/me'))
    return res(200, { username: 'tester', role: 'user', user: { id: 'u_alice', name: '测试者' } });
  if (m === 'GET' && u.endsWith('/api/state')) return res(200, { rev: 1, data: TREE });
  if (m === 'PUT' && u.endsWith('/api/state')) return res(200, { ok: true, rev: 2 });
  return res(404, { error: 'not_found' });
}

/* ---------- 同一 vm 上下文按 index.html 的加载顺序跑三段前端脚本 ---------- */
const sandbox = {
  document: doc, localStorage: makeLS(),
  location: { search: '', pathname: '/', hash: '', href: 'http://localhost:8123/', reload(){} },
  history: { replaceState(){}, pushState(){} },
  fetch: fakeFetch, console,
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval(){},
  URLSearchParams, URL, AbortController, TextEncoder,
  alert(){}, confirm: () => true, prompt: () => '',
};
sandbox.window = sandbox; sandbox.self = sandbox;
sandbox.window.scrollTo = () => {};
const ctx = vm.createContext(sandbox);

const readPub = p => fs.readFileSync(path.join(__dirname, '..', '..', 'public', p), 'utf8');
for (const f of ['js/seed-data.js', 'js/sleep-shape.js', 'js/app.js'])
  vm.runInContext(readPub(f), ctx, { filename: 'public/' + f });

/* 顶层 let/const 在上下文词法环境中,后续脚本可读写;Node 侧经 ev() 进入 */
const ev = code => vm.runInContext(code, ctx);
const view = doc.getElementById('view');
const topbar = doc.querySelector('#topbar');

async function main() {
  /* 等启动链(init → 两次 fetch → go('home'))落地 */
  const t0 = Date.now();
  while (!view.__html && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 10));
  ok('T1a 启动冒烟:me/state → 概览渲染无异常', !!view.__html, '3s 超时:#view 始终为空');
  if (!view.__html) return finish();
  ok('T1b 概览关键块', view.__html.includes('今日热量') && view.__html.includes('🍽️ 今日饮食')
     && topbar.__html.includes('概览'));
  ok('T1c 登录态与单人树', ev('me.username') === 'tester' && ev('USERS.active') === 'u_alice'
     && ev('Object.keys(USERS.users).length') === 1,
     `me=${ev('JSON.stringify(me&&me.username)')} active=${ev('USERS.active')}`);

  /* T2 六页导航冒烟(顺序放最前:后续用例会改写 state) */
  const TITLES = { home:'概览', diet:'饮食记录', train:'运动', body:'身体数据', stats:'历史', settings:'设置' };
  for (const [v, tt] of Object.entries(TITLES)) {
    let err = null;
    try { ev(`go('${v}')`); } catch (e) { err = e; }
    ok('T2 页面冒烟 ' + v, !err && view.__html.length > 50 && topbar.__html.includes(tt),
       (err && err.message) || ('len=' + view.__html.length));
  }

  /* T3 饮食数据流:per100×克数换算 + 渲染行 */
  const x3 = JSON.parse(ev(`(() => {
    const f = state.foods[0];
    const it = { id:'t_x1', name:f.name, per100:{ kcal:f.per100.kcal, p:f.per100.p, c:f.per100.c, f:f.per100.f }, g:150 };
    dietDate = today();
    state.meals[today()] = { breakfast:[it], lunch:[], dinner:[], snack:[] };
    const tot = dayTotals(today());
    renderDiet();
    return JSON.stringify({ name:f.name, expKcal:Math.round(f.per100.kcal * 150 / 100), tot });
  })()`));
  ok('T3a 营养换算 dayTotals = per100×g/100', x3.tot.kcal === x3.expKcal, JSON.stringify(x3.tot) + ' vs ' + x3.expKcal);
  ok('T3b 饮食页渲染食物行(名称/克数/kcal)',
     view.__html.includes(x3.name) && view.__html.includes('150g') && view.__html.includes(String(x3.expKcal)));

  /* T4 饮水卡显隐(PLANS/MEMO 记载的「目标 0 隐藏」契约) */
  ev('state.waterTarget = 0; renderHome()');
  ok('T4a 饮水目标 0 → 概览隐藏饮水卡', !view.__html.includes('💧 今日饮水'),
     '卡片标题仍出现(裸 💧 会撞习惯图标,断言锚定标题)');
  ev('state.waterTarget = 8; state.water[today()] = 3; renderHome()');
  ok('T4b 目标 8 · 已 3 → 显示「再喝 5 杯达标」',
     view.__html.includes('💧 今日饮水') && view.__html.includes('再喝 5 杯达标'));

  /* T5 睡眠多段合计(v4.6 多段化契约:450+30 → 8 小时,≥420min 达标) */
  ev(`state.sleep[today()] = [
    { t:'night', bed:'23:00', wake:'06:30', mins:450, q:4 },
    { t:'nap',   bed:'13:00', wake:'13:30', mins:30,  q:3 },
  ]; renderHome()`);
  ok('T5 睡眠多段合计「合计 8 小时 · 达标」', view.__html.includes('合计 8 小时 · 达标'),
     view.__html.includes('😴') ? view.__html.slice(view.__html.indexOf('😴'), view.__html.indexOf('😴') + 120) : '无睡眠卡');

  /* T6 打卡卡:今日+昨日已打卡 → 连续 2 天 */
  ev(`state.habits = [{ id:'h1', name:'背单词', icon:'📖', color:'#1baf7a',
       done:{ [today()]: true, [addDays(today(), -1)]: true } }]; renderHome()`);
  ok('T6 打卡卡渲染习惯名与「🔥 连续 2 天」',
     view.__html.includes('背单词') && view.__html.includes('🔥 连续 2 天'));

  finish();
}

function finish() {
  /* stdout.write 回调触发时缓冲已冲刷——管道/重定向下 process.exit 才不会吞掉汇总行 */
  process.stdout.write('\nrender.test.js: ' + passed + ' passed, ' + failed + ' failed\n',
    () => process.exit(failed ? 1 : 0));
}
main().catch(e => { console.error('[CRASH]', e); process.exit(1); });
