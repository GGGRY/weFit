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
/* 记账：被动态注入的 <script>（app.js 的 loadDev() 按需注入 js/dev.js）——
 * 正常启动路径应当一次都没有（T15a）；桩不执行脚本，只记下 src。 */
const INJECTED_SCRIPTS = [];
const headAppend = doc.head.appendChild.bind(doc.head);
doc.head.appendChild = c => { if (c && c.src) INJECTED_SCRIPTS.push(String(c.src)); return headAppend(c); };
doc.createElement = t => makeNode(t);
doc.getElementById = id => doc.querySelector('#' + id);   /* 与 $('#id') 共用同一桩节点 */
/* documentElement 的属性存取改成真记账:applyTheme 写的 data-theme 要能在 Node 侧读回
 * (makeNode 默认 setAttribute/getAttribute 是 no-op,验不了主题切换) */
const rootAttrs = new Map();
doc.documentElement.setAttribute = (k, v) => rootAttrs.set(String(k), String(v));
doc.documentElement.getAttribute = k => (rootAttrs.has(String(k)) ? rootAttrs.get(String(k)) : null);

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
const SEED_REQUESTS = [];   /* 断言用：前端全程不应请求 seed-data.json（v4.16） */
async function fakeFetch(url, opts) {
  const u = String(url), m = ((opts && opts.method) || 'GET').toUpperCase();
  if (u.endsWith('seed-data.json')) SEED_REQUESTS.push(u);
  if (m === 'GET' && u.endsWith('/api/me'))
    return res(200, { username: 'tester', role: 'user', user: { id: 'u_alice', name: '测试者' } });
  if (m === 'GET' && u.endsWith('/api/state')) return res(200, { rev: 1, data: TREE });
  if (m === 'GET' && u.endsWith('/system/library')) return res(200, {
    /* 第 1 项与个人库同名（夹具里的「米饭」/「杠铃卧推」）→ 系统分页应标「已有」；第 2 项未拥有 → 给「＋我的库」按钮 */
    foods: [{ id:'s1', name:'米饭', per100:{ kcal:116, p:2.6, c:25.9, f:0.3 }, src:'USDA' }, { id:'s2', name:'系统专属食物', per100:{ kcal:10, p:0, c:0, f:0 } }],
    exercises: [{ id:'se1', name:'杠铃卧推', cat:'力量', muscle:'胸', mode:'reps' }, { id:'se2', name:'系统专属动作', cat:'力量', muscle:'腿', mode:'reps' }],
  });
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
  XMLHttpRequest: null,};
sandbox.window = sandbox; sandbox.self = sandbox;
sandbox.window.scrollTo = () => {};
const ctx = vm.createContext(sandbox);

const readPub = p => fs.readFileSync(path.join(__dirname, '..', '..', 'public', p), 'utf8');
for (const f of ['js/seed-data.js', 'js/sleep-shape.js', 'js/app.js'])
  vm.runInContext(readPub(f), ctx, { filename: 'public/' + f });

/* 顶层 let/const 在上下文词法环境中,后续脚本可读写;Node 侧经 ev() 进入 */
const ev = code => vm.runInContext(code, ctx);
const view = doc.getElementById('view');
const sidebar = doc.querySelector('#sidebar');
const tabbar = doc.querySelector('#tabbar');

