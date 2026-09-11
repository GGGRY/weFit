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
fixture.active = 'u_alice';                     /* 桩树 active 原为 u_bob(空档案)，会把 u_alice 的真实数据挡在 state 之外 */
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

  /* T7 v4.12 运动页 = 单一日程列表：每项一个打卡圆钮，卡头 n/N，勾过的行变暗
   * 注意：运动页正文写进 #tabBody（桩里是独立节点），不在 view.__html 里 */
  ev("renderTrain()");
  const trainHTML = doc.getElementById('tabBody').__html;
  ok('T7a 力量行「32 次 @70kg」', trainHTML.includes('32 次 @70kg'), 'n=' + ev('state.workouts.length') + ' html=' + trainHTML.slice(0, 300));
  ok('T7b 计时行「32.5 分钟 · 5.2 km」', trainHTML.includes('32.5 分钟 · 5.2 km'));
  ok('T7c 全完成那天卡头显示实际容量「容量 2240 kg」（只算已打勾项）', trainHTML.includes('容量 2240 kg'));
  ok('T7d 每项都有独立打卡圆钮：已完成的带 on、未打勾的不带',
     trainHTML.includes('class="hab-dot on" data-itemdone="w1" data-item="wi1"')
     && trainHTML.includes('class="hab-dot " data-itemdone="w5" data-item="wi7"'));
  ok('T7e 部分完成那天卡头显示 1/2，且容量只算已打勾项（1 项 @70kg×32）',
     trainHTML.includes('>1/2<') && trainHTML.includes('>2/2<'),
     'html=' + trainHTML.slice(0, 500));
  ok('T7f 未开始的那天显示计划量「计划 容量 2880 kg」', trainHTML.includes('计划 容量 2880 kg'));
  ok('T7g PR 只跟更早、已打勾的项比：全列表只有 w1 一个 🏆', (trainHTML.match(/🏆/g) || []).length === 1);
  ok('T7h 一键按钮：未完成的是「✔ 全部完成」，全完成的是「↺ 全部取消」',
     trainHTML.includes('✔ 全部完成') && trainHTML.includes('↺ 全部取消'));

  /* T8 列表按日期倒序：最上是最新/未来的安排，历史往下排 */
  ok('T8 单列表按日期倒序（9/9 腿日 在 8/30 推日 之前），不再有「计划/记录」分段',
     trainHTML.indexOf('腿日') < trainHTML.indexOf('推日') && trainHTML.includes('腿日') && trainHTML.includes('推日')
     && !view.__html.includes('📒 记录') && view.__html.includes('＋ 安排运动'),
     'i腿=' + trainHTML.indexOf('腿日') + ' i推=' + trainHTML.indexOf('推日'));

  /* T9 v4.11 历史页新增「每周运动时长」图（容量图之外的独立口径） */
  ev("go('stats')");
  const minsSVG = doc.getElementById('st_mins').__html;
  ok('T9 历史页「每周运动时长」卡与图', view.__html.includes('每周运动时长') && minsSVG.includes('<svg'),
     'card=' + view.__html.includes('每周运动时长') + ' svg=' + minsSVG.length);

  /* T10 v4.11 动作库平铺表格：大类/部位/方式三列，不再有分组树 */
  const libTbl = ev("libTableHTML(state.exercises.slice(0,2).map(e => ({ ex:e, action:'<button>选</button>' })))");
  ok('T10 库列表为平铺表格(名称/分类/方式/操作)', libTbl.includes('<th>名称</th>') && libTbl.includes('<th>分类</th>')
     && libTbl.includes('<th>方式</th>') && libTbl.includes('力量 · 胸') && libTbl.includes('计次'),
     libTbl.slice(0, 160));

  /* T11 项文案契约（力量/自重/计时/秒级四条分支） */
  const fmt = JSON.parse(ev(`JSON.stringify({
    w: fmtItem({ reps:32, weight:60 }), self: fmtItem({ reps:30 }),
    t: fmtItem({ mins:30, km:5 }), sec: fmtItem({ mins:1.5 }),
    mode: itemMode({ mins:30 }) + '/' + itemMode({ reps:10 }),
    vol: itemVolume({ mins:30, km:5 }) })`));
  ok('T11 项文案与计数口径', fmt.w === '32 次 @60kg' && fmt.self === '30 次 · 自重'
     && fmt.t === '30 分钟 · 5 km' && fmt.sec === '1.5 分钟'
     && fmt.mode === 'time/reps' && fmt.vol === 0, JSON.stringify(fmt));

  /* T12 弹窗渲染冒烟：四个对话框都渲染且文案对（桩里 $$ 恒空 → 事件不挂，只验"渲染不抛错 + 内容正确"；
   * 这是浏览器里点得到、而其它用例覆盖不到的路径：计划编辑器 / 记录弹窗 / 动作选择器 / 动作库弹窗） */
  function dlgHTML(call){
    try { ev('closeDialog && curDialog && closeDialog()'); ev(call); return ev('curDialog.box.__html'); }
    catch (e) { return 'ERR:' + e.message; }
  }
  const hPlan = dlgHTML("openWorkoutDlg(today())");   /* 安排弹窗：日期 + 复制已有安排 + 三档添加 */
  ok('T12a 安排弹窗：日期选择 + 复制已有安排 + 三档添加，且无天级完成勾选框', !hPlan.startsWith('ERR:')
     && hPlan.includes('wl_date') && hPlan.includes('复制已有安排') && !hPlan.includes('wl_done')
     && hPlan.includes('＋ 徒手/自重') && hPlan.includes('＋ 计时运动') && hPlan.includes('保存安排'),
     hPlan.startsWith('ERR:') ? hPlan : hPlan.slice(0, 160));
  /* w4 跑日：第一项（卧推）已打勾、第二项（跑步）未打勾 → 行内应预填 30 分钟 / 5 km，圆钮一对一 */
  const hWk = dlgHTML("openWorkoutDlg(null, 'w4')");
  ok('T12b 编辑弹窗：计时行预填 30 分钟 / 5 km，行首圆钮反映项级完成', !hWk.startsWith('ERR:')
     && hWk.includes('wl_mins') && hWk.includes('wl_km') && hWk.includes('value="30"') && hWk.includes('value="5"')
     && hWk.includes('class="hab-dot on" data-wtoggle="0"') && hWk.includes('class="hab-dot " data-wtoggle="1"'),
     hWk.startsWith('ERR:') ? hWk : hWk.slice(0, 260));
  /* 全完成的那天：弹窗里每一项的圆钮都应已勾上 */
  const hDone = dlgHTML("openWorkoutDlg(null, 'w1')");
  ok('T12c 编辑已完成的记录：该项圆钮为 on 状态', !hDone.startsWith('ERR:') && hDone.includes('class="hab-dot on" data-wtoggle="0"'),
     hDone.startsWith('ERR:') ? hDone : hDone.slice(0, 200));
  /* 计时快捷档：15/30/45/60 四个 chip（方案 §5.2） */
  ok('T12e 计时行有 15/30/45/60 快捷档', [15, 30, 45, 60].every(m => hWk.includes('data-min="' + m + '"')),
     hWk.startsWith('ERR:') ? hWk : hWk.slice(0, 400));
  const hPick = dlgHTML('openExercisePicker(function(){})');
  ok('T12f 动作选择器为平铺表格', !hPick.startsWith('ERR:') && hPick.includes('<th>分类</th>') && hPick.includes('杠铃卧推'), hPick.slice(0, 140));
  /* 动作库弹窗内容写在 #xl_host 子节点里（桩不做真实 DOM 树，内容不在 box.__html 里） */
  let hLib = '';
  try { ev('closeDialog && curDialog && closeDialog()'); ev('openExLib()'); hLib = ev("$('#xl_body', $('#xl_host', curDialog.box)).__html");   /* 表格在再下一层 #xl_body */ }
  catch (e) { hLib = 'ERR:' + e.message; }
  ok('T12d 我的动作库弹窗渲染表格与新增表单', !hLib.startsWith('ERR:') && hLib.includes('我的动作库')
     && hLib.includes('<th>方式</th>') && hLib.includes('nx_cat') && hLib.includes('nx_mode'), hLib.slice(0, 160));
  ev('closeDialog && curDialog && closeDialog()');

  /* T13 v4.12 纯函数契约：旧形状清洗 / 项收集（含 done 保真）/ 字段写入 / 排序 / 完成进度 / 周聚合。
   * 对话框交互（点 chip/保存）在桩里点不到，但这几个决策函数零成本可直接断言。 */
  const pure = JSON.parse(ev(`JSON.stringify({
    legacy: (function(){ const u = {
      plans: { '1': { id:'p1', items:[{ exId:'e0', exName:'旧计划', sets:4 }] } },
      workouts: [
        { id:'w1', date:'2026-01-01', note:'旧', items:[{ exId:'e0', exName:'旧', muscle:'胸', sets:[{ reps:8, weight:60 }] }] },
        { id:'w2', date:'2026-01-02', items:[{ exId:'e0', exName:'新', cat:'力量', muscle:'胸', reps:32, weight:60 }] },
        { id:'w3', date:'2026-01-02', items:[{ exId:'e0', exName:'同日重复', reps:1 }] },
        { id:'w4', items:[{ exId:'e0', exName:'无日期', reps:1 }] }
      ]
    }; normalizeWorkoutDays(u); return u; })(),
    collect: collectItems([
      { exName:'A', exId:'x', cat:'力量', muscle:'胸', reps:32, weight:60, _mode:'reps', done:true },
      { exName:'B', reps:0, weight:5 },
      { exName:'C', mins:30, km:5, _mode:'time' },
      { exName:'', reps:10 },
      { exName:'D', exId:'z', reps:0, mins:0 }
    ], false),
    collectNeedEx: collectItems([{ exName:'无库条目', reps:10 }], true).length,
    fields: (function(){ const it = {};
      setItemField(it,'mins','30'); const a = it.mins;
      setItemField(it,'mins','0'); const b = Object.prototype.hasOwnProperty.call(it,'mins');
      setItemField(it,'km','-5'); const c = Object.prototype.hasOwnProperty.call(it,'km');
      setItemField(it,'reps','1.5'); return { a:a, b:b, c:c, r:it.reps }; })(),
    mode: (function(){ const m = { reps:10, weight:60, _mode:'reps' }; setItemMode(m,'time');
      return { hasReps:Object.prototype.hasOwnProperty.call(m,'reps'), mode:m._mode }; })(),
    sort: exLibSort([
      { name:'跑步', cat:'有氧', muscle:'全身' },
      { name:'引体向上', cat:'力量', muscle:'背' },
      { name:'杠铃卧推', cat:'力量', muscle:'胸' },
      { name:'平板支撑', cat:'力量', muscle:'核心' }
    ]).map(e => e.name),
    badge: (function(){ const w = { items:[{ exName:'跑步', mins:30, done:true }, { exName:'杠铃卧推', muscle:'胸', reps:32 }] };
      return doneCount(w) + '/' + isDone(w) + '/' + allDone(w) + '/' + itemDone(w.items[0]) + '/' + itemDone(w.items[1]); })(),
    libSeed: (function(){ const s = { exercises:[{ id:'e0', name:'杠铃卧推', muscle:'胸' }] };
      normalizeLegacyShared(s); return [s.exercises.length, s.exercises.every(e => e.cat && e.mode)]; })(),
    wk: (function(){ const y0 = weeklyMinutes(12)[11].y, k0 = weeklyDistances(12)[11].y;
      state.workouts.push({ id:'w_t13', date:today(), name:'', items:[{ exName:'跑步', mins:30, km:5, done:true }, { exName:'操课', mins:15, done:true }] });
      return [weeklyMinutes(12)[11].y - y0, weeklyDistances(12)[11].y - k0]; })()
  })`));
  ok('T13a 旧树清洗：plans 作废、天级 done 下放到项、sets/同日/无日期丢弃、旧库换新种子',
     pure.legacy.plans === undefined && pure.legacy.workouts.length === 1
     && pure.legacy.workouts[0].id === 'w2' && pure.legacy.workouts[0].done === undefined
     && pure.legacy.workouts[0].note === undefined && pure.legacy.workouts[0].items.length === 1
     && pure.legacy.workouts[0].items[0].done === true
     && pure.libSeed[0] === 27 && pure.libSeed[1] === true, JSON.stringify(pure.legacy) + JSON.stringify(pure.libSeed));
  ok('T13b collectItems：丢空项/无值项、剥 _mode、done 保真、needEx 生效',
     JSON.stringify(pure.collect) === JSON.stringify([
       { exName:'A', exId:'x', cat:'力量', muscle:'胸', done:true, reps:32, weight:60 },
       { exName:'C', mins:30, km:5 }]) && pure.collectNeedEx === 0, JSON.stringify(pure.collect));
  ok('T13c setItemField 正数留/0 与负数删键；setItemMode 清残留',
     pure.fields.a === 30 && pure.fields.b === false && pure.fields.c === false && pure.fields.r === 1.5
     && pure.mode.hasReps === false && pure.mode.mode === 'time', JSON.stringify(pure.fields) + JSON.stringify(pure.mode));
  ok('T13d exLibSort 大类→部位→名称；完成进度口径 doneCount/isDone/allDone/itemDone',
     JSON.stringify(pure.sort) === JSON.stringify(['杠铃卧推','引体向上','平板支撑','跑步']) && pure.badge === '1/true/false/true/false',
     JSON.stringify(pure.sort) + ' ' + pure.badge);
  ok('T13e weeklyMinutes/Distances 只累计各自口径', pure.wk[0] === 45 && pure.wk[1] === 5, JSON.stringify(pure.wk));

  finish();
}

function finish() {
  /* stdout.write 回调触发时缓冲已冲刷——管道/重定向下 process.exit 才不会吞掉汇总行 */
  process.stdout.write('\nrender.test.js: ' + passed + ' passed, ' + failed + ' failed\n',
    () => process.exit(failed ? 1 : 0));
}
main().catch(e => { console.error('[CRASH]', e); process.exit(1); });
