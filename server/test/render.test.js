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
async function fakeFetch(url, opts) {
  const u = String(url), m = ((opts && opts.method) || 'GET').toUpperCase();
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
  XMLHttpRequest: function(){ const x = { status: 0, responseText: '' }; x.open = () => { x.status = 200; x.responseText = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'seed-data.json'), 'utf8'); }; x.send = () => {}; return x; },
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
const sidebar = doc.querySelector('#sidebar');
const tabbar = doc.querySelector('#tabbar');

async function main() {
  /* 等启动链(init → 两次 fetch → go('home'))落地 */
  const t0 = Date.now();
  while (!view.__html && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 10));
  ok('T1a 启动冒烟:me/state → 概览渲染无异常', !!view.__html, '3s 超时:#view 始终为空');
  if (!view.__html) return finish();
  ok('T1b 概览关键块', view.__html.includes('今日热量') && view.__html.includes('🍽️ 今日饮食')
     && sidebar.__html.includes('navbtn active" data-go="home"'));
  ok('T1c 登录态与单人树', ev('me.username') === 'tester' && ev('USERS.active') === 'u_alice'
     && ev('Object.keys(USERS.users).length') === 1,
     `me=${ev('JSON.stringify(me&&me.username)')} active=${ev('USERS.active')}`);

  /* T1d 概览磁贴：今日热量 → BMI → 今日运动 → 打卡（BMI/运动为本轮新增） */
  const rowStart = view.__html.indexOf('<div class="row mt">');
  const tileRow = rowStart < 0 ? '' : view.__html.slice(rowStart, view.__html.indexOf('🍽️ 今日饮食'));
  const ti = ['今日热量','BMI','今日运动','打卡'].map(l => tileRow.indexOf('>' + l + '</span></div>'));
  ok('T1d 概览磁贴四张，顺序为 今日热量 → BMI → 今日运动 → 打卡',
     ti.every((i, k) => i >= 0 && (k === 0 || i > ti[k - 1])), 'idx=' + ti.join(','));
  const bmiV = ev('bmi()');
  /* 这里故意用测试侧独立阈值再算一遍，防渲染/色号写错（不对 bmiTone 自证） */
  const expTone = bmiV === null ? { t:'记录体重后查看', c:'' }
    : bmiV < 18.5 ? { t:'⚠ 偏瘦', c:'var(--cat1)' }
    : bmiV < 24   ? { t:'✓ 正常', c:'var(--brand)' }
    : bmiV < 28   ? { t:'⚠ 超重', c:'var(--warn)' }
    :               { t:'⚠ 肥胖', c:'var(--danger)' };
  const bmiTile = ti[1] < 0 ? '' : tileRow.slice(ti[1] - 40, ti[2]);
  ok('T1d BMI 磁贴 = 分档数值 + 分档文案/颜色（与身体页 bmiTone 同源）',
     bmiTile.includes('>' + (bmiV === null ? '--' : bmiV) + '</div>') && bmiTile.includes('>' + expTone.t + '</div>')
     && (!expTone.c || bmiTile.includes('color:' + expTone.c)),
     'bmi=' + bmiV + ' tone=' + expTone.t + '/' + expTone.c + ' tile=' + bmiTile);
  const expWk = ev("(function(){const d=workoutForDate(today());return d&&d.items.length?doneCount(d)+'/'+d.items.length:'--';})()");
  ok('T1d 今日运动磁贴 = 当日已打勾项/全部项（今天没安排显示 --）',
     tileRow.slice(ti[2], ti[3]).includes(expWk === '--' ? '>--</div>' : '>' + expWk + '<span class="unit">项</span>'),
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

  /* T2b 页面记忆(未标版号):go() 落盘上次页面;readView() 校验非法值回退概览。
   * 刷新保持页面的真实路径 = startMain 结尾 go(readView()),此处验纯函数与键名口径 */
  ok('T2b 导航落盘 + readView 还原(非法值回退概览)',
     ev('readView()') === 'settings' && ev('localStorage.getItem(viewKey())') === 'settings'
     && ev("localStorage.setItem('jjhealth_view:tester','diet'); readView()") === 'diet'
     && ev("localStorage.setItem('jjhealth_view:tester','bogus'); readView()") === 'home',
     'readView=' + ev('readView()'));

  /* T2g 未标版号 数据管理子页面（食物库/动作库）的导航语义：不占侧栏/底栏项，借父级 settings 高亮，
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
  subNav.view2 = ev('curView') === 'exlib' && view.__html.includes('id="xl_back"') && view.__html.includes('数据管理-动作库') && view.__html.includes('<div id="xl_host">');
  ev("go('settings')");
  ok('T2g 数据管理子页面：不占导航项、高亮父级设置、落盘记父级', Object.values(subNav).every(Boolean), JSON.stringify(subNav));

  /* T2h 滚动位置记忆（未标版号，手机端反馈）：换页记下离开那页的滚动量、回来原位恢复，
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
  const stI = view.__html.indexOf('id="st_sleep"'), waI = view.__html.indexOf('id="st_water"');
  const gap = (stI > -1 && waI > stI) ? view.__html.slice(stI, waI) : '';
  ok('T9c 历史页睡眠/饮水卡各自独占一行（不再共用一个 cols-2 网格）',
     gap.includes('><div><div class="chart-card') && !gap.includes('grid cols-2'),
     'between=' + (gap ? gap.slice(-70) : '未找到两张图'));

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
  /* 动作库页面（未标版号 由弹窗改独立页）：页头「返回 + 数据管理-动作库」，内容在 #xl_host → #xl_body */
  let hLib = '';
  try { ev("go('exlib')"); hLib = ev("$('#xl_body', $('#xl_host')).__html"); }
  catch (e) { hLib = 'ERR:' + e.message; }
  ok('T12h 动作库页面：表格 + 卡头「＋ 添加动作」（录入表单已收进弹窗，页面上不再有输入框）',
     !hLib.startsWith('ERR:') && hLib.includes('我的动作库') && hLib.includes('<th>方式</th>')
     && hLib.includes('id="nx_open"') && !hLib.includes('id="nx_name"') && !hLib.includes('id="nx_add"'), hLib.slice(0, 160));
  const hExAdder = dlgHTML('openExAdder()');
  ok('T12m 添加动作弹窗：名称 + 大类/部位/方式三件套 + 取消/添加',
     !hExAdder.startsWith('ERR:') && hExAdder.includes('id="nx_name"') && hExAdder.includes('id="nx_cat"')
     && hExAdder.includes('id="nx_muscle"') && hExAdder.includes('id="nx_mode"')
     && hExAdder.includes('id="nx_add"') && hExAdder.includes('data-cancel'), hExAdder.slice(0, 200));
  /* 食物库页面：同一套页头契约（返回钮 + 标题），我的库分页有列表与逐行按钮，录入收进弹窗 */
  let hFood = '';
  try { ev("go('foodlib')"); hFood = ev("$('#fl_body', $('#view')).__html"); }
  catch (e) { hFood = 'ERR:' + e.message; }
  ok('T12k 食物库页面：页头返回 + 标题，列表 + 卡头「＋ 添加食物」（行内只剩删除，「＋记录」已移除）', !hFood.startsWith('ERR:')
     && view.__html.includes('id="fl_back"') && view.__html.includes('数据管理-食物库')
     && view.__html.includes('id="fl_seg"') && hFood.includes('id="nf_open"')
     && !hFood.includes('id="nf_name"') && !hFood.includes('id="nf_add"')
     && hFood.includes('data-delf=') && !hFood.includes('data-add='), hFood.slice(0, 160));
  const hFoodAdder = dlgHTML('openFoodAdder()');
  ok('T12n 添加食物弹窗：名称 + 四项营养 + 取消/添加',
     !hFoodAdder.startsWith('ERR:') && hFoodAdder.includes('id="nf_name"') && hFoodAdder.includes('id="nf_kcal"')
     && hFoodAdder.includes('id="nf_p"') && hFoodAdder.includes('id="nf_c"') && hFoodAdder.includes('id="nf_f"')
     && hFoodAdder.includes('id="nf_add"') && hFoodAdder.includes('data-cancel'), hFoodAdder.slice(0, 200));
  let hMeal = '', hPickList = '';
  try {
    ev('closeDialog && curDialog && closeDialog()');
    ev("addMealDialog(today(), 'dinner')");
    hMeal = ev('curDialog.box.__html');
    hPickList = ev("$('#mi_list', curDialog.box).__html");
  } catch (e) { hMeal = 'ERR:' + e.message; }
  ev('closeDialog && curDialog && closeDialog()');
  ok('T12s 记录饮食弹窗：搜索框 + 候选行，无 300+ 项原生下拉',
     !hMeal.startsWith('ERR:') && hMeal.includes('id="mi_q"') && hMeal.includes('id="mi_list"')
     && hMeal.includes('class="picklist"') && !hMeal.includes('id="mi_sel"')
     && hPickList.includes('data-pick='), (hMeal + ' | ' + hPickList).slice(0, 160));
  /* 系统分页的「已有」标记（与个人库按名称比，与动作库同一口径）——
   * 桩不能点分页，但分页选择是页面级状态 foodLibTab/exLibTab，直接设好再进页即可。
   * 先重置系统库缓存，否则前面用例拉过的 mock 列表会盖掉本处的断言数据 */
  ev("invalidateSysLib(); foodLibTab = 'sys'; go('foodlib')");
  await new Promise(r => setTimeout(r, 20));
  const hSysF = ev("$('#fl_body', $('#view')).__html");
  const sysCount = { owned: (hSysF.match(/>已有<\/span>/g) || []).length, add: (hSysF.match(/>＋我的库<\/button>/g) || []).length };
  ok('T12o 食物库系统分页：与我的库同名的标「已有」，其余给「＋我的库」',
     !hSysF.startsWith('ERR:') && sysCount.owned === 1 && sysCount.add === 1
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
  ok('T12v 用户自录食物写来源「用户」（添加食物弹窗 + 记录饮食弹窗的「同时加入食物库」）',
     (appSrcTxt.match(/src:FOOD_SRC_USER/g) || []).length === 2,
     String((appSrcTxt.match(/src:FOOD_SRC_USER/g) || []).length));
  ev("invalidateSysLib(); exLibTab = 'sys'; go('exlib')");
  await new Promise(r => setTimeout(r, 20));
  const hSysE = ev("$('#xl_body', $('#xl_host')).__html");
  const sysECount = { owned: (hSysE.match(/>已有<\/span>/g) || []).length, add: (hSysE.match(/>＋我的库<\/button>/g) || []).length };
  ok('T12p 动作库系统分页：同名的标「已有」（与食物库同口径）',
     sysECount.owned === 1 && sysECount.add === 1 && hSysE.indexOf('系统专属动作') < hSysE.indexOf('＋我的库</button>'), JSON.stringify(sysECount));
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

  /* T14 身体指标清单（未标版号）：新增「小腿围」= MEASURES 单一来源
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

  /* T15 种子读取失败路径：seed-data.json 拿不到时不能静默当「空库」正常用
     （旧版 loadSeedData 失败回退空数组；现要求记下 SEED_LOAD_ERROR 并 console.error） */
  {
    const errs = [];
    const badSandbox = {
      XMLHttpRequest: function(){ const x = { status: 404, responseText: '' }; x.open = () => {}; x.send = () => {}; return x; },
      console: { error: m => errs.push(String(m)) },
    };
    badSandbox.window = badSandbox;
    const badCtx = vm.createContext(badSandbox);
    vm.runInContext(readPub('js/seed-data.js'), badCtx, { filename: 'public/js/seed-data.js' });
    const empty = vm.runInContext('SEED_FOODS.length === 0 && SEED_EXERCISES.length === 0', badCtx);
    const errFlag = vm.runInContext('SEED_LOAD_ERROR', badCtx);
    ok('T15a 种子 404：SEED_FOODS 为空且记下 SEED_LOAD_ERROR + console.error',
       empty === true && !!errFlag && errs.length === 1, 'empty=' + empty + ' err=' + errFlag + ' logs=' + errs.length);
  }

  finish();
}

function finish() {
  /* stdout.write 回调触发时缓冲已冲刷——管道/重定向下 process.exit 才不会吞掉汇总行 */
  process.stdout.write('\nrender.test.js: ' + passed + ' passed, ' + failed + ' failed\n',
    () => process.exit(failed ? 1 : 0));
}
main().catch(e => { console.error('[CRASH]', e); process.exit(1); });