async function main() {
  /* 等启动链(init → 两次 fetch → go('home'))落地 */
  const t0 = Date.now();
  while (!view.__html && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 10));
  ok('T1a 启动冒烟:me/state → 概览渲染无异常', !!view.__html, '3s 超时:#view 始终为空');
  if (!view.__html) return finish();
  ok('T1b 概览关键块', view.__html.includes('>热量</span>') && view.__html.includes('🍽️ 今日饮食')
     && sidebar.__html.includes('navbtn active" data-go="home"'));
  ok('T1c 登录态与单人树', ev('me.username') === 'tester' && ev('USERS.active') === 'u_alice'
     && ev('Object.keys(USERS.users).length') === 1,
     `me=${ev('JSON.stringify(me&&me.username)')} active=${ev('USERS.active')}`);

  /* T1d 概览磁贴：热量 → BMI → 运动 → 打卡（BMI/运动为本轮新增；2026-09-12 标签去掉「今日」前缀） */
  const rowStart = view.__html.indexOf('<div class="row mt">');
  const tileRow = rowStart < 0 ? '' : view.__html.slice(rowStart, view.__html.indexOf('🍽️ 今日饮食'));
  const ti = ['热量','BMI','运动','打卡'].map(l => tileRow.indexOf('>' + l + '</span>'));
  ok('T1d 概览磁贴四张，顺序为 热量 → BMI → 运动 → 打卡',
     ti.every((i, k) => i >= 0 && (k === 0 || i > ti[k - 1])), 'idx=' + ti.join(','));
  const bmiV = ev('bmi()');
  /* 这里故意用测试侧独立阈值再算一遍，防渲染/色号写错（不对 bmiTone 自证） */
  const expTone = bmiV === null ? { t:'记录体重后查看', c:'' }
    : bmiV < 18.5 ? { t:'⚠ 偏瘦', c:'var(--cat1)' }
    : bmiV < 24   ? { t:'✓ 正常', c:'var(--brand)' }
    : bmiV < 28   ? { t:'⚠ 超重', c:'var(--warn)' }
    :               { t:'⚠ 肥胖', c:'var(--danger)' };
  const bmiTile = ti[1] < 0 ? '' : tileRow.slice(ti[1] - 40, ti[2]);
  /* 需 2026-09-12：分档小字钉在第二行数值右侧（数值 + val-tone 一行，标签行只剩「BMI」，仍不用 delta 行） */
  const toneSpan = '<span class="val-tone"' + (expTone.c ? ' style="color:' + expTone.c + '"' : '') +
    '>' + expTone.t + '</span>';
  ok('T1d BMI 磁贴 = 第二行「数值 + 分档小字」（标签行只剩 BMI，颜色与 bmiTone 同源，不用 delta 行）',
     bmiTile.includes('<div class="lab"><span>BMI</span></div>')
     && bmiTile.includes('<div class="val">' + (bmiV === null ? '--' : bmiV) + toneSpan + '</div>')
     && !bmiTile.includes('<div class="delta'),
     'bmi=' + bmiV + ' tone=' + expTone.t + '/' + expTone.c + ' tile=' + bmiTile);
  const expWk = ev("(function(){const d=workoutForDate(today());return d&&d.items.length?doneCount(d)+'/'+d.items.length:'休息';})()");
  ok('T1d 运动磁贴 = 当日已打勾项/全部项（今天没安排显示「休息」）',
     tileRow.slice(ti[2], ti[3]).includes(expWk === '休息' ? '>休息</div>' : '>' + expWk + '<span class="unit">项</span>'),
     'wk=' + expWk + ' tile=' + tileRow.slice(ti[2], ti[3]));

  /* T1e 概览「今日卡片」可拖动排序（2026-09-11）：容器内的卡片顺序 = state.homeOrder；
     顶部磁贴行不在容器里（固定不动）。纯函数 resolveHomeOrder/mergeOrder 直接断言 */
  const ho = () => ev("resolveHomeOrder(state.homeOrder).join(',')");
  ok('T1e1 默认顺序 饮食→运动→饮水→睡眠→打卡，磁贴行在容器外',
     ho() === 'diet,workout,water,sleep,habits'
     && view.__html.includes('<div class="home-cards" id="home_cards"><div class="card" data-hcard="diet" data-wide="1">')
     && view.__html.indexOf('data-hcard="water"') < view.__html.indexOf('data-hcard="sleep"')
     && view.__html.indexOf('data-hcard="sleep"') < view.__html.indexOf('data-hcard="habits"')
     && view.__html.indexOf('<div class="row mt">') < view.__html.indexOf('id="home_cards"'),
     'order=' + ho());
  ok('T1e2 resolveHomeOrder：丢未知 id / 去重 / 补缺（含未来新增的卡）',
     ev("resolveHomeOrder(['bogus','sleep']).join(',')") === 'sleep,diet,workout,water,habits'
     && ev("resolveHomeOrder(['habits','habits','water']).join(',')") === 'habits,water,diet,workout,sleep'
     && ev('resolveHomeOrder(null).join(",")') === 'diet,workout,water,sleep,habits',
     ev('JSON.stringify(resolveHomeOrder(["bogus","sleep"]))'));
  /* 隐藏卡（饮水目标=0）位次保留：以旧序里它后面第一个可见邻居为锚点插回 */
  ok('T1e3 mergeOrder：不可见的卡按后继锚点插回，正好不动时顺序一字不变',
     ev("mergeOrder(['diet','workout','sleep','habits'], ['diet','workout','water','sleep','habits']).join(',')") === 'diet,workout,water,sleep,habits'
     && ev("mergeOrder(['sleep','diet','workout','habits'], ['diet','workout','water','sleep','habits']).join(',')") === 'water,sleep,diet,workout,habits'
     && ev("mergeOrder(['diet','workout','water','sleep','habits'], ['diet','workout','water','sleep','habits']).join(',')") === 'diet,workout,water,sleep,habits'
     && ev("mergeOrder(['habits','sleep','water','workout','diet'], ['diet','workout','water','sleep','habits']).join(',')") === 'habits,sleep,water,workout,diet',
     ev("mergeOrder(['sleep','diet','workout','habits'], ['diet','workout','water','sleep','habits']).join(',')"));
  /* 自定义顺序真的落到 DOM（拖动保存后下次渲染就是这个顺序），每张卡都带抓手 */
  ev("state.homeOrder = ['habits','sleep','water','workout','diet']; renderHome()");
  ok('T1e4 按 state.homeOrder 渲染：卡顺序跟着改，每张卡都有抓手/标识',
     ['habits','sleep','water','workout','diet'].every((id, i, arr) =>
       (i === 0 || view.__html.indexOf('data-hcard="' + arr[i-1] + '"') < view.__html.indexOf('data-hcard="' + id + '"')))
     && (view.__html.match(/data-hcard-grip /g) || []).length === 5
     && view.__html.includes('<div class="card" data-hcard="habits" data-wide="1">'),
     view.__html.slice(view.__html.indexOf('id="home_cards"'), view.__html.indexOf('id="home_cards"') + 260));
  /* 饮水目标=0：该卡不渲染（其余 4 张顺序不变），位次由 mergeOrder 保住 */
  ev('state.homeOrder = ["diet","workout","water","sleep","habits"]; state.waterTarget = 0; renderHome()');
  ok('T1e5 饮水目标设 0：不渲染饮水卡，其余 4 张保持次序且都还在',
     !view.__html.includes('data-hcard="water"')
     && ['diet','workout','sleep','habits'].every(id => view.__html.includes('data-hcard="' + id + '"'))
     && (view.__html.match(/data-hcard-grip /g) || []).length === 4);
  ev('state.waterTarget = 8; state.homeOrder = HOME_ORDER_DEFAULT.slice(); renderHome()');

  /* T2 六页导航冒烟(顺序放最前:后续用例会改写 state)
     2026-09-11 顶栏移除后页面不再渲染标题,当前页由侧栏(桌面)/底栏(手机)高亮项标示,
     故这里守「导航高亮跟着 curView 走」+ 每页 view 有内容,不再断言顶栏标题 */
  const TITLES = { home:'概览', diet:'饮食', train:'运动', body:'身体', stats:'历史', settings:'设置' };
  for (const [v, tt] of Object.entries(TITLES)) {
    let err = null;
    try { ev(`go('${v}')`); } catch (e) { err = e; }
    ok('T2 页面冒烟 ' + v, !err && view.__html.length > 50
       && sidebar.__html.includes('navbtn active" data-go="' + v + '"') && sidebar.__html.includes(tt)
       && tabbar.__html.includes('tabbtn active" data-go="' + v + '"'),
       (err && err.message) || ('len=' + view.__html.length));
  }

  /* T2b 页面记忆(v4.14):go() 落盘上次页面;readView() 校验非法值回退概览。
   * 刷新保持页面的真实路径 = startMain 结尾 go(readView()),此处验纯函数与键名口径 */
  ok('T2b 导航落盘 + readView 还原(非法值回退概览)',
     ev('readView()') === 'settings' && ev('localStorage.getItem(viewKey())') === 'settings'
     && ev("localStorage.setItem('jjhealth_view:tester','diet'); readView()") === 'diet'
     && ev("localStorage.setItem('jjhealth_view:tester','bogus'); readView()") === 'home',
     'readView=' + ev('readView()'));

  /* T2g v4.15 数据管理子页面（食物库/动作库）的导航语义：不占侧栏/底栏项，借父级 settings 高亮，
   * 落盘也记 settings —— 刷新后落回设置页，而不是停在一个「返回」无处可去的半截子页 */
  ev("go('settings'); go('foodlib')");
  const subNav = {
    view: ev('curView') === 'foodlib',
    hi: sidebar.__html.includes('navbtn active" data-go="settings"'),
    tb: tabbar.__html.includes('tabbtn active" data-go="settings"'),
    noItem: !sidebar.__html.includes('data-go="foodlib"') && !tabbar.__html.includes('data-go="foodlib"'),
    stored: ev('localStorage.getItem(viewKey())') === 'settings',
    read: ev('readView()') === 'settings',
    head: view.__html.includes('id="fl_back"') && view.__html.includes('数据管理-食物库'),
  };
  ev("go('exlib')");
  subNav.view2 = ev('curView') === 'exlib' && view.__html.includes('id="xl_back"') && view.__html.includes('数据管理-动作库') && view.__html.includes('id="xl_search"');
  ev("go('settings')");
  ok('T2g 数据管理子页面：不占导航项、高亮父级设置、落盘记父级', Object.values(subNav).every(Boolean), JSON.stringify(subNav));

  /* T2h 滚动位置记忆（v4.15，手机端反馈）：换页记下离开那页的滚动量、回来原位恢复，
   * 且一律瞬时（behavior:'auto'）——旧写法 smooth 归零在手机上会先看到一段「往上滚」 */
  ev("window.scrollTo = o => { window.__scroll = o; };");
  ev("$('.main').scrollTop = 640");
  ev("go('foodlib')");
  const scrollRec = {
    saved: ev('viewScroll.settings && viewScroll.settings.main'),
    toTop: ev('window.__scroll.top'), auto: ev("window.__scroll.behavior === 'auto'"),
    now: ev("$('.main').scrollTop"),
  };
  ev("go('settings')"); scrollRec.restored = ev("$('.main').scrollTop");
  ev("go('foodlib')"); scrollRec.firstVisitTop = ev("$('.main').scrollTop");
  ev("go('settings'); $('.main').scrollTop = 0");
  ok('T2h 滚动位置记忆：离开记位置、返回原位恢复（瞬时，不再 smooth 归零）',
     scrollRec.saved === 640 && scrollRec.toTop === 0 && scrollRec.auto === true && scrollRec.now === 0
     && scrollRec.restored === 640 && scrollRec.firstVisitTop === 0
     && !readPub('js/app.js').includes("behavior:'smooth'"), JSON.stringify(scrollRec));
  ev("window.scrollTo = () => {};");   /* 还原桩,免得后续用例误以为在看真实滚动 */

  /* T2c–T2f 顶栏移除(2026-09-11):第一行整体删除;「我的档案」「切换深色/浅色」搬进设置页 */
  ok('T2c 第一行已移除:index.html 无 #topbar 槽位,renderView 也不再写它',
     !readPub('index.html').includes('id="topbar"') && doc.querySelector('#topbar').__html === '',
     'stub=' + JSON.stringify(doc.querySelector('#topbar').__html));
  ev("go('settings')");
  /* 档案卡 = 设置页首卡（2026-09-11 同日再改：起卡头行已删，卡上只剩「头像+昵称/账户」一行），
     取「基础资料」卡开头之前的那段：截到它前面最近的一个 <div class="card"> 为止，
     这样 st 里恰好只有档案卡自己 */
  const beforeBase = () => view.__html.lastIndexOf('<div class="card">', view.__html.indexOf('🧍 基础资料'));
  const st = view.__html.slice(0, beforeBase());
  ok('T2d 设置页首卡 = 我的档案(只读展示;卡头行与「修改档案」按钮已删,整块头像+昵称/账户即入口)',
     ['id="pf_edit"','登录账户','title="修改我的档案"','class="pf-hit"'].every(s => st.includes(s))
     && !st.includes('👤 我的档案') && !st.includes('<h3>') && !/>修改档案</.test(st)
     && !st.includes('id="pf_av"') && !st.includes('id="pf_save"') && !st.includes('id="pf_logout"'),
     st.slice(0, 140));
  /* 管理员 chip 只在 admin 下渲染,单独以 admin 重渲染一次;role 不影响后面的外观钮,故 st 仍复用 */
  ev("me.role = 'admin'; go('settings')");
  const stA = view.__html.slice(0, beforeBase());
  ev("me.role = 'user'; go('settings')");
  const pfCss = readPub('css/style.css');
  const chipRule = (pfCss.match(/^\.chip\{[^}]*\}/m) || [''])[0];   /* 只认 .chip 自身那条,文件别处的 nowrap 不算数 */
  const pfF = {
    top: st.includes('class="pf-top"'), id: st.includes('class="pf-id"'), noLrow: !st.includes('lrow'),
    chip: stA.includes('class="chip ok">管理员'),
    cssTop: pfCss.includes('.pf-top{'), cssNowrap: chipRule.includes('white-space:nowrap'),
    /* 入口用 span 承载两行文字(button 内不能放 div),block 化必须有对应 CSS 兜底 */
    cssHit: pfCss.includes('.pf-hit{') && pfCss.includes('.pf-hit .pf-id,'),
    clickable: ['type="button"','aria-label="修改我的档案"'].every(s => st.includes(s)),
    /* 卡上只剩「头像 + 昵称/账户」:概况串与底部提示小字已按用户要求删掉,残留的 pf-meta / 旧提示文案 / userMetaHTML 都算回归 */
    noMeta: !st.includes('pf-meta') && !st.includes('体重 ') && !st.includes('身体记录')
      && !st.includes('可改头像表情') && !pfCss.includes('.pf-meta{'),
    noDeadHelper: !readPub('js/app.js').includes('function userMetaHTML('),
  };
  ok('T2d3 档案卡只留头像+昵称/账户一行(概况与提示小字已删),chip 不竖排,不再复用 lrow',
     Object.values(pfF).every(Boolean), JSON.stringify(pfF));
  const pdlg = dlgHTML('openProfileDialog()');
  ok('T2d2 档案修改走弹窗:头像/昵称/标识色 + 保存;退出登录已移出弹窗、后台管理链接也不在弹窗里',
     !pdlg.startsWith('ERR:') && ['id="pf_av"','id="pf_name"','id="pf_color"','id="pf_save"']
       .every(s => pdlg.includes(s))
     && !pdlg.includes('id="pf_logout"') && !pdlg.includes('退出登录') && !pdlg.includes('href="/admin"'),
     pdlg.slice(0, 140));
  ev('closeDialog()');
  /* 主题切换 = 档案卡首行右端的图标钮:st 现在整段就是这张卡,先切出 .pf-top 那一行 */
  const rowS = st.indexOf('class="pf-top"');
  const pfRow = st.slice(rowS, st.indexOf('</div>', rowS));
  const tgIn = (h) => (h.match(/id="themeToggle"[^>]*>([^<]*)</) || [])[1] || '';
  ok('T2e 深色/浅色 = 档案卡「头像+昵称/账户」同一行右端的太阳/月亮图标钮(#themeToggle,排在 pf_edit 右侧)',
     pfRow.includes('id="themeToggle"') && st.includes('aria-label="切换深色/浅色"')
     && pfRow.indexOf('id="pf_edit"') < pfRow.indexOf('id="themeToggle"')      /* 图标钮在修改入口右侧 */
     && tgIn(st) === (ev('curTheme()') === 'dark' ? '🌙' : '☀️')          /* 图标 = 当前档位 */
     && (st.match(/<div class="card">/g) || []).length === 1             /* 档案卡与基础资料卡之间没有别的卡了 */
     && (st.match(/id="themeToggle"/g) || []).length === 1              /* 卡上只有这一颗主题钮 */
     && !st.includes('data-theme-set') && !st.includes('pf-theme') && !view.__html.includes('🎨 外观'),
     'theme=' + ev('curTheme()') + ' icon=' + tgIn(st) + ' cards=' + (st.match(/<div class="card">/g) || []).length);
  ev("setTheme('dark'); go('settings')");
  const tgDark = tgIn(view.__html);
  const darkOK = doc.documentElement.getAttribute('data-theme') === 'dark'
    && tgDark === '🌙' && ev("state.theme") === 'dark';
  ev("setTheme('bogus'); go('settings')");   /* 非法档位回落 light,重渲染后图标回到太阳(顺带复位主题状态) */
  const tgLight = tgIn(view.__html);
  ok('T2f setTheme 翻转根 data-theme,档案卡图标钮随之切月亮/太阳;非法值回落浅色',
     darkOK && doc.documentElement.getAttribute('data-theme') === 'light'
     && ev("state.theme") === 'light' && tgLight === '☀️',
     'dark=' + tgDark + ' light=' + tgLight + ' attr=' + doc.documentElement.getAttribute('data-theme') + ' theme=' + ev('state.theme'));

  /* T2g 后台管理入口 = 设置页最后一张卡(仅 admin;普通账户整卡不渲染 → 保持「用户端零管理功能」) */
  ev("me.role = 'user'; go('settings')");
  const noAdminCard = !view.__html.includes('后台管理') && !view.__html.includes('href="/admin"');
  /* 退出登录 = 设置页最下方那颗独立按钮：排在所有卡片(普通账户末卡=数据管理,admin 末卡=后台管理)之后 */
  const loUserH = view.__html, loUser = loUserH.indexOf('id="pf_logout"');
  ev("me.role = 'admin'; go('settings')");
  const hA = view.__html, aI = hA.indexOf('🛠 后台管理'), dI = hA.indexOf('💾 数据管理');
  const loA = hA.indexOf('id="pf_logout"');
  const loBtn = '<button class="btn danger ghost" id="pf_logout">⎋ 退出登录</button>';
  ok('T2g 后台管理入口独立成设置页最后一张卡(仅 admin,已从「我的档案」卡移出)',
     noAdminCard && aI > dI && aI > 0 && (hA.match(/href="\/admin"/g) || []).length === 1
     && hA.slice(aI).includes('进入后台管理') && hA.indexOf('href="/admin"') > dI,
     'adminCard@' + aI + ' dataCard@' + dI);
  ok('T2h 退出登录在设置页最下方(排在本页最后一张卡之后),两种视角都在,且自成一行不在卡内',
     loUser > loUserH.indexOf('💾 数据管理')                       /* user 视角:排在末卡数据管理之后 */
     && loA > aI && loA > dI                                        /* admin 视角:排在末卡后台管理之后 */
     && hA.includes('margin:4px 0 8px">' + loBtn + '</div>')        /* 自带 .row 包裹,不是卡片内的一颗 */
     && (hA.slice(loA).match(/<div class="card">/g) || []).length === 0,   /* 它后面再没有卡片了 */
     'user@' + loUser + ' admin@' + loA + ' card@' + aI);
  /* T2i 设置页小字瘦身(2026-09-12 用户要求):去掉与按钮并排、纯属重复的「点『X』可…」指引,
     及各卡提示尾部的操作说明;提示正文(用途/口径说明)保留 */
  const hints = loUserH + hA;
  const gone = ['点「修改资料」', '点「修改目标」', '在新标签页打开', '各设备登录同一账户'].filter(x => hints.includes(x));
  const dataCard = loUserH.slice(loUserH.indexOf('💾 数据管理'), loUserH.indexOf('id="pf_logout"'));
  ok('T2i 设置页小字瘦身(去「点『X』可…」与卡底多设备说明,保留用途正文与状态行)',
     gone.length === 0
     && loUserH.includes('用于估算每日营养目标') && loUserH.includes('；在「身体」页记录体重后会同步到这里。</div>')
     /* 正文里的口径说明仍在 */
     && loUserH.includes('饮水目标用于概览页「今日饮水」卡的达标判断，设为 0（不追踪）时概览页不再显示该卡。</div>')
     /* 数据管理卡：多设备说明已删，功能件与同步状态行仍在 */
     && dataCard.includes('id="st_sync"') && dataCard.includes('id="st_foodlib"') && dataCard.includes('id="st_wipe"')
     && dataCard.includes('在这里管理个人食物库与动作库')
     && !dataCard.includes('无需手动同步') && !dataCard.includes('历史备份可在上方')
     && hA.includes('管理员专属') && hA.includes('删除账户）。</div>'),
     'residual=' + JSON.stringify(gone) + ' dataCardLen=' + dataCard.length);
  /* T2j 设置页「每日目标」卡改名「营养目标」，并在卡内展示热量倾向档位
     （值取自 GOAL_MODE 单一来源 → 改档即刷新；未知档位回落「—」而不是 undefined） */
  const modeTile = () => ((view.__html.match(/<div class="lab">热量倾向<\/div><div class="val"[^>]*>([^<]*)<\/div>/) || [])[1] || '');
  const origMode = ev('state.goal.mode');
  ev("go('settings')");
  const nutTop = view.__html.indexOf('🥗 营养目标'), habitTop = view.__html.indexOf('📌 每日打卡');
  const nutCard = view.__html.slice(nutTop, habitTop);
  ev("state.goal.mode = 'cut'; go('settings')");       const mCut = modeTile();
  ev("state.goal.mode = 'maintain'; go('settings')");  const mKeep = modeTile();
  ev("state.goal.mode = 'bulk'; go('settings')");      const mBulk = modeTile();
  ev("state.goal.mode = 'bogus'; go('settings')");     const mBad = modeTile();
  ev("state.goal.mode = " + JSON.stringify(String(origMode)) + "; go('settings')");
  ev('closeDialog && curDialog && closeDialog()');
  ev('openNutritionEditor()');
  const nutDlg = ev('curDialog.el.__html');   /* 标题在 .d-h 里,不在 box(.d-b) 内 */
  ev('closeDialog()');
  ok('T2j 设置页卡改名「营养目标」并在卡内展示热量倾向（改档即刷新、未知档位回落 —）',
     nutTop > -1 && habitTop > nutTop
     && nutCard.includes('id="nut_edit"') && nutCard.includes('<div class="lab">热量倾向</div>')
     && nutCard.includes('<div class="lab">活动量</div>') && nutCard.includes('<div class="lab">每日饮水</div>')
     && !view.__html.includes('每日目标')                            /* 旧卡名零残留 */
     && mCut === '减脂' && mKeep === '保持' && mBulk === '增肌' && mBad === '—'
     && !nutDlg.startsWith('ERR:') && nutDlg.includes('修改营养目标'),   /* 编辑弹窗标题同步 */
     JSON.stringify({ mCut, mKeep, mBulk, mBad, dlg: nutDlg.slice(0, 60) }));

  /* T2j2 活动量 tile：档位名与括号里的补充说明拆两行——主行 19px，注行 tiny muted 小字（2026-09-12） */
  const actTile = () => {
    const i = view.__html.indexOf('<div class="lab">活动量</div>');
    const j = view.__html.indexOf('<div class="lab">热量倾向</div>');
    return (i < 0 || j < i) ? '' : view.__html.slice(i, j);
  };
  const origAct = ev('state.activity');
  ev("state.activity = 1.375; go('settings')"); const actMid = actTile();
  ev("state.activity = 1.725; go('settings')"); const actHigh = actTile();
  ev("state.activity = 9.9; go('settings')");   const actBad = actTile();
  ev("state.activity = " + JSON.stringify(Number(origAct)) + "; go('settings')");
  const actCard = view.__html.slice(view.__html.indexOf('🥗 营养目标'), view.__html.indexOf('📌 每日打卡'));
  ok('T2j2 活动量 tile 括号说明换行小字（主行 19px + tiny 注行），无括号的值不产生空注行',
     actMid.includes('>轻度<div class="tiny muted"') && actMid.includes('每周运动1-3次')
     && !actMid.includes('（') && actMid.includes('font-size:19px') && actMid.includes('font-weight:400')
     && actHigh.includes('>很高<div class="tiny muted"') && actHigh.includes('体力劳动/每日两练')
     && !actBad.includes('tiny muted') && actBad.includes('9.9')
     && !actCard.includes('（很少运动）') &&           /* 卡上不再出现带括号的整串标签 */
     /* 手机端两行各三格：两段网格都是固定三列（auto-fit 140px 在窄屏会降成 2 列排成 3/2/1） */
     (nutCard.match(/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/g) || []).length === 2
     && !nutCard.includes('auto-fit,minmax(140px'),
     JSON.stringify({ mid: actMid.slice(0, 190), bad: actBad.slice(0, 130) }));
  ev("me.role = 'user'; go('settings')");

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

  /* T3b4 条目行不再重复显能量：kcal 只在标题下方那行（`Ng · N kcal · P/C/F`）里出现一次，
   * 行尾只剩 ✏️ 一个图标钮（旧的右侧 `<div class="textright">N / kcal</div>` 已删） */
  const dietRow = (view.__html.match(/<div class="lrow" data-item="t_x1">[\s\S]*?<\/div><\/div>/) || [''])[0];
  ok('T3b4 饮食条目行不重复显能量（kcal 只在副标题行，行尾无 textright 数值块）',
     !view.__html.includes('class="textright"')
     && !!dietRow && dietRow.includes('150g · ' + x3.expKcal + ' kcal') && !dietRow.includes('textright')
     && (dietRow.match(/kcal/g) || []).length === 1,
     'n=' + (dietRow.match(/kcal/g) || []).length + ' row=' + dietRow.slice(-160));

  /* T3b5 行内删除钮已取消（用户裁定 2026-09-12）：条目行尾只留一颗 ✏️，删改走 `editMealDialog`
   * 里的「删除」（`#me_del` → `delMealItem`），Diet 页全页不再有 `data-del=` */
  ok('T3b5 饮食条目行行尾只有 ✏️（删除钮已去掉，删除走编辑弹窗）',
     /<div class="lrow" data-item="t_x1">[\s\S]*?<div class="grow">[\s\S]*?<\/div><button class="iconbtn2" data-edit="t_x1" title="修改">✏️<\/button><\/div>/.test(view.__html)
     && !view.__html.includes('data-del="')
     && !view.__html.includes('title="删除"'),
     'row=' + dietRow.slice(-200));

  let meDlgH = '';
  try { ev('closeDialog && curDialog && closeDialog()'); ev('editMealDialog(today(), "t_x1")');
    meDlgH = ev('curDialog.box.__html'); ev('closeDialog()'); }
  catch(e){ meDlgH = 'ERR:' + e.message; }
  ok('T3b6 编辑弹窗仍有「删除」（`#me_del` → delMealItem，行内钮去掉后唯一删除入口）',
     meDlgH.includes('id="me_del"') && meDlgH.includes('>删除</button>') && meDlgH.includes('id="me_save"'),
     'box=' + meDlgH.slice(0, 160));

  /* T3b2 用户 2026-09-12 先要把「＋ 添加」改成只带「＋」的圆钮，随后又裁定改回原来的文字版
   * （「添加还是改为原来的样式吧，就是『+添加』」）：卡头恒为一颗 `<button class="btn sm" data-addslot>`＋ 添加</button>`，
   * 四餐各一颗，不再有 `.btn.plus` 那个圆钮（样式类也已从 style.css 删掉）。 */
  ok('T3b2 四餐卡头是原来的文字版「＋ 添加」钮（`.btn sm` ×4，无 `.btn.plus` 圆钮）',
     (view.__html.match(/<button class="btn sm" data-addslot="[a-z]+">＋ 添加<\/button>/g) || []).length === 4
     && view.__html.includes('<button class="btn sm" data-addslot="breakfast">＋ 添加</button>')
     && view.__html.includes('<button class="btn sm" data-addslot="snack">＋ 添加</button>')
     && !view.__html.includes('class="btn plus"')
     && !view.__html.includes('data-addslot="breakfast" title='),
     'n=' + (view.__html.match(/class="btn sm" data-addslot/g) || []).length);

  /* T3b3 卡头顺序：图标+餐名 → 紧贴右侧的合计 kcal → grow → ＋（kcal 不再被 grow 推到最右） */
  ok('T3b3 四餐卡头里合计 kcal 紧贴餐名右侧（label + hint + grow + ＋）',
     ['breakfast', 'lunch', 'dinner', 'snack'].every(id => {
       const s = ev('SLOTS').find(x => x.id === id);
       const kcal = ev('mealSlotTotals(today(), "' + id + '")').kcal;
       return view.__html.includes(s.ic + ' ' + s.label + '<span class="hint">' + kcal + ' kcal</span><span class="grow"></span>');
     })
     && !view.__html.includes('<span class="grow"></span><span class="hint">'));

  /* T3c 概览「今日饮食」卡：有记录时卡底右对齐一个「＋ 记录一下」（与运动/睡眠卡同款同位；
   * 空态仍是卡体内居中的 primary「去记录」；绑定用单元素 querySelector,同页恰好一个 data-go2="diet"） */
  ev('renderHome()');
  const dietI = view.__html.indexOf('🍽️ 今日饮食');
  const dietCard = dietI < 0 ? '' : view.__html.slice(dietI, dietI + 1600);
  ok('T3c 有记录时卡底是「＋ 记录一下」（ghost + margin-left:auto，同运动/睡眠卡），上方有分隔线',
     dietCard.includes('kcal')
     && dietCard.includes('border-bottom:1px solid var(--line)"')   /* chips 行带分隔线 = 入口行上方的横线 */
     && dietCard.includes('<div class="row mt" style="align-items:center"><button class="btn sm ghost" data-go2="diet" style="margin-left:auto">＋ 记录一下</button></div>')
     && !dietCard.includes('>去记录<')
     && (view.__html.match(/data-go2="diet"/g) || []).length === 1,
     'n=' + (view.__html.match(/data-go2="diet"/g) || []).length);

  /* T3d 空态不变：卡体内居中的 primary「去记录」，不走卡底行 */
  const dietBackup = ev('JSON.stringify(state.meals[today()])');
  ev('state.meals[today()] = { breakfast:[], lunch:[], dinner:[], snack:[] }; renderHome()');
  ok('T3d 空态仍是居中 primary「去记录」',
     view.__html.includes('<button class="btn primary sm" data-go2="diet">去记录</button>')
     && !view.__html.includes('＋ 记录一下')
     && (view.__html.match(/data-go2="diet"/g) || []).length === 1,
     'n=' + (view.__html.match(/data-go2="diet"/g) || []).length);
  ev('state.meals[today()] = ' + dietBackup + '; renderHome()');

  /* T4 饮水卡显隐(PLANS/MEMO 记载的「目标 0 隐藏」契约) */
  ev('state.waterTarget = 0; renderHome()');
  ok('T4a 饮水目标 0 → 概览隐藏饮水卡', !view.__html.includes('💧 今日饮水'),
     '卡片标题仍出现(裸 💧 会撞习惯图标,断言锚定标题)');
  ev('state.waterTarget = 8; state.water[today()] = 3; renderHome()');
  ok('T4b 目标 8 · 已 3 → 显示「再喝 5 杯达标」',
     view.__html.includes('💧 今日饮水') && view.__html.includes('再喝 5 杯达标'));

  /* T5 睡眠多段合计（v4.6 多段化契约；v4.14：目标由 7h/420min 改为 10h/600min） */
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
  /* T5c 三档类型图标（2026-09-12）：每段行首 thumb 用自己那档的图标，三档互不相同 */
  ev(`state.sleep[today()] = [
    { t:'night', bed:'22:00', wake:'07:00', mins:540, quality:4 },
    { t:'nap',   bed:'13:00', wake:'13:30', mins:30,  quality:3 },
    { t:'rest',  bed:'16:00', wake:'16:20', mins:20,  quality:3 },
  ]; renderHome()`);
  const segIcons = ev("SLEEP_TYPES.map(t => '<div class=\"thumb\">' + t.ic + '</div>')");
  ok('T5c 今日睡眠卡：段首图标随类型走（🌙 / ⛅ / 🛋️ 三档互不相同）',
     segIcons.every(s => view.__html.includes(s)) && new Set(segIcons).size === 3,
     'icons=' + JSON.stringify(segIcons));
  /* T5d 质量星等（2026-09-12）：卡面小签 = 实心 ★ 个数即档位 + 空心 ☆ 补足 5 格；五档文案互不相同；无评分不渲染小签 */
  const starStr = ev('QUALITY.map(q => q.stars)');
  ok('T5d 质量五档星等文案 = ★×n + ☆×(5-n)，且五档互不相同',
     starStr.join('|') === '★☆☆☆☆|★★☆☆☆|★★★☆☆|★★★★☆|★★★★★' && new Set(starStr).size === 5,
     'stars=' + JSON.stringify(starStr));
  ok('T5d 卡面按各段自己的 quality 渲染小签（4 档 = 金 ★★★★ + 灰 ☆；3 档 = 金 ★★★ + 灰 ★☆…☆）',
     view.__html.includes('<span class="qstars"><span class="qf">★★★★</span><span class="qe">☆</span></span>') &&
     view.__html.includes('<span class="qstars"><span class="qf">★★★</span><span class="qe">☆☆</span></span>'),
     'html=' + (view.__html.match(/<span class="qstars">.*?<\/span><\/span>/g) || []).join(','));
  const starDlg = (function(){ try { ev('closeDialog && curDialog && closeDialog()'); ev('sleepSessionEditor(today(), 0)');
      return ev('curDialog.box.__html'); } finally { ev('closeDialog && curDialog && closeDialog()'); } })();
  ok('T5d 编辑器星级按钮 = 五颗固定 ★（亮起颗数由 paint() 按档位点亮，不再五张脸）',
     (starDlg.match(/data-q="[1-5]"/g) || []).length === 5 &&
     (starDlg.match(/>★<\/button>/g) || []).length === 5 &&
     !/[\u{1F600}-\u{1F64F}]/u.test(starDlg),      // 质量不再拿脸表情当档位
     'stars=' + (starDlg.match(/>★<\/button>/g) || []).length + ' q=' + (starDlg.match(/data-q="[1-5]"/g) || []).join(','));

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
  ok('T7m 逐项操作：行尾只有 ✏️（删除收进编辑弹窗），卡片上不再有 🗑 与「全部完成/取消」与整天级按钮',
     trainHTML.includes('data-itemedit="2026-09-05" data-item="wi6"')
     && !trainHTML.includes('data-itemdel')
     && !trainHTML.includes('title="删除">🗑')
     && !trainHTML.includes('data-allday') && !trainHTML.includes('data-wedit') && !trainHTML.includes('data-wdel')
     && !trainHTML.includes('✔ 全部完成') && !trainHTML.includes('↺ 全部取消'));

  /* 概览「今日运动」卡与运动页同一套逐项交互：卡头 ＋ 添加、行尾 ✏️（删除在编辑弹窗里） */
  ev("state.workouts.push({ id:'w_home', date:today(), name:'', items:[{ id:'wh1', exName:'自测深蹲', cat:'力量', muscle:'腿', reps:10 }] }); renderHome()");
  const homeHTML = view.__html;
  ev("setTrainWeek(mondayOf('2026-09-05'))");
  const subHTML = doc.getElementById('tabBody').__html;
  ok('T7o 名称下方小字显示大类 · 部位（力量 · 胸 / 有氧 · 全身）',
     subHTML.includes('<div class="sub">力量 · 胸</div>') && subHTML.includes('<div class="sub">有氧 · 全身</div>')
     && subHTML.includes('<div class="sub">柔韧 · 全身</div>'), 'sub=' + (subHTML.match(/<div class="sub">[^<]*<\/div>/g) || []).join(' , '));
  ok('T7n 概览今日运动卡：卡头只有卡名（+ 拖动抓手），进度 chip + 「＋ 添加运动」都在卡底最后一行（对齐今日睡眠卡）',
     homeHTML.includes('<div class="card" data-hcard="workout" data-wide="1"><h3><span>📋 今日运动</span>')
     && homeHTML.includes('data-hcard-grip title="按住拖动排序"')
     && homeHTML.includes('<div class="row mt" style="align-items:center"><span class="chip">0/1</span>'
        + '<button class="btn sm ghost" data-additem="' + ev('today()') + '" style="margin-left:auto">＋ 添加运动</button></div>')
     && !homeHTML.includes('今日运动</span><span class="chip')
     && homeHTML.includes('data-itemedit="' + ev('today()') + '" data-item="wh1"')
     && !homeHTML.includes('data-itemdel')
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
  const volSVG = doc.getElementById('st_vol').__html;
  ok('T9b 周图横轴为 W1…W12（不得出现 Wundefined）',
     /\>W\d+</.test(volSVG) && /\>W\d+</.test(minsSVG) && !volSVG.includes('undefined') && !minsSVG.includes('undefined'),
     'volX=' + (volSVG.match(/\>W\w*</g) || []).join(','));
  /* 2026-09-12 起睡眠时长卡调到体重趋势后面，睡眠/饮水不再相邻 → 不再用「两张图之间」取切片，
   * 改成对每张卡各自判它的外层包裹（卡内 `chart-card` 之前那层）= 普通 `<div>`、不是 `cols-2` 网格 */
  const soloWrap = id => {
    const o = view.__html, i = o.indexOf('id="' + id + '"');
    if (i < 0) return null;
    const k = o.lastIndexOf('<div class="chart-card', i);
    return k < 0 ? null : o.slice(Math.max(0, k - 30), k);
  };
  const sleepWrap = soloWrap('st_sleep'), waterWrap = soloWrap('st_water');
  ok('T9c 历史页睡眠/饮水卡各自独占一行（不共用一个 cols-2 网格）',
     !!sleepWrap && !!waterWrap && sleepWrap.endsWith('<div>') && waterWrap.endsWith('<div>')
     && !sleepWrap.includes('cols-2') && !waterWrap.includes('cols-2'),
     'sleep=' + sleepWrap + ' | water=' + waterWrap);
  ok('T9d 睡眠时长卡紧随体重趋势卡（睡眠→热量→宏量，2026-09-12 裁定）',
     (() => { const o = view.__html;
       const iW = o.indexOf('id="st_weight"'), iS = o.indexOf('id="st_sleep"'), iC = o.indexOf('id="st_cal"');
       return iW > -1 && iW < iS && iS < iC; })(),
     'weight=' + view.__html.indexOf('id="st_weight"') + ' sleep=' + view.__html.indexOf('id="st_sleep"')
       + ' cal=' + view.__html.indexOf('id="st_cal"'));

  /* T10 动作库行内版式：名称 + 「大类 · 部位 · 方式」小字（v4.15 的平铺表格已换成食物库同款 lrow） */
  const libRow = ev("exLibRowHTML(state.exercises.find(e => e.name === '杠铃卧推'), 'data-id=\"e0\"', '<button>✏️</button>')");
  ok('T10 动作库行内 = lrow（名称 + 大类 · 部位 · 方式小字）+ 行内按钮',
     libRow.includes('class="lrow"') && libRow.includes('data-id="e0"') && libRow.includes('杠铃卧推')
     && libRow.includes('力量 · 胸 · 计次') && libRow.includes('<button>✏️</button>'), libRow.slice(0, 200));

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
   * 这是浏览器里点得到、而其它用例覆盖不到的路径：计划编辑器 / 记录弹窗 / 动作选择器 / 动作库页面） */
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
  /* 新建：三 tab 录入（我的库 / 系统库 / 新增）；未选动作前只给选择入口，不先摆出数值框 */
  const fNew = itemFields('openItemDlg(today())');
  ok('T12b 新建态：三 tab + 两个库分页的搜索框/候选列表（在外层弹窗）；未选前只给选择入口 + 提示（无手填名称框、无数值框）', !fNew.startsWith('ERR:')
     && ['data-ittab="mine"', 'data-ittab="sys"', 'data-ittab="new"'].every(t => hItem.includes(t))
     && hItem.includes('id="it_q"') && hItem.includes('id="it_mylist"') && hItem.includes('id="it_qs"')
     && hItem.includes('id="it_syslist"') && hItem.includes('class="picklist"')
     && fNew.includes('还没选动作') && fNew.includes('先从动作库选一个动作')
     && !fNew.includes('id="it_reps"') && !fNew.includes('id="it_mins"'),
     fNew.startsWith('ERR:') ? fNew : fNew.slice(0, 240));
  /* 编辑 w3 第二项（拉伸 10 分钟，已完成）：计时形态 + 预填 + 15/30/45/60 快捷档 */
  const fTime = itemFields("openItemDlg('2026-09-03', 'wi4')");
  ok('T12c 编辑计时项：计时形态（自动）+ 预填 10 分钟 + 时长框自绘「常用时长」下拉', !fTime.startsWith('ERR:')
     && fTime.includes('⏱ 计时') && fTime.includes('value="10"') && fTime.includes('it_km')
     && fTime.includes('id="it_mins"') && fTime.includes('id="it_mins_btn"') && fTime.includes('id="it_mins_menu"')
     && fTime.includes('class="mins-wrap"') && fTime.includes('class="mins-menu"')
     && !fTime.includes('span2')   /* 计时与计次同版式：时长 + 距离 一行并排，不再各占整行 */
     && [15, 20, 30, 45, 60].every(n => fTime.includes('data-min="' + n + '">' + n + ' 分钟</button>'))
     && !fTime.includes('<datalist') && !fTime.includes('it_quick'),
     fTime.startsWith('ERR:') ? fTime : fTime.slice(0, 320));
  /* 编辑 w4 第一项（杠铃卧推 32 次 @70kg，已勾）：力量形态预填 + 选中态；修改态不再有「更换动作」 */
  const fReps = itemFields("openItemDlg('2026-09-05', 'wi5')");
  ok('T12d 编辑力量项：选中动作名回显 + 预填 32 次 / 70 kg，方式 chip 按「计次/计时」而非大类、无更换动作入口', !fReps.startsWith('ERR:')
     && fReps.includes('杠铃卧推') && fReps.includes('🔢 计次') && !fReps.includes('更换动作')
     && fReps.includes('value="32"') && fReps.includes('value="70"') && !fReps.includes('it_mins')
     && !fReps.includes('span2'),   /* 与计时同版式：两个数值框一行并排 */
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
  /* T12f 添加运动三 tab：结构 + 取数纯函数 + 「已有」提示（交互在桩里点不到，验结构与决策口径） */
  const hAdd = dlgHTML('openItemDlg(today())');
  const ownTip = ev("exOwnedTipHTML('杠铃卧推')");
  const picks = JSON.parse(ev(`JSON.stringify({
    mine: itPickOf('mine', { id:'e0', name:'杠铃卧推', cat:'力量', muscle:'胸', mode:'reps' }, null, null),
    sys: itPickOf('sys', null, { name:'系统专属动作', cat:'力量', muscle:'腿', mode:'reps' }, null),
    bare: itPickOf('sys', null, { name:'缺三件套的旧条目' }, null),
    newf: itPickOf('new', null, null, { name:'  新动作  ', cat:'有氧', muscle:'全身', mode:'time' }),
    aero: itPickOf('new', null, null, { name:'快走', cat:'有氧', muscle:'全身', mode:'reps' }),
    none: itPickOf('mine', null, null, null) === null && itPickOf('new', null, null, { name:'  ' }) === null
  })`));
  ok('T12f 添加运动三 tab：新增表单字段齐全 + 「保存后自动入库」说明；取数口径（我的库带 exId、系统库/新增不带，缺三件套按大类兜底）',
     !hAdd.startsWith('ERR:') && hAdd.includes('data-ittab="new"')
     && hAdd.includes('id="it_new_name"') && hAdd.includes('id="it_new_cat"') && hAdd.includes('id="it_new_muscle"') && hAdd.includes('id="it_new_mode"')
     && hAdd.includes('保存后会自动加入我的动作库') && !hAdd.includes('同时保存到我的动作库')
     && ownTip.includes('class="chip b3">已有<') && ownTip.includes('本次只记这一次运动')
     && picks.mine.exId === 'e0' && picks.mine.mode === 'reps'
     && picks.sys.exId === undefined && picks.sys.cat === '力量' && picks.sys.muscle === '腿'
     && picks.bare.cat === '其他' && picks.bare.muscle === '全身' && picks.bare.mode === 'reps'
     && picks.newf.name === '新动作' && picks.newf.mode === 'time' && picks.none === true
     && picks.aero.cat === '有氧' && picks.aero.mode === 'reps', JSON.stringify(picks));
  /* 修改态收敛：与 editMealDialog 一致——只改数值 + 删除，不再有换动作入口（旧的 openExercisePicker 已删） */
  const hItemEdit = dlgHTML("openItemDlg('2026-09-05', 'wi5')");
  ok('T12f2 修改态收敛：无三 tab、无「选择动作 / 更换动作」入口，只有数值 + 删除',
     !hItemEdit.startsWith('ERR:') && !hItemEdit.includes('data-ittab=') && !hItemEdit.includes('it_pick')
     && !hItemEdit.includes('更换动作') && !hItemEdit.includes('选择动作')
     && hItemEdit.includes('修改这一项') && hItemEdit.includes('it_del')
     && !readPub('js/app.js').includes('openExercisePicker') && !readPub('js/app.js').includes('libTableHTML'),
     hItemEdit.slice(0, 200));
  /* 动作库页面（v4.15 由弹窗改独立页；v4.16 起与食物库同一版式）：页头「返回 + 数据管理-动作库」，
   * 卡内 = seg tab（带条数）+ 搜索框 + #xl_body 列表行 */
  let hLib = '';
  try { ev("go('exlib')"); hLib = ev("$('#xl_body', $('#view')).__html"); }
  catch (e) { hLib = 'ERR:' + e.message; }
  ok('T12h 动作库页面：行内列表（名称 + 分类/方式小字）+ 卡头「＋ 添加动作」（录入表单已收进弹窗，页面上不再有输入框）',
     !hLib.startsWith('ERR:') && hLib.includes('我的动作库') && hLib.includes('class="lrow"')
     && hLib.includes('杠铃卧推') && hLib.includes('力量 · 胸 · 计次')
     && hLib.includes('id="nx_open"') && !hLib.includes('id="nx_name"') && !hLib.includes('id="nx_add"'), hLib.slice(0, 160));
  const hExAdder = dlgHTML('openExAdder()');
  ok('T12m 添加动作弹窗：名称 + 大类/部位/方式三件套 + 取消/添加（同名走 exDupInMine 拒绝，与编辑同口径）',
     !hExAdder.startsWith('ERR:') && hExAdder.includes('id="nx_name"') && hExAdder.includes('id="nx_cat"')
     && hExAdder.includes('id="nx_muscle"') && hExAdder.includes('id="nx_mode"')
     && hExAdder.includes('id="nx_add"') && hExAdder.includes('data-cancel')
     && readPub('js/app.js').includes('if(exDupInMine(name))'), hExAdder.slice(0, 200));
  /* 食物库页面：同一套页头契约（返回钮 + 标题），我的库分页有列表与逐行按钮，录入收进弹窗 */
  let hFood = '';
  try { ev("go('foodlib')"); hFood = ev("$('#fl_body', $('#view')).__html"); }
  catch (e) { hFood = 'ERR:' + e.message; }
  ok('T12k 食物库页面：页头返回 + 标题，列表 + 卡头「＋ 添加食物」（行内只剩删除，「＋记录」已移除）', !hFood.startsWith('ERR:')
     && view.__html.includes('id="fl_back"') && view.__html.includes('数据管理-食物库')
     && view.__html.includes('id="fl_seg"') && hFood.includes('id="nf_open"')
     && !hFood.includes('id="nf_name"') && !hFood.includes('id="nf_add"')
     && hFood.includes('data-delf=') && hFood.includes('data-editf=') && !hFood.includes('data-add=')
     && hFood.indexOf('data-editf=') < hFood.indexOf('data-delf=')   /* ✏️ 在 🗑 左边 */
     , hFood.slice(0, 160));
  const hFoodAdder = dlgHTML('openFoodAdder()');
  ok('T12n 添加食物弹窗：名称 + 四项营养 + 取消/添加',
     !hFoodAdder.startsWith('ERR:') && hFoodAdder.includes('id="nf_name"') && hFoodAdder.includes('id="nf_kcal"')
     && hFoodAdder.includes('id="nf_p"') && hFoodAdder.includes('id="nf_c"') && hFoodAdder.includes('id="nf_f"')
     && hFoodAdder.includes('id="nf_add"') && hFoodAdder.includes('data-cancel'), hFoodAdder.slice(0, 200));
  /* 两个分页的 tab 都带条数：我的库同步就有（内存），系统库要等进页那次 fetch 回来才填上 */
  ev('closeDialog && curDialog && closeDialog()');
  ev("foodLibTab = 'mine'; go('foodlib')");
  await new Promise(r => setTimeout(r, 20));
  const segTxt = ev("$('#fl_seg', $('#view')).__html");
  ok('T12y 食物库 tab 两个分页都显示条数（系统库条数由进页那次拉取回填，不靠切分页触发）',
     segTxt.includes('我的库（3）') && segTxt.includes('系统库（2）'), segTxt);
  /* 离线（系统库请求失败）：tab 上不许写 0（没数就不写），也不许把这次失败缓存住 */
  const realFetch = sandbox.fetch;
  sandbox.fetch = (u, o) => (String(u).includes('/system/library') ? Promise.resolve(res(500, { error: 'offline' })) : realFetch(u, o));
  ev("invalidateSysLib(); foodLibTab = 'mine'; go('foodlib')");
  await new Promise(r => setTimeout(r, 20));
  const segOff = ev("$('#fl_seg', $('#view')).__html");
  sandbox.fetch = realFetch;
  ok('T12y2 系统库拉不到时 tab 不显示条数（不写 0，也不缓存失败）',
     segOff.includes('我的库（3）') && segOff.includes('>系统库</button>'), segOff);
  /* 行内 ✏️ 编辑：名称 + 四项营养预填；没有营养表的旧条目不冒充 0 */
  const hFoodEditor = dlgHTML("openFoodEditor(state.foods.find(f => f.name === '米饭'), function(){})");
  const hFoodEditorEmpty = dlgHTML("openFoodEditor(state.foods.find(f => f.name === '无营养表食品'), function(){})");
  ok('T12z 编辑食物弹窗：名称 + 四项营养（已填的带原值、无营养表的留空）+ 取消/保存',
     !hFoodEditor.startsWith('ERR:') && hFoodEditor.includes('id="ef_name"') && hFoodEditor.includes('value="米饭"')
     && hFoodEditor.includes('id="ef_kcal"') && hFoodEditor.includes('value="116"')
     && hFoodEditor.includes('id="ef_p"') && hFoodEditor.includes('id="ef_c"') && hFoodEditor.includes('id="ef_f"')
     && hFoodEditor.includes('id="ef_save"') && hFoodEditor.includes('data-cancel')
     && !/不再跟随/.test(hFoodEditor)   /* 改来源是行为，不写成弹窗提示 */
     && !hFoodEditorEmpty.startsWith('ERR:') && (hFoodEditorEmpty.match(/inputmode="decimal" value=""/g) || []).length === 4
     && !hFoodEditorEmpty.includes('value="0"'), hFoodEditor.slice(0, 200));
  /* 保存口径：改完来源翻成「用户」（USDA 挑入的也不例外），重名/空名拒绝，写库由外面统一 save()；
   * 测完必须把改过的两条原样还原（后面的用例共用 state.foods） */
  const editRes = ev(`(function(){
    const foods = state.foods;
    const f = foods.find(x => x.name === '米饭');
    const bare = foods.find(x => x.name === '无营养表食品');
    const beforeF = { name: f.name, src: f.src, per100: f.per100 };
    const beforeBare = { name: bare.name, src: bare.src, per100: bare.per100 };
    const shot = () => JSON.stringify(foods.filter(x => x !== f && x !== bare).map(x => ({ id: x.id, name: x.name, src: x.src, per100: x.per100 || null })));
    const othersBefore = shot();
    const out = {};
    try {
      out.dup = applyFoodEdit(f, '无营养表食品', { kcal: 1, p: 1, c: 1, f: 1 });
      out.emptyName = applyFoodEdit(f, '   ', { kcal: 1 });
      out.ok = applyFoodEdit(f, '米饭（改）', { kcal: 150, p: 3, c: 28, f: 0.5 });
      out.name = f.name; out.src = f.src; out.per = f.per100;
      out.bare = applyFoodEdit(bare, '无营养表食品（改）', { kcal: '', p: '', c: '', f: '' });
      out.bareName = bare.name; out.bareHasPer = !!bare.per100; out.bareSrc = bare.src;
      const pad = { id: 'tmp_pad', name: '米饭 ', src: FOOD_SRC_USER, per100: { kcal: 1, p: 1, c: 1, f: 1 } };
      foods.push(pad);
      try { out.padded = applyFoodEdit(bare, '米饭', { kcal: 1 }); } finally { foods.pop(); }
      out.pushN = foods.length;
      out.othersSame = shot() === othersBefore;
    } finally {
      f.name = beforeF.name; f.src = beforeF.src;
      if (beforeF.per100 === undefined) delete f.per100; else f.per100 = beforeF.per100;
      bare.name = beforeBare.name; bare.src = beforeBare.src;
      if (beforeBare.per100 === undefined) delete bare.per100; else bare.per100 = beforeBare.per100;
    }
    return JSON.stringify(out);
  })()`);
  const er = JSON.parse(editRes);
  ok('T12z2 编辑保存：来源改记「用户」、重名/空名拒绝、无营养表留空仍无营养表、不动别的条目',
     er.dup === 'dup' && er.emptyName === 'name' && er.ok === '' && er.name === '米饭（改）'
     && er.src === '用户' && er.per.kcal === 150 && er.per.p === 3 && er.per.c === 28 && er.per.f === 0.5
     && er.bare === '' && er.bareName === '无营养表食品（改）' && er.bareHasPer === false && er.bareSrc === '用户'
     && er.padded === 'dup' && er.pushN === 3 && er.othersSame === true, editRes);
  ev('closeDialog && curDialog && closeDialog()');
  /* T12s 记录饮食弹窗（v4.15：三 tab）：我的库 / 系统库 / 新增 + 共用底栏（克数 + 实时合计 + 保存）
   * 默认停在「我的库」（不做跨次记忆）；弹窗内不是原生下拉而是 .seg + .picklist，避免 300+ 行 DOM */
  let hMeal = '', hMineList = '';
  try {
    ev('closeDialog && curDialog && closeDialog()');
    ev("addMealDialog(today(), 'dinner')");
    hMeal = ev('curDialog.box.__html');
    hMineList = ev("$('#mi_list', curDialog.box).__html");
  } catch (e) { hMeal = 'ERR:' + e.message; }
  ok('T12s 记录饮食弹窗：三 tab 分段 + 我的库候选行 + 共用底栏（只填克数）',
     !hMeal.startsWith('ERR:')
     && ['data-mtab="mine"', 'data-mtab="sys"', 'data-mtab="new"'].every(s => hMeal.includes(s))
     && hMeal.includes('id="md_p_mine"') && hMeal.includes('id="md_p_sys"') && hMeal.includes('id="md_p_new"')
     && hMeal.includes('id="mi_q"') && hMeal.includes('id="mi_list"') && hMeal.includes('class="picklist"')
     && hMeal.includes('id="mi_g"') && hMeal.includes('id="mi_prev"') && hMeal.includes('id="mi_save"')
     && hMeal.includes('id="mi_savefood"') && hMeal.includes('id="mi_owned"') && hMeal.includes('同时保存到我的食物库')
     && !hMeal.includes('营养按库锁定')
     && ev("mdTab") === 'mine'
     && ev("$('#md_p_sys', curDialog.box).style.display") === 'none'
     && ev("$('#md_p_new', curDialog.box).style.display") === 'none'
     && hMineList.includes('data-mypick='), (hMeal + ' | ' + hMineList).slice(0, 200));
  ev('closeDialog && curDialog && closeDialog()');
  /* 空库引导：个人库已清空是常态，我的库 tab 要告诉用户下一步去哪 */
  const hEmptyMine = (function(){
    ev('state.foods = []; addMealDialog(today(), "dinner");');
    const h = ev("$('#mi_list', curDialog.box).__html");
    ev('closeDialog && curDialog && closeDialog(); state.foods = USERS.shared.foods;');
    return h;
  })();
  ok('T12s2 我的库空库时给引导（去「系统库」挑 / 去「新增」手填），不再是一句「可手动填写」了事',
     hEmptyMine.includes('我的食物库是空的') && hEmptyMine.includes('系统库') && hEmptyMine.includes('新增'),
     hEmptyMine.slice(0, 160));
  /* 系统库 tab：进弹窗时拉一次（opts.tab 显式指定初始分页，不是跨次记忆），
   * 与自己库同名的标「已有」（与食物库页同一口径），未拥有的可选入 */
  ev('invalidateSysLib(); addMealDialog(today(), "dinner", { tab:"sys" })');
  await new Promise(r => setTimeout(r, 20));
  const hSysMeal = ev("$('#mi_syslist', curDialog.box).__html");
  const hMealPrev = ev("$('#mi_prev', curDialog.box).__html");
  const per100Shown = ev("$('#mi_per100', curDialog.box).style.display");
  ev('closeDialog && curDialog && closeDialog()');
  ok('T12s3 系统库 tab：候选行走接口缓存，同名标「已有」（与食物库页同口径），未选中时不摆每100g 回显',
     hSysMeal.includes('data-syspick=') && hSysMeal.includes('系统专属食物')
     && hSysMeal.includes('>已有<') && hSysMeal.includes('共 2 条')
     && (hSysMeal.match(/data-syspick=/g) || []).length === 2
     && per100Shown === 'none'
     && hMealPrev.includes('先选一个食物'), hSysMeal.slice(0, 240) + ' | ' + hMealPrev);
  /* 修改已记录的食物（用户裁定：只改克数 + 删除，不开放改营养、不写回库） */
  ev("(function(){ addMealItem(today(), 'lunch', { id:'t_edit1', name:'测试编辑', per100:{ kcal:200, p:20, c:10, f:5 }, g:120 }); })()");
  ev("editMealDialog(today(), 't_edit1')");
  const hMealEdit = ev('curDialog.box.__html');
  const hEditPrev = ev("$('#me_prev', curDialog.box).__html");
  ev('closeDialog && curDialog && closeDialog(); delMealItem(today(), "t_edit1")');
  ok('T12s4 修改记录弹窗只剩「克数 + 删除」（无三 tab、无营养输入、无入库勾选）',
     hMealEdit.includes('id="me_g"') && hMealEdit.includes('value="120"') && hMealEdit.includes('id="me_del"')
     && hMealEdit.includes('不支持改营养') && hMealEdit.includes('测试编辑')
     && !hMealEdit.includes('data-mtab') && !hMealEdit.includes('id="mi_kcal"') && !hMealEdit.includes('id="mi_name"')
     && !hMealEdit.includes('id="mi_savefood"') && !hMealEdit.includes('id="mi_q"'), hMealEdit.slice(0, 200));
  ok('T12s5 修改弹窗预填原克数，预览打开即按 per100×g/100 算合计（桩不解析 value 属性，算法走 mealPrevHTML 纯函数）',
     hMealEdit.includes('value="120"') && hEditPrev.length > 0
     && ev('mealPrevHTML({ kcal:200, p:20, c:10, f:5 }, 120)') === '合计：<b>240 kcal</b> · 蛋白 24g · 碳水 12g · 脂肪 6g'
     && ev('mealPrevHTML({}, 120)') === '合计：<b>0 kcal</b> · 蛋白 0g · 碳水 0g · 脂肪 0g', hEditPrev);
  /* 入库勾选默认口径（用户裁定 C）：只有系统库里「我还没有的」默认勾，
   * 已有的 / 新增 / 我的库 都不默认勾（新增要用户主动勾，避免手填半成品污染个人库） */
  ok('T12s6 默认勾选口径：系统库未拥有→默认勾、已有→不勾；新增/我的库→不默认勾',
     ev("mealDlgSaveDefault('sys','系统专属食物')") === true
     && ev('mealDlgSaveDefault("sys", state.foods[0].name)') === false
     && ev("mealDlgSaveDefault('new','自录新食物')") === false
     && ev('mealDlgSaveDefault("mine", state.foods[0].name)') === false);
  /* 新增 tab 填了库里已有的名字：不能默默跳过整段——勾选行换成「已有」提示，说清本次只记一餐不入库
   * （按名判重沿用同一个 owned 规则，不另立口径） */
  const dupName = ev('state.foods[0].name'), freshName = '图里暂时还没有的菜';
  ok('T12s8 同名不静默跳过：库里已有同名时不给入库勾选（新增/系统库同口径），新名字才给',
     ev('mealShowSaveChk("new", ' + JSON.stringify({ name: dupName }) + ')') === false
     && ev('mealShowSaveChk("new", ' + JSON.stringify({ name: freshName }) + ')') === true
     && ev('mealShowSaveChk("sys", ' + JSON.stringify({ name: dupName }) + ')') === false
     && ev('mealShowSaveChk("sys", ' + JSON.stringify({ name: freshName }) + ')') === true
     && ev('mealShowSaveChk("mine", ' + JSON.stringify({ name: freshName }) + ')') === false
     && ev('mealShowSaveChk("new", null)') === false);
  const tipHTML = ev('mealOwnedTipHTML(' + JSON.stringify(dupName) + ')');
  ok('T12s9 「已有」提示文案：只写口径（不入库/不改库里营养），不写「点「X」可…」操作指引',
     tipHTML.includes('class="chip b3">已有<') && tipHTML.includes('本次只记这一餐') && tipHTML.includes('不会入库')
     && !/点「.+」可/.test(tipHTML) && !readPub('js/app.js').includes('营养按库锁定'), tipHTML);
  ok('T12s7 饮食页 ✏️ 已改走 editMealDialog（只改克数），旧的「按名匹配回库」全字段编辑路径不再存在',
     (function(){ const a = readPub('js/app.js');
       return a.includes("editMealDialog(dietDate, b.dataset.edit)") && a.includes("addMealDialog(dietDate, b.dataset.addslot)")
         && !a.includes('slotOfItem(dietDate') && !a.includes('function addMealDialog(date, slot, itemId)'); })());
  /* 系统分页的「已有」标记（与个人库按名称比，与动作库同一口径）——
   * 桩不能点分页，但分页选择是页面级状态 foodLibTab/exLibTab，直接设好再进页即可。
   * 先重置系统库缓存，否则前面用例拉过的 mock 列表会盖掉本处的断言数据 */
  ev("invalidateSysLib(); foodLibTab = 'sys'; go('foodlib')");
  await new Promise(r => setTimeout(r, 20));
  const hSysF = ev("$('#fl_body', $('#view')).__html");
  const sysCount = { owned: (hSysF.match(/>已有<\/span>/g) || []).length, add: (hSysF.match(/>＋我的库<\/button>/g) || []).length };
  ok('T12o 食物库系统分页：与我的库同名的标「已有」，其余给「＋我的库」；系统分页只读（没有 ✏️/🗑）',
     !hSysF.startsWith('ERR:') && sysCount.owned === 1 && sysCount.add === 1
     && !hSysF.includes('data-editf=') && !hSysF.includes('data-delf=')
     && hSysF.indexOf('系统专属食物') < hSysF.indexOf('＋我的库</button>'), JSON.stringify(sysCount) + ' | ' + hSysF.slice(0, 120));
  /* 营养来源(src)：我的库每行名称旁显示来源小签（夹具条目无 src → 兜「用户」）；系统库条目为 USDA
   * （s1 是条目自带 src，s2 缺字段走 FOOD_SRC_SYS 兜底，两条都要显出来） */
  const chipRe = t => new RegExp('class="chip slot" style="margin-left:6px;font-weight:600">' + t + '<\\/span>', 'g');
  const mineUser = (hFood.match(chipRe('用户')) || []).length;
  const mineUsda = (hFood.match(chipRe('USDA')) || []).length;
  const sysChips = (hSysF.match(chipRe('USDA')) || []).length;
  ok('T12t 食物库行显示「营养来源」小签：条目自带 src 优先（米饭=USDA）、缺字段按所在库兜（我的库→用户、系统库→USDA）',
     mineUser === 2 && mineUsda === 1 && sysChips === 2,
     'mine用户=' + mineUser + ' mineUSDA=' + mineUsda + ' sysUSDA=' + sysChips);
  /* 从系统库挑进个人库：来源随条目一起过来（缺 src 的源条目按 USDA 兜底） */
  const srcKept = ev("(function(){ const n0 = state.foods.length;" +
    " importFoodFromSys({ name:'来源测试·显式', per100:{kcal:1,p:0,c:0,f:0}, src:'USDA' });" +
    " const a = state.foods[state.foods.length-1].src;" +
    " importFoodFromSys({ name:'来源测试·兜底', per100:{kcal:1,p:0,c:0,f:0} });" +
    " const b = state.foods[state.foods.length-1].src;" +
    " while(state.foods.length > n0) USERS.shared.foods.pop(); save(); return a + '/' + b; })()");
  ok('T12u 从系统库挑入：来源随条目一起进个人库（源条目缺 src 时按 USDA 兜底）', srcKept === 'USDA/USDA', srcKept);
  const appSrcTxt = readPub('js/app.js');
  /* 自录入库只有两个写库点（添加食物弹窗 + 记录饮食「新增」tab 的勾选入库），两处都得带 src=用户 */
  const userSrcWrites = appSrcTxt.split('\n').filter(l => l.includes('state.foods.push(') && l.includes('src:FOOD_SRC_USER')).length;
  ok('T12v 用户自录食物写来源「用户」（添加食物弹窗 + 记录饮食弹窗的「同时加入食物库」）',
     userSrcWrites === 2, '写库点=' + userSrcWrites);
  ev("invalidateSysLib(); exLibTab = 'sys'; go('exlib')");
  await new Promise(r => setTimeout(r, 20));
  const hSysE = ev("$('#xl_body', $('#view')).__html");
  const sysECount = { owned: (hSysE.match(/>已有<\/span>/g) || []).length, add: (hSysE.match(/>＋我的库<\/button>/g) || []).length };
  ok('T12p 动作库系统分页：同名的标「已有」（与食物库同口径）',
     sysECount.owned === 1 && sysECount.add === 1 && hSysE.indexOf('系统专属动作') < hSysE.indexOf('＋我的库</button>'), JSON.stringify(sysECount));
  /* 动作库 tab 两个分页都带条数（与食物库同口径：系统库条数由进页那次拉取回填）；离线时不写 0 */
  ev("exLibTab = 'mine'; exLibQuery = ''; exLibPage = 1; go('exlib')");
  await new Promise(r => setTimeout(r, 20));
  const segEx = ev("$('#xl_seg', $('#view')).__html");
  ok('T12y3 动作库 tab 两个分页都显示条数（系统库条数由进页那次拉取回填，不靠切分页触发）',
     segEx.includes('我的动作库（5）') && segEx.includes('系统动作库（2）'), segEx);
  sandbox.fetch = (u, o) => (String(u).includes('/system/library') ? Promise.resolve(res(500, { error: 'offline' })) : realFetch(u, o));
  ev("invalidateSysLib(); exLibTab = 'mine'; go('exlib')");
  await new Promise(r => setTimeout(r, 20));
  const segExOff = ev("$('#xl_seg', $('#view')).__html");
  sandbox.fetch = realFetch;
  ok('T12y4 动作库系统库拉不到时 tab 不显示条数（不写 0，也不缓存失败）',
     segExOff.includes('我的动作库（5）') && segExOff.includes('>系统动作库</button>'), segExOff);
  /* 行内 ✏️ 编辑（排在 🗑 左边）+ 编辑弹窗预填（三件套缺字段的旧条目预选默认值） */
  ev("exLibTab = 'mine'; go('exlib')");
  const hExMine = ev("$('#xl_body', $('#view')).__html");
  ok('T12z3 动作库我的库：每行 ✏️（排在 🗑 左边）+ 名称与「大类 · 部位 · 方式」小字',
     hExMine.includes('data-editx=') && hExMine.includes('data-delx=')
     && hExMine.indexOf('data-editx=') < hExMine.indexOf('data-delx=')
     && hExMine.includes('力量 · 胸 · 计次'), hExMine.slice(0, 200));
  const hExEditor = dlgHTML("openExEditor(state.exercises.find(e => e.name === '杠铃卧推'), function(){})");
  const hExEditorBare = dlgHTML("openExEditor(state.exercises.find(e => e.name === '缺三件套的裸条目'), function(){})");
  ok('T12z4 编辑动作弹窗：名称 + 大类/部位/方式预选原值 + 取消/保存；三件套缺字段的旧条目预选默认值（其他/全身/计次）',
     !hExEditor.startsWith('ERR:') && hExEditor.includes('id="ex_name"') && hExEditor.includes('value="杠铃卧推"')
     && hExEditor.includes('id="ex_cat"') && hExEditor.includes('id="ex_muscle"') && hExEditor.includes('id="ex_mode"')
     && hExEditor.includes('<option value="力量" selected>力量</option>')
     && hExEditor.includes('<option value="胸" selected>胸</option>')
     && hExEditor.includes('<option value="reps" selected>计次</option>')
     && hExEditor.includes('id="ex_save"') && hExEditor.includes('data-cancel')
     && !hExEditorBare.startsWith('ERR:')
     && hExEditorBare.includes('<option value="其他" selected>其他</option>')
     && hExEditorBare.includes('<option value="全身" selected>全身</option>')
     && hExEditorBare.includes('<option value="reps" selected>计次</option>'), hExEditor.slice(0, 240));
  ev('closeDialog && curDialog && closeDialog()');
  /* 保存口径：空名/重名拒绝、三件套写入、非法枚举保持原样、不动别的条目；测完原样还原 */
  const exEdit = JSON.parse(ev(`(function(){
    const exs = state.exercises;
    const e = exs.find(x => x.name === '引体向上');
    const before = { name:e.name, cat:e.cat, muscle:e.muscle, mode:e.mode };
    const shot = () => JSON.stringify(exs.filter(x => x !== e).map(x => ({ id:x.id, name:x.name, cat:x.cat, muscle:x.muscle, mode:x.mode })));
    const othersBefore = shot();
    const out = {};
    try {
      out.dup = applyExEdit(e, '杠铃卧推', '力量', '背', 'reps');
      out.emptyName = applyExEdit(e, '   ', '力量', '背', 'reps');
      out.ok = applyExEdit(e, '引体向上（改）', '有氧', '全身', 'time');
      out.after = { name:e.name, cat:e.cat, muscle:e.muscle, mode:e.mode };
      out.badEnum = applyExEdit(e, '引体向上（改）', '不存在的大类', '不存在的部位', 'bogus');
      out.kept = { cat:e.cat, muscle:e.muscle, mode:e.mode };
      out.othersSame = shot() === othersBefore;
    } finally {
      e.name = before.name; e.cat = before.cat; e.muscle = before.muscle; e.mode = before.mode;
    }
    return JSON.stringify(out);
  })()`));
  ok('T12z5 动作编辑保存：重名/空名拒绝、三件套写入、非法枚举保持原样、不动别的条目',
     exEdit.dup === 'dup' && exEdit.emptyName === 'name' && exEdit.ok === ''
     && exEdit.after.name === '引体向上（改）' && exEdit.after.cat === '有氧' && exEdit.after.muscle === '全身' && exEdit.after.mode === 'time'
     && exEdit.badEnum === '' && exEdit.kept.cat === '有氧' && exEdit.kept.muscle === '全身' && exEdit.kept.mode === 'time'
     && exEdit.othersSame === true, JSON.stringify(exEdit));
  /* T12z6 大类去掉「课程」：枚举只剩 5 类，库里残留的 cat='课程' 由 exTriple 兜底成「其他」 */
  const catEnum = ev('JSON.stringify(CATS)');
  const courseFb = JSON.parse(ev("JSON.stringify(exTriple({ name:'帕梅拉跳操', cat:'课程', muscle:'全身', mode:'time' }))"));
  ok('T12z6 大类枚举无「课程」（力量/有氧/球类/柔韧/其他）；残留课程条目兜底 = 其他 · 全身 · 计时',
     catEnum === '["力量","有氧","球类","柔韧","其他"]'
     && courseFb.cat === '其他' && courseFb.muscle === '全身' && courseFb.mode === 'time',
     catEnum + ' / ' + JSON.stringify(courseFb));
  ev("exLibQuery = ''; exLibPage = 1");
  ev("foodLibTab = 'mine'; exLibTab = 'mine'; go('settings')");
  /* 入口不再是弹窗：进入两个库页面不会往弹窗栈里加层；入口绑定直接走 go() */
  ev("closeDialog && curDialog && closeDialog()");   /* 先清掉上面两个录入弹窗 */
  const dlgDepth = ev('dialogStack.length');
  ev("go('foodlib')"); const d1 = ev('dialogStack.length');
  ev("go('exlib')"); const d2 = ev('dialogStack.length');
  ok('T12l 数据管理两个库已是页面而非弹窗（渲染不入栈，入口绑定 go()）', d1 === dlgDepth && d2 === dlgDepth
     && ev('curDialog === null') && ev('curView') === 'exlib'
     && readPub('js/app.js').includes("$('#st_foodlib').addEventListener('click', () => go('foodlib'))")
     && readPub('js/app.js').includes("$('#st_exlib').addEventListener('click', () => go('exlib'))"),
     'depth=' + dlgDepth + '/' + d1 + '/' + d2 + ' curView=' + ev('curView'));
  ev("go('settings')");

  /* T12q/T12r 食物库搜索 + 分页（321 条库的可用性）：注入 45 条验证每页 20 行、分页条与搜索过滤 */
  ev('__bakFoods = JSON.stringify(USERS.shared.foods)');
  ev("(function(){ const many = []; for(let i=0;i<45;i++) many.push({ id:'t'+i, name:'测试食物'+i, per100:{ kcal:100, p:1, c:1, f:1 } });" +
     " USERS.shared.foods = many; state.foods = many; foodLibTab='mine'; foodLibQuery=''; foodLibPage=1; go('foodlib'); })()");
  const hPaged = ev("$('#fl_body', $('#view')).__html");
  ok('T12q 食物库分页：搜索框 + 20 行/页 + 分页条',
     view.__html.includes('id="fl_search"') && (hPaged.match(/class="lrow"/g) || []).length === 20
     && hPaged.includes('第 1/3 页 · 共 45 条') && hPaged.includes('data-fpage="next"'), hPaged.slice(0, 120));
  ev("foodLibQuery='测试食物4'; foodLibPage=1; go('foodlib')");
  const hFiltered = ev("$('#fl_body', $('#view')).__html");
  ok('T12r 食物库搜索过滤：45 → 6 条（测试食物4 + 40..44）',
     (hFiltered.match(/class="lrow"/g) || []).length === 6 && hFiltered.includes('共 6 条'), hFiltered.slice(0, 120));
  ev("USERS.shared.foods = JSON.parse(__bakFoods); state.foods = USERS.shared.foods; foodLibQuery=''; foodLibPage=1; foodLibTab='mine'; go('settings')");

  /* T12q2/T12r2 动作库搜索 + 分页（与食物库同一套交互：20 条/页、两分页共用搜索词） */
  ev('__bakEx = JSON.stringify(USERS.shared.exercises)');
  ev("(function(){ const many = []; for(let i=0;i<45;i++) many.push({ id:'x'+i, name:'测试动作'+i, cat:'力量', muscle:'胸', mode:'reps' });" +
     " USERS.shared.exercises = many; state.exercises = many; exLibTab='mine'; exLibQuery=''; exLibPage=1; go('exlib'); })()");
  const hExPaged = ev("$('#xl_body', $('#view')).__html");
  ok('T12q2 动作库分页：搜索框 + 20 行/页 + 分页条（与食物库同一口径）',
     view.__html.includes('id="xl_search"') && (hExPaged.match(/class="lrow"/g) || []).length === 20
     && hExPaged.includes('第 1/3 页 · 共 45 条') && hExPaged.includes('data-fpage="next"'), hExPaged.slice(0, 120));
  ev("exLibQuery='测试动作4'; exLibPage=1; go('exlib')");
  const hExFiltered = ev("$('#xl_body', $('#view')).__html");
  ok('T12r2 动作库搜索过滤：45 → 6 条（测试动作4 + 40..44）',
     (hExFiltered.match(/class="lrow"/g) || []).length === 6 && hExFiltered.includes('共 6 条'), hExFiltered.slice(0, 120));
  ev("USERS.shared.exercises = JSON.parse(__bakEx); state.exercises = USERS.shared.exercises; exLibQuery=''; exLibPage=1; exLibTab='mine'; go('settings')");

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
      const bak = USERS;   /* adoptRaw 会把全局 USERS 换成这棵假树，验完必须还原（后面的断言还靠夹具树） */
      adoptRaw({ theme:'light', onboarded:false, shared:s, users:{ u_x:{ id:'u_x', name:'新人' } }, active:'u_x' });
      const r = [s.exercises.length, s.exercises[0].name];
      USERS = bak;
      return r; })(),
    wk: (function(){ const y0 = weeklyMinutes(12)[11].y, k0 = weeklyDistances(12)[11].y;
      state.workouts.push({ id:'w_t13', date:today(), name:'', items:[{ exName:'跑步', mins:30, km:5, done:true }, { exName:'操课', mins:15, done:true }] });
      return [weeklyMinutes(12)[11].y - y0, weeklyDistances(12)[11].y - k0]; })()
  })`));
  ok('T13a 旧树清洗：plans 作废、天级 done 下放到项、sets/同日/无日期丢弃、个人库原样保留',
     pure.legacy.plans === undefined && pure.legacy.workouts.length === 1
     && pure.legacy.workouts[0].id === 'w2' && pure.legacy.workouts[0].done === undefined
     && pure.legacy.workouts[0].note === undefined && pure.legacy.workouts[0].items.length === 1
     && pure.legacy.workouts[0].items[0].done === true
     && pure.libSeed[0] === 1 && pure.libSeed[1] === '杠铃卧推', JSON.stringify(pure.legacy) + JSON.stringify(pure.libSeed));
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

  /* T14 身体指标清单（v4.14）：新增「小腿围」= MEASURES 单一来源
     （磁贴/趋势下拉/记录表头/记录弹窗字段/upsertBody 白名单 五处同源） */
  ev("go('body')");
  const bHtml = view.__html;
  const mIds = ev('JSON.stringify(MEASURES.map(m => m.id))');
  ok('T14a 指标清单 8 项、含 calf、体脂率仍排最后',
     mIds === '["weight","chest","waist","hip","arm","thigh","calf","bf"]', mIds);
  ok('T14b 身体页磁贴/趋势下拉/记录表头都有「小腿围」，且磁贴显示夹具里的 37.5',
     (bHtml.match(/小腿围/g) || []).length >= 3 && bHtml.includes('>37.5<span class="unit">cm</span>'),
     'n=' + (bHtml.match(/小腿围/g) || []).length + ' v=' + bHtml.includes('37.5'));
  const hBody = dlgHTML('openBodyDialog()');
  ok('T14c 记录弹窗有小腿围输入框（data-m="calf"），体重仍标必填',
     !hBody.startsWith('ERR:') && hBody.includes('data-m="calf"') && hBody.includes('data-m="weight"')
     && (hBody.match(/class="input bd"/g) || []).length === 8,
     hBody.startsWith('ERR:') ? hBody : 'bd=' + (hBody.match(/class="input bd"/g) || []).length);
  ok('T14d upsertBody 白名单跟着 MEASURES 走（calf 能写入，state 复原）',
     ev("(function(){ const bak = JSON.parse(JSON.stringify(state.body)), kg = state.profile.currentKg;" +
        " upsertBody({ date:'2030-01-01', weight:70, calf:36.5 });" +
        " const r = state.body.find(x => x.date === '2030-01-01'); const okk = !!r && r.calf === 36.5;" +
        " state.body = bak; state.profile.currentKg = kg; return okk; })()") === true);

  /* T15a 用户路径不带调试代码、不注入 js/dev.js、也不下载种子数据本体（v4.16）：
     演示数据与自测已拆到 js/dev.js（按需注入），主包不应出现这些全局；
     用户端要系统库走 /api/system/library。
     三条互不依赖：① 全程没有 seed-data.json 请求；② 正常启动（location.search=''）没注入过
     任何 <script>；③ 主包**源码文本**里就没有调试代码（这条与「dev.js 是否已在本上下文加载」
     无关，T15a2 之后再跑也不会变味）。 */
  {
    const asked = SEED_REQUESTS.length === 0;
    const notInjected = INJECTED_SCRIPTS.length === 0;   /* 先量：启动全程没注入过 <script> */
    /* 再证记账是活的：手动追一个脚本节点应该被记下（否则上一条是空断言） */
    const probeNode = doc.createElement('script');
    probeNode.src = '__probe__';
    doc.head.appendChild(probeNode);
    const recorderLive = INJECTED_SCRIPTS.indexOf('__probe__') >= 0;
    INJECTED_SCRIPTS.length = 0;
    const mainSrc = readPub('js/app.js');
    const devTokens = ['DEMO_FOODS','DEMO_EXERCISES','demoData','seedRichMember','runSelfTest','runFTest','devHandle'];
    const noDevInMain = devTokens.every(g => mainSrc.indexOf(g) < 0);
    const noSeedGlobals = ev("(typeof SEED_READY === 'undefined') && (typeof onSeedReady === 'undefined') && (typeof SEED_LOAD_ERROR === 'undefined')") === true;
    const noDevGlobals = ev("(typeof demoData === 'undefined') && (typeof seedRichMember === 'undefined') && (typeof DEMO_FOODS === 'undefined') && (typeof runSelfTest === 'undefined') && (typeof runFTest === 'undefined') && (typeof window.__devHooks === 'undefined')") === true;
    ok('T15a 主包不含调试代码（源码文本 + 运行期全局），也不注入 js/dev.js、不请求 seed-data.json',
       asked && notInjected && recorderLive && noDevInMain && noSeedGlobals && noDevGlobals,
       'requests=' + JSON.stringify(SEED_REQUESTS) + ' injected=' + JSON.stringify(INJECTED_SCRIPTS) + ' recorder=' + recorderLive
       + ' srcClean=' + noDevInMain + ' noSeed=' + noSeedGlobals + ' noDev=' + noDevGlobals);
  }

  /* T15a2 js/dev.js 按需加载（classic script，同一全局作用域）后钩子可用，演示库内联在其中；
     并直接验一下 startMain 依赖的那条契约：非调试 URL 时 devHandle 返回 false（不接管）。
     放在此处会让后续断言看到 dev 代码，故紧随 T15a 验证完就继续往下跑（T15b 用它的 demoData）。 */
  {
    vm.runInContext(readPub('js/dev.js'), ctx, { filename: 'public/js/dev.js' });
    const loaded = ev("typeof demoData === 'function' && typeof runSelfTest === 'function' && typeof runFTest === 'function' && !!window.__devHooks && DEMO_FOODS.length >= 14 && DEMO_EXERCISES.length >= 11 && DEMO_FOODS.every(f => f.name && f.per100 && f.per100.kcal > 0) && DEMO_EXERCISES.every(e => e.name && e.cat && e.muscle && e.mode)") === true;
    const noTakeover = ev("window.__devHooks.handle(new URLSearchParams(''), {}) === false") === true;
    ok('T15a2 js/dev.js 单独加载即可用：demoData/runSelfTest/runFTest + __devHooks + 内联演示库；非调试 URL 不接管',
       loaded && noTakeover, 'loaded=' + loaded + ' noTakeover=' + noTakeover);
  }

  /* T15b 演示数据自给自足（v4.15 换 USDA 种子后按名匹配全落空、近 14 天餐食其实为空）：
     demoData()（现在住在 js/dev.js）后个人库 = 内联演示库、且按名字引用的餐食/运动真的落了数据。
     放在其余断言之后：它会覆盖当前账户数据（与调试钩子行为一致）。 */
  {
    const r = ev(`(function(){
      demoData();
      const days = Object.keys(state.meals).filter(d => SLOTS.some(sl => (state.meals[d][sl.id] || []).length > 0));
      const items = Object.keys(state.meals).reduce((n, d) => n + SLOTS.reduce((m, sl) => m + (state.meals[d][sl.id] || []).length, 0), 0);
      const wk = state.workouts.filter(w => w.items && w.items.length);
      const named = state.foods.every(f => f.name && f.per100 && f.per100.kcal > 0);
      return { foods: state.foods.length, ex: state.exercises.length, days: days.length, items: items,
               wk: wk.length, doneDays: wk.filter(w => w.items.some(i => i.done)).length, named: named };
    })()`);
    ok('T15b 演示数据：个人库 = 内联演示库，14 天餐饮/10 周运动真落数据（不再靠种子按名匹配）',
       r.foods === 14 && r.ex === 11 && r.days >= 13 && r.items > 30 && r.wk >= 20 && r.doneDays >= 20 && r.named === true,
       JSON.stringify(r));
  }

  /* T16 个人库初始为空（2026-09-12 用户裁定：注册不再导入系统库，前端同步拆掉两条「空库 → 种子」路径）
     · adoptRaw：采纳服务器树 / 本机缓存 / 导入备份时，空个人库原样保留；
     · bootUsers：无本机缓存的首次建档也建空库。
     旧写法「空就补一份种子」会让新账户在本机凭空长出 321 食物 + 27 动作，
     首次 save() 又把它们推回服务器——服务端的「注册不导入」就这样被前端悄悄抹掉
     （实测：改完服务端后注册的新账户个人库仍是 321+27）。 */
  {
    const bakUsers = ev('JSON.stringify(USERS)');
    const adoptEmpty = ev("(function(){ adoptRaw({ theme:'light', onboarded:false, shared:{ foods:[], exercises:[] }, users:{ u_x:{ id:'u_x', name:'新人' } }, active:'u_x' });"
      + " return USERS.shared.foods.length === 0 && USERS.shared.exercises.length === 0; })()");
    const adoptMalformed = ev("(function(){ adoptRaw({ theme:'light', onboarded:false, shared:{ foods:null, exercises:'x' }, users:{ u_x:{ id:'u_x', name:'新人' } }, active:'u_x' });"
      + " return Array.isArray(USERS.shared.foods) && USERS.shared.foods.length === 0"
      + " && Array.isArray(USERS.shared.exercises) && USERS.shared.exercises.length === 0; })()");
    const bootEmpty = ev("(function(){ const bk = localStorage.getItem(storeKey()); localStorage.removeItem(storeKey()); bootUsers();"
      + " const r = USERS.shared.foods.length === 0 && USERS.shared.exercises.length === 0;"
      + " if(bk) localStorage.setItem(storeKey(), bk); return r; })()");
    ev('USERS = JSON.parse(' + JSON.stringify(bakUsers) + ')');
    ok('T16 个人库初始为空：采纳空树/畸形库/无缓存建档都不再拿种子填满（空库就是空库）',
       adoptEmpty === true && adoptMalformed === true && bootEmpty === true,
       'adopt=' + adoptEmpty + ' malformed=' + adoptMalformed + ' boot=' + bootEmpty);
  }

  /* T19 时间滚轮（2026-09-12：手机端原生 time 输入弹的是系统「圆盘」时钟，改成上下滑动）
     · 结构：两列 scroll-snap + 中间高亮 band，值写在同名**隐藏 input** 里
     · 值契约与旧 time 输入一致（'HH:MM'），sleepDur / 存储形状零改动
     · 关键回归：stub 里量不到布局（col.scrollTop === undefined）时绝不许把值改写成 00:00 */
  {
    const noTimeInput = !readPub('js/app.js').includes('type="time"');
    /* 按列截段数项：`data-tw-col="h"` 到该列 `</div>` 之间就是这一列的 items */
    const colItems = (html, kind) => ((html.split('data-tw-col="' + kind + '"')[1] || '').split('</div>')[0].match(/tw-item/g) || []).length;
    const h = ev("timeWheelHTML('sq_bed', '23:35')");
    const hOff = ev("timeWheelHTML('sq_off', '23:07')");
    ok('T19a 时间滚轮结构：隐藏 input(HH:MM) + 小时/分钟两列 + 中线 band；原生 type="time" 已从 app.js 消失',
       noTimeInput && h.includes('<input type="hidden" id="sq_bed" value="23:35">')
       && colItems(h, 'h') === 24 && colItems(h, 'm') === 12
       && h.includes('class="tw-col" data-tw-col="h"') && h.includes('class="tw-col" data-tw-col="m"')
       && h.includes('class="tw-band"')
       && h.includes('class="tw-item on" data-n="23"') && h.includes('class="tw-item on" data-n="35"'),
       'h=' + colItems(h, 'h') + ' m=' + colItems(h, 'm'));
    /* 不在 5 分档位的旧记录（23:07）要把 7 分插进分钟列，且不许把它挪到 5/10 分 */
    ok('T19b 分钟列按 5 分档，但旧记录的 23:07 原样保留（13 项 + 07 选中 + 值不变）',
       colItems(hOff, 'm') === 13 && ev("twParts('23:07')[1]") === 7
       && hOff.includes('class="tw-item on" data-n="7"')
       && hOff.includes('value="23:07"'),
       'm=' + colItems(hOff, 'm'));
    ok('T19c twParts/twFmt 边界：7:5 归一化、25:00 与 12:99 与空值一律 null',
       ev("JSON.stringify(twParts('7:5'))") === '[7,5]' && ev("twFmt(7,5)") === '07:05'
       && ev("twParts('25:00') === null && twParts('12:99') === null && twParts('') === null && twParts(null) === null")
       && ev("twParts('23:35')[0] === 23"));
    /* 挂载路径：stub 没有布局/滚动，twPull 必须放过（否则一打开编辑弹窗就把 23:07 写成 00:00） */
    const mounted = ev("JSON.stringify((function(){ const box = curDialog.box, cb = function(){};"
      + " const w = timeWheelMount(box, 'sq_bed', '23:07', cb); twWrite(w); twPull(w); twWrite(w);"
      + " const keep = w.__twv.join(','); twSet(box, 'sq_bed', '07:30');"
      + " return { keep: keep, after: w.__twv.join(','), cbKept: w.__twcb === cb, backTo23: w.__twv.join(',') === '7,30' && w.__twcb === cb }; })())");
    const m = JSON.parse(mounted);
    ok('T19d 挂载/重画：无布局时值不被改写，换时段（twSet）改值且回调不丢',
       m.keep === '23,7' && m.after === '7,30' && m.cbKept === true, mounted);
    /* 编辑弹窗里两个时间位都换成滚轮，默认时段仍来自 SLEEP_TYPES */
    const sleepBak = ev('JSON.stringify(state.sleep[today()] || null)');
    ev('delete state.sleep[today()]');                     // 当天已有夜间段时新段默认「午睡」，这里要先归零
    const sqHtml = (function(){ try { ev('closeDialog && curDialog && closeDialog()'); ev("sleepSessionEditor(today(), null)");
      return ev('curDialog.box.__html'); } finally { ev('closeDialog && curDialog && closeDialog()'); } })();
    ev('state.sleep[today()] = ' + sleepBak);
    const bedItems = (sqHtml.match(/data-tw="sq_bed"/g) || []).length, wakeItems = (sqHtml.match(/data-tw="sq_wake"/g) || []).length;
    /* 标题在控件下面（用户 2026-09-12 要求，两格都要），顺序：滚轮 → label */
    const bedCap = sqHtml.indexOf('入睡'), bedWheel = sqHtml.indexOf('data-tw="sq_bed"');
    const wakeCap = sqHtml.indexOf('起床'), wakeWheel = sqHtml.indexOf('data-tw="sq_wake"');
    ok('T19e 睡眠段编辑弹窗：入睡/起床各一个滚轮（不再有原生时间控件），默认 23:30/07:00',
       bedItems === 1 && wakeItems === 1 && sqHtml.includes('value="23:30"') && sqHtml.includes('value="07:00"')
       && !sqHtml.includes('type="time"'),
       'bed=' + bedItems + ' wake=' + wakeItems);
    ok('T19f 入睡/起床的标题在滚轮下面（两格均是，标注居中用 .tw-cell）',
       bedCap > bedWheel && wakeCap > wakeWheel && bedWheel >= 0
       && (sqHtml.match(/class="tw-cell"/g) || []).length === 2,
       'bedWheel=' + bedWheel + ' bedCap=' + bedCap + ' wakeWheel=' + wakeWheel + ' wakeCap=' + wakeCap);
  }

  finish();
}

function finish() {
  /* stdout.write 回调触发时缓冲已冲刷——管道/重定向下 process.exit 才不会吞掉汇总行 */
  process.stdout.write('\nrender.test.js: ' + passed + ' passed, ' + failed + ' failed\n',
    () => process.exit(failed ? 1 : 0));
}
main().catch(e => { console.error('[CRASH]', e); process.exit(1); });
