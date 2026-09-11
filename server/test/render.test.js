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

  /* T3c 概览「今日饮食」卡：有记录时也保留「去记录」入口（未标版号用户要求；
   * 绑定用单元素 querySelector,同页必须恰好一个 data-go2="diet"） */
  ev('renderHome()');
  const dietI = view.__html.indexOf('🍽️ 今日饮食');
  const dietCard = dietI < 0 ? '' : view.__html.slice(dietI, dietI + 1600);
  ok('T3c 有记录时卡底仍有一个「去记录」按钮',
     dietCard.includes('kcal') && dietCard.includes('data-go2="diet"')
     && (view.__html.match(/data-go2="diet"/g) || []).length === 1,
     'n=' + (view.__html.match(/data-go2="diet"/g) || []).length);

  /* T4 饮水卡显隐(PLANS/MEMO 记载的「目标 0 隐藏」契约) */
  ev('state.waterTarget = 0; renderHome()');
  ok('T4a 饮水目标 0 → 概览隐藏饮水卡', !view.__html.includes('💧 今日饮水'),
     '卡片标题仍出现(裸 💧 会撞习惯图标,断言锚定标题)');
  ev('state.waterTarget = 8; state.water[today()] = 3; renderHome()');
  ok('T4b 目标 8 · 已 3 → 显示「再喝 5 杯达标」',
     view.__html.includes('💧 今日饮水') && view.__html.includes('再喝 5 杯达标'));

  /* T5 睡眠多段合计（v4.6 多段化契约；未标版号：目标由 7h/420min 改为 10h/600min） */
  ev(`state.sleep[today()] = [
    { t:'night', bed:'23:00', wake:'06:30', mins:450, q:4 },
    { t:'nap',   bed:'13:00', wake:'13:30', mins:30,  q:3 },
  ]; renderHome()`);
  ok('T5a 8 小时 < 新目标 10 小时 → 「合计 8 小时 · 偏少」', view.__html.includes('合计 8 小时 · 偏少'),
     view.__html.includes('😴') ? view.__html.slice(view.__html.indexOf('😴'), view.__html.indexOf('😴') + 120) : '无睡眠卡');
  ev(`state.sleep[today()] = [
    { t:'night', bed:'22:00', wake:'07:00', mins:540, q:4 },
    { t:'nap',   bed:'13:00', wake:'14:00', mins:60,  q:3 },
  ]; renderHome()`);
  ok('T5b 10 小时 = 新目标 → 「合计 10 小时 · 达标」', view.__html.includes('合计 10 小时 · 达标'),
     view.__html.includes('😴') ? view.__html.slice(view.__html.indexOf('😴'), view.__html.indexOf('😴') + 120) : '无睡眠卡');

  /* T6 打卡卡:今日+昨日已打卡 → 连续 2 天 */
  ev(`state.habits = [{ id:'h1', name:'背单词', icon:'📖', color:'#1baf7a',
       done:{ [today()]: true, [addDays(today(), -1)]: true } }]; renderHome()`);
  ok('T6 打卡卡渲染习惯名与「🔥 连续 2 天」',
     view.__html.includes('背单词') && view.__html.includes('🔥 连续 2 天'));

  /* T7 v4.14 运动页 = 周视图：一周七卡（周一→周日），周切换改的是展示区间
   * 注意：运动页正文写进 #tabBody（桩里是独立节点），不在 view.__html 里 */
  ev("setTrainWeek(null); renderTrain()");
  let trainHTML = doc.getElementById('tabBody').__html;
  ok('T7a 一周七卡（含无安排的空白日）', (trainHTML.match(/data-daycard=/g) || []).length === 7,
     'n=' + (trainHTML.match(/data-daycard=/g) || []).length);
  ok('T7b 每张日卡卡头都有「＋ 添加运动」（逐项入口，页头无全局按钮）',
     (trainHTML.match(/data-additem=/g) || []).length === 7 && trainHTML.includes('＋ 添加运动')
     && !view.__html.includes('tr_add') && !view.__html.includes('＋ 安排运动'),
     'view=' + view.__html.slice(0, 200));
  ok('T7c 今天那张卡带「今天」标记（默认页就是本周）', trainHTML.includes('>今天<'));
  ok('T7d 周头显示区间/周序/周汇总', view.__html.includes('本周')
     && view.__html.includes(ev('dateCN(mondayOf(today()))') + ' – ' + ev("dateCN(addDays(mondayOf(today()),6))") )
     && view.__html.includes('已运动 '));

  /* 切到 w5（2026-09-09 腿日，90kg×32 一项未勾）那周：显示计划量、圆钮不带 on */
  ev("setTrainWeek(mondayOf('2026-09-09'))");
  trainHTML = doc.getElementById('tabBody').__html;
  ok('T7e 未开始的那天显示计划量「计划 容量 2880 kg」', trainHTML.includes('计划 容量 2880 kg'),
     'html=' + trainHTML.slice(0, 300));
  ok('T7f 未打勾的项圆钮不带 on', trainHTML.includes('class="hab-dot " data-itemdone="w5" data-item="wi7"'));
  ok('T7g 周序文案纯函数：本周/上周/下周/更远各档',
     JSON.parse(ev("JSON.stringify([weekLabel(thisMonday()), weekLabel(addDays(thisMonday(),-7)), weekLabel(addDays(thisMonday(),7)), weekLabel(addDays(thisMonday(),-21)), weekLabel(addDays(thisMonday(),14))])")).join(',') === '本周,上周,下周,3 周前,2 周后');

  /* 切到 w2/w3/w4 那周（2026-08-31 起）：力量行 / 计时行 / 部分完成 / 全完成 / 一键按钮 */
  ev("setTrainWeek(mondayOf('2026-09-05'))");
  trainHTML = doc.getElementById('tabBody').__html;
  ok('T7h 力量行「32 次 @70kg」', trainHTML.includes('32 次 @70kg'));
  ok('T7i 计时行「32.5 分钟 · 5.2 km」', trainHTML.includes('32.5 分钟 · 5.2 km'));
  ok('T7j 部分完成那天卡头 1/2，且容量只算已打勾项（2240 kg）',
     trainHTML.includes('>1/2<') && trainHTML.includes('容量 2240 kg'));
  ok('T7k 全完成那天卡头 2/2', trainHTML.includes('>2/2<'));
  ok('T7l 每项都有独立打卡圆钮：已完成的带 on、未打勾的不带',
     trainHTML.includes('class="hab-dot on" data-itemdone="w4" data-item="wi5"')
     && trainHTML.includes('class="hab-dot " data-itemdone="w4" data-item="wi6"'));
  ok('T7m 逐项操作：行尾有 ✏️/🗑，卡片上不再有「全部完成/取消」与整天级按钮',
     trainHTML.includes('data-itemedit="2026-09-05" data-item="wi6"')
     && trainHTML.includes('data-itemdel="2026-09-05" data-item="wi6"')
     && !trainHTML.includes('data-allday') && !trainHTML.includes('data-wedit') && !trainHTML.includes('data-wdel')
     && !trainHTML.includes('✔ 全部完成') && !trainHTML.includes('↺ 全部取消'));

  /* 概览「今日运动」卡与运动页同一套逐项交互：卡头 ＋ 添加、行尾 ✏️/🗑 */
  ev("state.workouts.push({ id:'w_home', date:today(), name:'', items:[{ id:'wh1', exName:'自测深蹲', cat:'力量', muscle:'腿', reps:10 }] }); renderHome()");
  const homeHTML = view.__html;
  ev("setTrainWeek(mondayOf('2026-09-05'))");
  const subHTML = doc.getElementById('tabBody').__html;
  ok('T7o 名称下方小字显示大类 · 部位（力量 · 胸 / 有氧 · 全身）',
     subHTML.includes('<div class="sub">力量 · 胸</div>') && subHTML.includes('<div class="sub">有氧 · 全身</div>')
     && subHTML.includes('<div class="sub">柔韧 · 全身</div>'), 'sub=' + (subHTML.match(/<div class="sub">[^<]*<\/div>/g) || []).join(' , '));
  ok('T7n 概览今日运动卡：卡头「＋ 添加运动」+ 行尾逐项 ✏️/🗑，且无「全部完成」',
     homeHTML.includes('data-additem="' + ev('today()') + '"')
     && homeHTML.includes('data-itemedit="' + ev('today()') + '" data-item="wh1"')
     && homeHTML.includes('data-itemdel="' + ev('today()') + '" data-item="wh1"')
     && homeHTML.includes('<div class="sub">力量 · 腿</div>')
     && !homeHTML.includes('data-allday') && !homeHTML.includes('全部完成'));
  ev("state.workouts = state.workouts.filter(x => x.id !== 'w_home')");

  /* T8 周视图只渲染当周 + 周汇总口径（切周看历史，不再是全量倒序列表） */
  ev("setTrainWeek(mondayOf('2026-09-05'))");
  const wk831 = view.__html + doc.getElementById('tabBody').__html;
  ev("setTrainWeek(mondayOf('2026-09-07'))");
  const wk907 = view.__html + doc.getElementById('tabBody').__html;
  ok('T8a 区间随周切换：8月31日 – 9月6日 / 9月7日 – 9月13日',
     wk831.includes('8月31日 – 9月6日') && wk907.includes('9月7日 – 9月13日'));
  ok('T8b 周汇总按「项」算：8/31 那周已运动 3/7 天，9/7 那周 0/7 天',
     wk831.includes('已运动 3/7 天') && wk907.includes('已运动 0/7 天'));
  ok('T8c 周视图只渲染当周：9/7 那周没有 8月30日 的卡，切到那周才出现',
     !wk907.includes('data-daycard="2026-08-30"') && wk831.includes('data-daycard="2026-08-30"') === false
     && ev("setTrainWeek(mondayOf('2026-08-30')); document.getElementById('tabBody').__html").includes('data-daycard="2026-08-30"'));
  ok('T8d PR 只跟更早、已打勾的项比：8/30 那周只有 w1 一个 🏆',
     (doc.getElementById('tabBody').__html.match(/🏆/g) || []).length === 1);
  ev("setTrainWeek(null)");   /* 复位，别影响后续用例 */

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

  /* T11 项文案契约（力量有重量/力量无重量/计时/秒级四条分支） */
  const fmt = JSON.parse(ev(`JSON.stringify({
    w: fmtItem({ reps:32, weight:60 }), self: fmtItem({ reps:30 }),
    t: fmtItem({ mins:30, km:5 }), sec: fmtItem({ mins:1.5 }),
    mode: itemMode({ mins:30 }) + '/' + itemMode({ reps:10 }),
    vol: itemVolume({ mins:30, km:5 }),
    sub: itemSub({ cat:'力量', muscle:'胸' }) + '|' + itemSub({ cat:'有氧', muscle:'全身' })
       + '|' + itemSub({ cat:'柔韧', muscle:'柔韧' }) + '|' + itemSub({ cat:'球类' }) })`));
  ok('T11 项文案与计数口径（重量不填就不显示「自重」；小字 = 大类 · 部位，重复只留一个）',
     fmt.w === '32 次 @60kg' && fmt.self === '30 次'
     && fmt.t === '30 分钟 · 5 km' && fmt.sec === '1.5 分钟'
     && fmt.mode === 'time/reps' && fmt.vol === 0
     && fmt.sub === '力量 · 胸|有氧 · 全身|柔韧|球类', JSON.stringify(fmt));

  /* T12 弹窗渲染冒烟：四个对话框都渲染且文案对（桩里 $$ 恒空 → 事件不挂，只验"渲染不抛错 + 内容正确"；
   * 这是浏览器里点得到、而其它用例覆盖不到的路径：计划编辑器 / 记录弹窗 / 动作选择器 / 动作库弹窗） */
  function dlgHTML(call){
    try { ev('closeDialog && curDialog && closeDialog()'); ev(call); return ev('curDialog.box.__html'); }
    catch (e) { return 'ERR:' + e.message; }
  }
  /* 逐项弹窗：一次只编辑一个动作（数值区在 #it_body 里，桩不建真实 DOM 树 → 要单独读子节点） */
  const itemFields = call => {
    try { ev('closeDialog && curDialog && closeDialog()'); ev(call); return ev("$('#it_body', curDialog.box).__html"); }
    catch (e) { return 'ERR:' + e.message; }
  };
  const hItem = dlgHTML("openItemDlg(today())");
  ok('T12a 逐项弹窗：无手填动作名、无力量/计时切换（方式由动作库条目决定），无整天级编辑器',
     !hItem.startsWith('ERR:') && !hItem.includes('id="it_name"') && !hItem.includes('data-mode=')
     && !hItem.includes('wl_date') && !hItem.includes('wl_name') && !hItem.includes('复制已有安排')
     && hItem.includes('新增一项') && hItem.includes('it_save'),
     hItem.startsWith('ERR:') ? hItem : hItem.slice(0, 200));
  /* 新建：未选动作前只给选择入口，不先摆出数值框 */
  const fNew = itemFields('openItemDlg(today())');
  ok('T12b 新建态：只有「选择动作」入口 + 提示，无动作名输入框与数值框', !fNew.startsWith('ERR:')
     && fNew.includes('it_pick') && fNew.includes('先从动作库选一个动作')
     && !fNew.includes('由它自动决定')
     && !fNew.includes('it_reps') && !fNew.includes('it_w'),
     fNew.startsWith('ERR:') ? fNew : fNew.slice(0, 240));
  /* 编辑 w3 第二项（拉伸 10 分钟，已完成）：计时形态 + 预填 + 15/30/45/60 快捷档 */
  const fTime = itemFields("openItemDlg('2026-09-03', 'wi4')");
  ok('T12c 编辑计时项：计时形态（自动）+ 预填 10 分钟 + 时长框自绘「常用时长」下拉', !fTime.startsWith('ERR:')
     && fTime.includes('⏱ 计时') && fTime.includes('value="10"') && fTime.includes('it_km')
     && fTime.includes('id="it_mins"') && fTime.includes('id="it_mins_btn"') && fTime.includes('id="it_mins_menu"')
     && fTime.includes('class="mins-wrap"') && fTime.includes('class="mins-menu"')
     && [15, 20, 30, 45, 60].every(n => fTime.includes('data-min="' + n + '">' + n + ' 分钟</button>'))
     && !fTime.includes('<datalist') && !fTime.includes('it_quick'),
     fTime.startsWith('ERR:') ? fTime : fTime.slice(0, 320));
  /* 编辑 w4 第一项（杠铃卧推 32 次 @70kg，已勾）：力量形态预填 + 选中态 + 更换动作入口 */
  const fReps = itemFields("openItemDlg('2026-09-05', 'wi5')");
  ok('T12d 编辑力量项：选中动作名回显 + 预填 32 次 / 70 kg，无计时字段', !fReps.startsWith('ERR:')
     && fReps.includes('杠铃卧推') && fReps.includes('🔄 更换动作') && fReps.includes('🏋 力量')
     && fReps.includes('value="32"') && fReps.includes('value="70"') && !fReps.includes('it_mins'),
     fReps.startsWith('ERR:') ? fReps : fReps.slice(0, 240));
  const hEdit = dlgHTML("openItemDlg('2026-09-05', 'wi5')");
  ok('T12e 编辑态：带「删除这一项」，无天级完成勾选框',
     !hEdit.startsWith('ERR:') && hEdit.includes('修改这一项')
     && hEdit.includes('it_del') && hEdit.includes('删除这一项') && !hEdit.includes('wl_done'),
     hEdit.startsWith('ERR:') ? hEdit : hEdit.slice(0, 200));
  /* 预览行：打开即按模型渲染（编辑时立刻显示合计），不靠用户先敲一下 */
  const prevHTML = (() => {
    try { ev('closeDialog && curDialog && closeDialog()'); ev("openItemDlg('2026-09-05', 'wi5')"); return ev("$('#it_prev', curDialog.box).__html"); }
    catch (e) { return 'ERR:' + e.message; }
  })();
  ok('T12g 弹窗预览打开即显示合计', prevHTML === '合计：32 次 @70kg · 力量 · 胸 · 容量 2240 kg', prevHTML);
  /* 重量可选：引体向上（14 次，无 weight）→ 重量框空着、文案只有「14 次」，不自造「自重」 */
  const fNoW = itemFields("openItemDlg('2026-09-02', 'wi2')");
  const prevNoW = (() => {
    try { ev('closeDialog && curDialog && closeDialog()'); ev("openItemDlg('2026-09-02', 'wi2')"); return ev("$('#it_prev', curDialog.box).__html"); }
    catch (e) { return 'ERR:' + e.message; }
  })();
  ok('T12i 重量可选：无重量项预填空值、预览「14 次 · 力量 · 背」且无「自重」', !fNoW.startsWith('ERR:')
     && fNoW.includes('id="it_w"') && fNoW.includes('value=""') && fNoW.includes('重量 kg（可选')
     && prevNoW === '合计：14 次 · 力量 · 背', fNoW.slice(0, 200) + ' | ' + prevNoW);
  /* 添加起步值：力量 30 次 / 计时 20 分钟；已有值不被覆盖 */
  const defs = JSON.parse(ev(`JSON.stringify({
    reps: defaultForMode({ _mode:'reps' }).reps,
    time: defaultForMode({ _mode:'time' }).mins,
    keptReps: defaultForMode({ _mode:'reps', reps:12, weight:60 }).reps,
    keptTime: defaultForMode({ _mode:'time', mins:45 }).mins,
    crossed: (function(){ const m = { _mode:'reps', reps:30, weight:60 }; setItemMode(m, 'time'); defaultForMode(m); return [Object.prototype.hasOwnProperty.call(m,'reps'), m.mins]; })()
  })`));
  ok('T12j 添加起步值：力量 30 次 / 计时 20 分钟，且不覆盖已有值、切方式后重新给值',
     defs.reps === 30 && defs.time === 20 && defs.keptReps === 12 && defs.keptTime === 45
     && defs.crossed[0] === false && defs.crossed[1] === 20, JSON.stringify(defs));
  const hPick = dlgHTML('openExercisePicker(function(){})');  ok('T12f 动作选择器为平铺表格', !hPick.startsWith('ERR:') && hPick.includes('<th>分类</th>') && hPick.includes('杠铃卧推'), hPick.slice(0, 140));
  /* 动作库弹窗内容写在 #xl_host 子节点里（桩不做真实 DOM 树，内容不在 box.__html 里） */
  let hLib = '';
  try { ev('closeDialog && curDialog && closeDialog()'); ev('openExLib()'); hLib = ev("$('#xl_body', $('#xl_host', curDialog.box)).__html");   /* 表格在再下一层 #xl_body */ }
  catch (e) { hLib = 'ERR:' + e.message; }
  ok('T12h 我的动作库弹窗渲染表格与新增表单', !hLib.startsWith('ERR:') && hLib.includes('我的动作库')
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
