/* =====================================================
   常量与工具
===================================================== */
/* 离线缓存按账户隔离:v3 起键名带用户名,同浏览器多账户互不污染 */
const AUTH_KEY = 'jjhealth_auth_user';
const AUTH_ROLE_KEY = 'jjhealth_auth_role';
function storeWho(){
  return (typeof me !== 'undefined' && me && me.username) || localStorage.getItem(AUTH_KEY) || 'guest';
}
function storeKey(){ return 'jjhealth_v3:' + storeWho(); }
/* 同步元数据:记录「最后一次与服务器对齐时的 rev」+ 是否有未推送改动(dirty)。
 * 用于关闭页面期间发生过的离线编辑:重开时与服务器 rev 比对,分叉则弹窗人工裁决,
 * 绝不在未提示的情况下用服务器数据覆盖本机未同步改动(也不反向静默覆盖)。 */
function metaKey(){ return 'jjhealth_v3meta:' + storeWho(); }
function metaGet(){ try { const m = JSON.parse(localStorage.getItem(metaKey())); if(!m) return null;
  /* v4.4:类型归一——rev 只认 number/null(历史脏数据/手改 localStorage 的字符串会让
   * 语义比较走样),gen 只认 number,其余一律归零/置空后按干净状态处理 */
  if(m.rev !== null && typeof m.rev !== 'number') m.rev = null;
  if(typeof m.gen !== 'number') m.gen = 0;
  return m; } catch(e){ return null; } }
function metaSet(m){ try { localStorage.setItem(metaKey(), JSON.stringify(m)); } catch(e){} }
const DAY_CN = ['日','一','二','三','四','五','六'];
const SLOTS = [
  {id:'breakfast', label:'早餐', ic:'🍳'},
  {id:'lunch',     label:'午餐', ic:'🍱'},
  {id:'dinner',    label:'晚餐', ic:'🍲'},
  {id:'snack',     label:'加餐', ic:'🥜'},
];
const ACTIVITIES = [
  {v:1.2,  label:'久坐（很少运动）'},
  {v:1.375,label:'轻度（每周运动1-3次）'},
  {v:1.465,label:'中度（每周运动3-5次）'},
  {v:1.55, label:'较高（每周运动6-7次）'},
  {v:1.725,label:'很高（体力劳动/每日两练）'},
];
/* 热量倾向对 TDEE 的增减档(v4.2 引入)：计算器 / 设置页营养目标说明 / ftest 断言共用此单一来源，
 * 杜绝魔法数三处抄写漂移（v4.3 审查修复）。
 * v4.4：展示文案/编辑器选项并入同一表——旧版用符号反推「减脂/增肌」文案、选项另抄一份。 */
const GOAL_MODE = {
  cut:      { adj:-400, label:'减脂', opt:'减脂（热量赤字）' },
  maintain: { adj:0,    label:'保持', opt:'保持' },
  bulk:     { adj:300,  label:'增肌', opt:'增肌（热量盈余）' },
};
const GOAL_ADJ = { cut: GOAL_MODE.cut.adj, maintain: GOAL_MODE.maintain.adj, bulk: GOAL_MODE.bulk.adj };
/* v4.8：「目标」页与 ⚙️ 设置合并为「设置」页，排在历史页之后 */
const NAV = [
  {id:'home',     label:'概览', ic:'🏠'},
  {id:'diet',     label:'饮食', ic:'🍽️'},
  {id:'train',    label:'运动', ic:'🏋️'},
  {id:'body',     label:'身体', ic:'📏'},
  {id:'stats',    label:'历史', ic:'📊'},
  {id:'settings', label:'设置', ic:'⚙️'},
];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const round = (n, d) => { const m = Math.pow(10, d); return Math.round(n * m) / m; };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtNum = n => Math.round(n).toLocaleString('zh-CN');

/* ---------- 日期工具 ---------- */
function toISO(d){ return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function today(){ return toISO(new Date()); }
function parseISO(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function addDays(s, n){ const d = parseISO(s); d.setDate(d.getDate()+n); return toISO(d); }
function weekday(s){ return parseISO(s).getDay(); }             // 0=周日
function dateCN(s){ const d = parseISO(s); return (d.getMonth()+1) + '月' + d.getDate() + '日'; }
function dateCNW(s){ const d = parseISO(s); return dateCN(s) + ' 周' + DAY_CN[d.getDay()]; }
function dateSlash(s){ const [y,m,d] = s.split('-'); return m+'/'+d; }
function lastNDates(n, end){ end = end || today(); const out = []; for(let i=n-1; i>=0; i--) out.push(addDays(end,-i)); return out; }
function age(){ return new Date().getFullYear() - state.profile.birthYear; }

/* =====================================================
   默认数据
===================================================== */
/* 食物/动作种子库:v4.3 起收敛到 js/seed-data.js 单一来源(index.html 先于本文件加载,
 * 服务端 server/seed.js require 同一份),此处不再另抄一份。 */
/* v4.11:动作库三件套枚举收敛到 seed-data.js 单一来源(admin.html 选择器同源;曾各抄一份互不感知)。
 * 内联数组仅为 seed-data.js 缺失时的兜底——增删枚举请改 seed-data.js 里的 SEED_CATS/SEED_MUSCLES/SEED_MODES。 */
const CATS    = (typeof SEED_CATS    !== 'undefined' && SEED_CATS)    || ['力量','有氧','球类','柔韧','其他'];
const MUSCLES = (typeof SEED_MUSCLES !== 'undefined' && SEED_MUSCLES) || ['胸','背','腿','肩','手臂','核心','全身','其他'];
const MODES   = (typeof SEED_MODES   !== 'undefined' && SEED_MODES)   || ['reps','time'];
const MODE_CN = (typeof SEED_MODE_CN !== 'undefined' && SEED_MODE_CN) || { reps:'计次', time:'计时' };
/* 展示排序：枚举顺序即展示顺序（大类 → 部位 → 名称） */
const CAT_RANK = {}, MUSCLE_RANK = {};
CATS.forEach((c, i) => { CAT_RANK[c] = i; });
MUSCLES.forEach((m, i) => { MUSCLE_RANK[m] = i; });
/* 表单默认值映射住在 seed-data.js（单一数据源），此处仅留文件缺失时的兜底 */
const defaultMuscle = (typeof muscleDefault === 'function') ? muscleDefault : (cat => (cat === '力量' ? '胸' : '全身'));
const defaultMode   = (typeof modeDefault   === 'function') ? modeDefault   : (cat => (cat === '力量' || cat === '其他' ? 'reps' : 'time'));

/* ---------- 多用户架构 ----------
 * USERS 是持久化容器：theme + 共享库(shared.foods/exercises) + 用户字典(users)。
 * state 是"当前用户的工作副本"，业务代码照旧读写 state.*，切换用户时重建 state。
 */
const USER_COLORS = [
  {id:'green',  hex:'#0e8a63'},
  {id:'blue',   hex:'#2a78d6'},
  {id:'orange', hex:'#eb6834'},
  {id:'violet', hex:'#4a3aa7'},
  {id:'teal',   hex:'#1baf7a'},
  {id:'pink',   hex:'#e87ba4'},
];
const USER_AVATARS = ['🙂','😊','🦁','🐱','🐶','🐼','🐯','🦊','🐸','🐰','🦄','⭐','🌱','⚡','💪','🏃','🍀','🌊','🔥','😎'];
const DATA_FIELDS = ['profile','goal','activity','waterTarget','nutrition','meals','workouts','body','habits','sleep','water','homeOrder'];
/* 概览页「今日卡片」的默认顺序（顶部磁贴行不参与拖动，见 renderHome/HOME_CARDS）。
 * 顺序存进本人数树 state.homeOrder＝这 5 个 id 的全排列，与「当前是否显示」无关
 * （饮水目标设 0 时卡不渲染，但它的位次保留，重新打开饮水后回到原位）。 */
const HOME_ORDER_DEFAULT = ['diet','workout','water','sleep','habits'];

/* 2026-09-12：个人库初始为空——「空库」不再拿种子填满（空库就是空库，要什么去系统库页挑）。 */
function freshShared(){ return { foods: [], exercises: [] }; }
function defaultHabits(){ return [
  {id:'h_water', name:'饮水达标', icon:'💧', color:'var(--cat1)', done:{}},
  {id:'h_work',  name:'完成运动', icon:'🏋️', color:'var(--cat2)', done:{}},
  {id:'h_sleep', name:'睡满7小时',icon:'😴', color:'var(--cat3)', done:{}},
  {id:'h_stretch',name:'拉伸放松', icon:'🧘', color:'var(--brand)', done:{}},
]; }
function freshUserData(){
  return {
    profile:{ gender:'male', birthYear:1992, height:175, currentKg:72 },
    goal:{ mode:'cut' },   /* mode = 热量倾向（cut/maintain/bulk），驱动营养自动计算 */
    activity:1.375,
    nutrition:{ auto:true, kcal:null, protein:null, carbs:null, fat:null },
    waterTarget:8,
    meals:{},
    workouts:[],
    body:[],
    habits: defaultHabits(),
    sleep:{},
    water:{},
    homeOrder: HOME_ORDER_DEFAULT.slice(),
  };
}
function newUser(name, avatar, colorId){
  const u = freshUserData();
  u.id = uid(); u.name = name; u.avatar = avatar; u.color = colorId;
  return u;
}
function userColorHex(id){ const c = USER_COLORS.find(x => x.id === id); return c ? c.hex : '#0e8a63'; }
function userCount(){ return Object.keys(USERS.users).length; }

/* ---------- 持久化 ---------- */
let USERS = null;
let state = null;

/* ---------- 运动安排形状清洗（幂等，客户端兜底） ----------
 * 服务端 wipeLegacyWorkout() 已做一次性重置；但「本机脏缓存回推」「本机为准覆盖服务器」
 * 「导入旧备份」三条路径仍可能把旧形状送回来。清洗收在 adoptRaw→ensureUserIntact 这一个咽喉
 * （缓存树/服务器树/导入树都过这里），且必须与服务端 insertUserData 的落库规则逐条对齐
 * （缺 date / 同日重复 / 项级 done 真值化 / 丢 note），否则 PUT≠GET，同步会反复抖动：
 *   · v4.12（同版本第二步）：`done` 由「一天」下放到「每一项」——旧的天级 done=true 下发给它每一项，
 *     再删掉天级键（与服务端 migrate() 的回填同口径）；
 *   · v4.12：`plans` 键存在 = v4.11 树 → 周计划整体作废；原 workouts 本来就来自「运动日志」，
 *     一律把每一项补 done:true（不然它们会在合并后变成一堆“未开始”），然后按 date 去重；
 *   · v4.11：运动项带 sets 键 = sets 时代旧形状 → 按裁定丢弃；整条因此空掉则移除；
 *   · 个人动作库整份缺 mode = 旧库 → 整份换新种子（与旧库作废同口径），避免半新半旧。
 * 新形状原样通过，不动任何数据。 */
let legacyShapeCleaned = false;   /* 本进程是否清洗过；boot/导入后据此补一次 save + 提示 */
function isLegacyWorkoutItem(it){ return !!(it && typeof it === 'object' && Object.prototype.hasOwnProperty.call(it, 'sets')); }
function normalizeWorkoutDays(u){
  if(!Array.isArray(u.workouts)) u.workouts = [];
  const hadPlans = u.plans !== undefined && u.plans !== null;
  if(hadPlans){ delete u.plans; legacyShapeCleaned = true; }   /* v4.12：周计划整体作废 */
  const seen = {};
  u.workouts = u.workouts.filter(w0 => {
    if(!w0 || typeof w0 !== 'object' || Array.isArray(w0)){ legacyShapeCleaned = true; return false; }
    /* 一天一条：date 就是身份，没有日期/同日重复的条目落库即冲突，就地丢弃 */
    if(typeof w0.date !== 'string' || !w0.date){ legacyShapeCleaned = true; return false; }
    if(seen[w0.date]){ legacyShapeCleaned = true; return false; }
    const rawItems = Array.isArray(w0.items) ? w0.items : [];
    const items = rawItems.filter(it => !isLegacyWorkoutItem(it));
    if(items.length !== rawItems.length){
      legacyShapeCleaned = true;
      if(!items.length) return false;                             /* 只剩旧形状项 → 整条作废 */
    }
    seen[w0.date] = true;
    w0.items = items;
    if(!w0.id) w0.id = uid();
    delete w0.note;                                               /* v4.12：note 已并入 name，不再落库 */
    /* v4.12：天级 done 下放到每一项（含 v4.11 树的“原日志都是完成的”那一档） */
    const dayDone = !!w0.done || hadPlans;
    if(w0.done !== undefined) delete w0.done;
    w0.items.forEach(it => {
      if(dayDone || it.done) it.done = true; else delete it.done; /* 假值不落键，与服务端 NULL↔缺键对齐 */
    });
    return true;
  });
}
function ensureUserIntact(u){
  /* v4.3 修复:逐字段只补缺失键。旧写法"任一字段缺失就 Object.assign 整份 freshUserData"
   * 会把导入备份里已在场的其余字段一并重置为默认值(静默丢数据)。 */
  const fresh = freshUserData();
  DATA_FIELDS.forEach(k => { if(u[k] === undefined) u[k] = fresh[k]; });
  if(u.meals === undefined) u.meals = {};
  if(u.sleep === undefined) u.sleep = {};
  if(u.water === undefined) u.water = {};
  /* 睡眠多段化 + 形状清洗：缓存树与服务器树都经 adoptRaw→ensureUserIntact 这一个
   * 咽喉，无需存储版本号（幂等，规范形状原样通过）。裁决规则唯一来源 = js/sleep-shape.js 的
   * normalizeSleepDay，服务端写库走同一份函数——两侧必须一致，否则本机留着服务器不存的
   * 脏日期（空数组、[null]、标量），每次同步形状抖动，脏值还会在渲染时把整页抛崩。 */
  if(!u.sleep || typeof u.sleep !== 'object' || Array.isArray(u.sleep)) u.sleep = {};
  Object.keys(u.sleep).forEach(d => {
    const segs = normalizeSleepDay(u.sleep[d]);
    if(segs) u.sleep[d] = segs; else delete u.sleep[d];
  });
  if(u.habits === undefined || !u.habits.length) u.habits = defaultHabits();
  normalizeWorkoutDays(u);   /* 运动：计划/记录合并后的形状清洗（见上） */
  /* 概览卡顺序：去重/丢未知 id/补缺（缓存树/服务器树/导入树共用这一处咽喉，同 sleep 的做法） */
  u.homeOrder = resolveHomeOrder(u.homeOrder);
  if(!u.color) u.color = 'green';
  if(!u.avatar) u.avatar = '🙂';
  if(!u.name) u.name = '未命名';
}
function adoptRaw(raw){
  if(raw && raw.users && raw.shared){
    USERS = raw;
    /* 2026-09-12（用户裁定）：个人库为空就让它空着——旧写法「空就补一份种子」会让
     * 新账户启动时本机凭空长出 321 食物 + 27 动作，首次 save() 又把它们推回服务器，
     * 等于变相自动导入系统库。这里只把畸形（非数组）收敛成空数组。 */
    if(!Array.isArray(USERS.shared.foods)) USERS.shared.foods = [];
    if(!Array.isArray(USERS.shared.exercises)) USERS.shared.exercises = [];
    Object.keys(USERS.users).forEach(id => ensureUserIntact(USERS.users[id]));
    if(!USERS.users[USERS.active]) USERS.active = Object.keys(USERS.users)[0] || null;
    return true;
  }
  return false;
}
/* ---------- 账户身份(v4) ----------
 * me = {username, role, user:{id,…}} | null。所有请求由服务端按登录身份绑定数据,
 * 客户端 USERS 字典恒收敛为「单一成员 = 本账户档案」(adoptRaw/bootUsers/导入后重挂)。 */
let me = null;
function selfUid(){ return (me && me.user && me.user.id) || null; }
function normalizeSelfTree(){
  const sid = selfUid(); if(!sid || !USERS) return;
  let u = USERS.users[USERS.active] || null;
  if(!u){ const k = Object.keys(USERS.users)[0]; if(k) u = USERS.users[k]; }
  USERS.users = {}; USERS.active = null;
  if(!u){
    u = freshUserData();
    u.name = (me.user && me.user.name) || '我';
    u.avatar = (me.user && me.user.avatar) || '🙂';
    u.color = 'green';
  }
  u.id = sid; if(!u.name) u.name = '我';
  USERS.users[sid] = u; USERS.active = sid;
}
function bootUsers(){
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(storeKey())); } catch(e){ raw = null; }
  if(adoptRaw(raw)){ normalizeSelfTree(); return; }
  // —— 无本机缓存:以登录账户身份建单人档案 ——
  USERS = { theme:'light', onboarded:false, shared: freshShared(), users:{}, active:null };
  const sid = selfUid();
  const u = newUser((me && me.user && me.user.name) || '我', (me && me.user && me.user.avatar) || '🙂', 'green');
  if(sid) u.id = sid;
  USERS.users[u.id] = u; USERS.active = u.id;
}
function activeUser(){ return USERS.users[USERS.active]; }
function materialize(){
  const u = activeUser();
  state = { theme: USERS.theme, foods: USERS.shared.foods, exercises: USERS.shared.exercises };
  DATA_FIELDS.forEach(k => state[k] = u[k]);
}
function persistActive(){
  const u = activeUser();
  DATA_FIELDS.forEach(k => { u[k] = state[k]; });
}
async function load(){
  /* 启动顺序：先问服务器（局域网约 1-3ms），不可达才降级到本机 localStorage。
   * 服务器为空时，本次 save() 会把本机数据自动上推 = 首次建档。
   * v4.1 防丢改动：本机缓存带 dirty 标记（上次关闭时有未推送编辑）时——
   *   服务器 rev 未动 → 直接补推本机；rev 动了 → 弹窗人工裁决，绝不静默覆盖任何一边。
   * v4.3 审查修复：
   *   · 干净启动（刚采纳服务器数据、本机无改动）不再无条件 save()——旧写法把零编辑
   *     也标成 dirty，600ms 内关页会让下次启动误报「有未同步改动」，选「本机为准」
   *     还会把上次缓存推上去覆盖服务器更新。现在只在真正需要补推/首次建档/本机覆盖时推送。
   *   · 校验 adoptRaw 返回值：服务器坏形状不再写入毒缓存、不标「已对齐」。
   * v4.4：在线启动的裁决全部收敛到 converge()（与回线重试、409 冲突同一套规则）；
   *   完全离线启动无论脏净都挂 30s 回线定时器——此前干净缓存启动永不重连
   *   （重试链只在「推送失败」路径建立），服务器恢复后不自动拉取其他设备的写入，
   *   状态栏却还承诺「每 30 秒自动重试」。 */
  const remote = await fetchState();
  if(remote){
    const outcome = await converge(remote);
    if(outcome === 'push'){ bootUsers(); save(); }              /* 本机为准/补推：读缓存后整树推送 */
    else if(outcome === 'adopt-fail'){ srv.rev = null; bootUsers(); toast('服务器响应形状异常，本次启动使用本机缓存', true); }
    /* outcome==='adopt'：adoptRemote 已回写缓存并标对齐，无需再推 */
    materialize(); applyTheme();
    syncLegacyCleanup();   /* v4.11：采纳到旧形状时补一次回写（含向服务器推送清洗后的树） */
    return;
  }
  bootUsers();   /* 完全离线：读本机缓存，dirty 状态原样保留，等回线收敛裁决/补推 */
  materialize(); applyTheme();
  syncLegacyCleanup();
  const meta = metaGet();
  const needPush = !localStorage.getItem(storeKey()) || !!(meta && meta.dirty);
  if(needPush) save();   /* 无缓存 = 刚建档回线后首推；脏缓存 = 回线后补推 */
  scheduleRetry();
}
/* 采纳服务器树：回写本机缓存 + 声明对齐（dirty 清零）。形状不被接受返回 false，调用方降级。 */
function adoptRemote(remote){
  if(!adoptRaw(remote.data)) return false;
  normalizeSelfTree();
  try { localStorage.setItem(storeKey(), JSON.stringify(USERS)); } catch(e){}
  metaSet({ rev: remote.rev, dirty: false });
  return true;
}
function save(){
  if(state) persistActive();
  if(state && state.theme) USERS.theme = state.theme;
  try { localStorage.setItem(storeKey(), JSON.stringify(USERS)); }
  catch(e){ toast('保存失败：本地存储空间不足', true); }
  const meta = metaGet() || { rev: null, dirty: false };
  meta.dirty = true;   /* 有未推送改动；推送成功且期间无新编辑时清零 */
  meta.gen = (meta.gen || 0) + 1;   /* v4.4：编辑代数写进共享 meta(跨标签页/重载仍有效)。
                                     * 旧 dirtyGen 是每页内存计数器，另一标签页的写入看不见它，
                                     * 守不住「多标签页共享」的 dirty 标志。 */
  metaSet(meta);
  queuePush();   // 落盘后 600ms 防抖推送服务器
}
/* 采纳/导入时清洗掉旧运动形状后必须补一次 save（本地缓存 + 防抖推送），
 * 否则内存已清、磁盘/服务器还留着旧形状，下次启动再洗一遍（幂等但白费，且旧形状可能被推回）。
 * v4.12 起「旧形状」还包含：plans 周计划作废、同日重复条目去重 */
function syncLegacyCleanup(){
  if(!legacyShapeCleaned) return;
  legacyShapeCleaned = false;
  save();
  toast('检测到旧版运动数据，已按「计划/记录合并」新结构清理并同步');
}
function wipeAll(){
  /* 只清本人的数据(保留昵称/头像),其他账户不受影响 */
  const sid = USERS.active;
  const keep = USERS.users[sid] || {};
  localStorage.removeItem(storeKey());
  const nu = freshUserData();
  nu.id = sid; nu.name = keep.name; nu.avatar = keep.avatar; nu.color = keep.color;
  USERS = { theme:'light', onboarded:false, shared: freshShared(), users:{}, active:null };
  if(sid){ USERS.users[sid] = nu; USERS.active = sid; }
  materialize(); applyTheme(); save(); go('home');
}

/* ---------- 服务器同步层 ----------
 * 所有设备访问同一服务器 = 同一份数据库，同步天然成立。
 * localStorage 仍逐次落盘（离线缓存 + 秒开），服务器为准数据源。
 * 保存 → 600ms 防抖推送；离线 → 30s 自动重试；版本冲突 → 由用户裁决。
 */
const API_BASE = '/api';
const srv = { online: null, rev: null, lastSync: null, pushTimer: null, retryTimer: null,
  blindNext: false, fatal: false,
  pushing: false, pushPending: false,      /* v4.4 在途保护：同 rev 的 PUT 绝不并发 */
  wantServer: false, wantGen: 0,           /* v4.4：已选「用服务器」；wantGen = 作出选择时的编辑代数 */
  noSelfTries: 0 };                        /* v4.4：no_self 自动恢复的尝试计数 */

function srvFetch(path, opts, timeout){
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout || 4000);
  return fetch(API_BASE + path, Object.assign({ signal: ac.signal }, opts))
    .finally(() => clearTimeout(timer));
}
async function fetchState(){
  try {
    const r = await srvFetch('/state', { method: 'GET' }, 3000);
    if(r.status === 401){ authExpired(); return null; }
    if(!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    srv.online = true;
    /* 从服务器树中捕获本人 uid(离线缓存重挂 / 校验账户身份) */
    if(j && j.data && j.data.users){
      const su = Object.keys(j.data.users)[0];
      if(su){ me = me || {}; me.user = Object.assign({}, me.user, { id: su }); normalizeSelfTree(); }
    }
    return j;                    /* {rev, data|null} */
  } catch(e){
    /* v4.3:「服务器应答异常(5xx/坏 JSON)」与「联系不上」都降级为离线缓存读,但控制台留痕;
     * 静默覆盖风险已由 meta.rev CAS + dirty 裁决堵上,降级不再等于丢数据风险 */
    console.warn('[sync] fetchState 失败:', e && e.message);
    srv.online = false;
    return null;
  }
}
/* 会话失效(401):停同步、清工作区、弹登录门(不 reload,留给同页重登) */
function authExpired(){
  if(srv.pushTimer){ clearTimeout(srv.pushTimer); srv.pushTimer = null; }
  if(srv.retryTimer){ clearTimeout(srv.retryTimer); srv.retryTimer = null; }
  /* v4.3:一并清 fatal——同页重登后必须恢复同步,否则一次瞬时 5xx 之后重登的会话永久瘫 */
  srv.online = null; srv.rev = null; srv.blindNext = false; srv.lastSync = null; srv.fatal = false;
  srv.pushing = false; srv.pushPending = false; srv.wantServer = false; srv.wantGen = 0; srv.noSelfTries = 0;
  me = null;
  USERS = null; state = null;
  const v = document.getElementById('view'); if(v) v.innerHTML = '';
  showAuth('会话已过期,请重新登录');
}
function queuePush(){
  if(srv.fatal || !me) return;   /* 未登录/会话失效时不推(离线只落本地缓存) */
  if(srv.pushTimer) clearTimeout(srv.pushTimer);
  srv.pushTimer = setTimeout(() => { srv.pushTimer = null; doPush(); }, 600);
}
/* 冲突裁决弹窗文案：load 启动裁决与 409 冲突共用一处，避免两种措辞各自漂移 */
const CONFLICT_MSG = '本机有未同步到服务器的改动，而服务器上本账户又有更新的数据（可能来自其他设备）。\n\n【确定】用服务器数据刷新本机（本机未同步的改动会被放弃）\n【取消】用本机数据覆盖服务器（其他设备后写入的改动会丢失）';

/* ---------- 收敛裁决(v4.4)：load 启动 / 回线重试 / 409 冲突 共用 ----------
 * 前提：remote 已从服务器取回。按共享 meta{rev,dirty,gen} 分派：
 *   'adopt'      已采纳服务器数据（缓存+对齐已写好，本机无未推送改动，无需再推）
 *   'adopt-fail' 服务器形状无法接受：保持本机缓存，调用方按上下文降级（启动读缓存/回线续试）
 *   'push'       本机为准（或空库首建）：调用方负责把本机树推上去
 * 干净 → 采纳；脏且服务器已前移 → 弹窗人工裁决（两种走向都明示，绝不静默覆盖任何一边）；
 * 同代脏 / 空库 → 补推。 */
async function converge(remote){
  const meta = metaGet();
  if(remote.data && (!meta || !meta.dirty)){
    if(adoptRemote(remote)){ srv.rev = remote.rev; return 'adopt'; }
    srv.rev = null;
    return 'adopt-fail';
  }
  if(remote.data && meta && meta.dirty && meta.rev !== remote.rev){
    const useServer = confirm(CONFLICT_MSG);
    if(useServer){
      const fresh = await fetchState();   /* 弹窗等待期间服务器可能又前移：采纳最新一次 */
      if(fresh && fresh.data && adoptRemote(fresh)){ srv.rev = fresh.rev; return 'adopt'; }
      srv.rev = null;
      return 'adopt-fail';
    }
    metaSet({ rev: remote.rev, dirty: true });   /* 本机为准：CAS 基线提到服务器当前 rev，随后的 push 覆盖 */
    return 'push';
  }
  return 'push';   /* 服务器没动过(同代脏)或空库：补推本机 = 首次建档上推；基线已在 meta.rev */
}

async function doPush(){
  if(srv.fatal) return;
  if(srv.pushing){ srv.pushPending = true; return; }   /* v4.4 在途保护：同 rev 的 PUT 并发必自撞 409 */
  srv.pushing = true;
  try {
    if(srv.rev === null && !srv.blindNext){
      /* v4.3 离线回线首推:用「本机上次对齐的版本」做 CAS 期望值——
       * 旧写法先取服务器当前 rev 再拿它当期望值推,必然命中、永不 409,
       * 等于离线启动的旧缓存静默覆盖其他设备的新写入(违背「绝不悄悄丢改动」)。
       * 无 meta(从未对齐过)= 以 0 试探:服务器空库 = 首次建档;非空 → 409 → 人工裁决。 */
      const meta = metaGet();
      srv.rev = (meta && typeof meta.rev === 'number') ? meta.rev : 0;
    }
    const gen = (metaGet() || {}).gen || 0;   /* v4.4:发出前的编辑代数(取自共享 meta,响应回来比对) */
    let r;
    try {
      r = await srvFetch('/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(srv.blindNext ? { data: USERS } : { rev: srv.rev, data: USERS }),
      }, 8000);
    } catch(e){ srv.online = false; refreshSyncStatus(); scheduleRetry(); return; }
    if(r.status === 401){ authExpired(); return; }
    if(r.status === 409){ await handleConflict(); return; }
    if(!r.ok){
      const j = await r.json().catch(() => ({}));
      if(r.status === 400 && j && j.error === 'invalid_state' && (srv.noSelfTries++) < 2){
        /* v4.4:400 invalid_state = 树里没有本登录账户那一份(启动即离线时铸了随机 uid)。
         * 拉一次服务器:fetchState 会把本机内容重挂到服务器 uid 下(离线编辑不丢),
         * 再按原 CAS 规则重推——旧版直接置 fatal,同步在本会话内永久卡死直到刷新。 */
        const fresh = await fetchState();
        if(fresh){ refreshSyncStatus(); queuePush(); return; }
        scheduleRetry(); refreshSyncStatus(); return;
      }
      srv.fatal = true; srv.noSelfTries = 0;
      toast('服务器拒绝了同步（HTTP ' + r.status + '），本机改动仍保存在本地', true); refreshSyncStatus(); return;
    }
    srv.noSelfTries = 0;
    const j = await r.json().catch(() => ({}));
    if(typeof j.rev === 'number'){
      srv.rev = j.rev;
      const meta = metaGet() || {};
      /* v4.3 竞态修复 + v4.4:比对 meta.gen(跨标签页共享)而非内存计数器——
       * 推送在途期间(本页或其他标签页)又发生 save() 时保持 dirty 并续推,
       * 前一次推送的迟到响应不会抹掉新编辑的脏标记。 */
      if((meta.gen || 0) === gen) metaSet({ rev: j.rev, dirty: false });   /* 期间无新编辑 = 已对齐 */
      else { metaSet({ rev: j.rev, dirty: true }); queuePush(); }   /* 对齐基线更新,新改动继续推 */
      srv.wantServer = false;   /* 已与服务器对齐,不再需要「用服务器」重试 */
    }
    srv.blindNext = false;
    srv.online = true;
    srv.lastSync = new Date();
    refreshSyncStatus();
  } finally {
    srv.pushing = false;
    if(srv.pushPending){ srv.pushPending = false; queuePush(); }   /* 在途期间攒下的新推送接上 */
  }
}
async function handleConflict(){
  /* rev 落后 = 本账户的另一台设备先完成了同步。两种走向都明示，绝不静默丢数据 */
  const useServer = confirm(CONFLICT_MSG);
  if(useServer){
    /* v4.4:采纳失败(服务器瞬断/坏形状)不再静默收场——挂 wantServer,
     * 由 30s 回线定时器静默拉取采纳(不再每次弹窗骚扰,也不会一直停在旧数据);
     * wantGen 快照:若等待期间用户又产生新编辑,重试时不再盲采纳(见 retrySync) */
    srv.wantServer = true;
    srv.wantGen = (metaGet() || {}).gen || 0;
    const fresh = await fetchState();
    if(fresh && fresh.data && adoptRemote(fresh)){
      srv.wantServer = false;
      srv.rev = fresh.rev;
      materialize(); applyTheme();
      go(curView);
      toast('已更新为服务器最新数据');
    } else {
      toast('暂时取不到服务器数据：本机改动已保留，恢复后会自动重试', true);
      scheduleRetry();
    }
  } else {
    srv.blindNext = true;                        /* 用户已明确选择覆盖:下一次推送不带 rev，盲写 */
    srv.wantServer = false;
    queuePush();
  }
  refreshSyncStatus();
}
function scheduleRetry(){
  if(srv.retryTimer) return;
  srv.retryTimer = setTimeout(() => { srv.retryTimer = null; retrySync(); }, 30000);
}
/* v4.4 回线收敛:30s 定时器到点后按「上次意图」分派——
 *   · 用户已选「用服务器」但采纳失败(wantServer) → 静默拉取采纳并刷新界面;
 *   · 本会话从未对齐过(启动即离线) → 拉服务器走 converge 同款裁决(含人工裁决弹窗);
 *   · 已有对齐基线/盲写中 → 维持原推送节奏(queuePush)。 */
async function retrySync(){
  if(srv.fatal || !me) return;
  if(srv.wantServer){
    const fresh = await fetchState();
    if(fresh && fresh.data && ((metaGet() || {}).gen || 0) === srv.wantGen && adoptRemote(fresh)){
      /* gen 未变 = 作出「用服务器」选择后没有新编辑:按用户意图采纳 */
      srv.wantServer = false;
      srv.rev = fresh.rev;
      materialize(); applyTheme(); go(curView);
      toast('已更新为服务器最新数据');
    } else if(fresh){
      /* 等待期间又产生新编辑(gen 前进):不再盲采纳——交给常规裁决,避免静默覆盖新改动 */
      srv.wantServer = false;
      const outcome = await converge(fresh);
      if(outcome === 'adopt'){ materialize(); applyTheme(); go(curView); toast('已更新为服务器最新数据'); }
      else if(outcome === 'adopt-fail'){ scheduleRetry(); }
      else queuePush();
    } else {
      scheduleRetry();   /* 服务器还没回来/形状仍坏 → 30s 后继续静默重试 */
    }
    refreshSyncStatus();
    return;
  }
  if(srv.rev !== null || srv.blindNext){ queuePush(); return; }
  const remote = await fetchState();
  if(!remote){ scheduleRetry(); refreshSyncStatus(); return; }
  const outcome = await converge(remote);
  if(outcome === 'adopt'){
    materialize(); applyTheme(); go(curView);
    toast('已恢复同步：本机已更新为服务器最新数据');
  } else if(outcome === 'adopt-fail'){
    scheduleRetry();   /* 多为瞬时/版本错配：恢复后再收敛 */
  } else {
    queuePush();       /* 本机为准/补推 */
  }
  refreshSyncStatus();
}
function syncStatusText(){
  if(srv.fatal) return '🔴 同步被服务器拒绝（本机改动已存本地），刷新页面或重新登录后可恢复';
  if(srv.online === null) return '🟢 正在连接同步服务器…';
  if(!srv.online) return '🟠 同步服务器离线：数据暂存本机，每 30 秒自动重试，服务器恢复后自动补推';
  const t = srv.lastSync ? ' · 最近同步 ' + srv.lastSync.toLocaleTimeString('zh-CN', { hour12: false }) : ' · 等待首次同步';
  const who = me && me.username ? '（' + me.username + '）' : '';
  return '🟢 已登录' + who + ' · 同步正常（数据版本 ' + srv.rev + '）' + t;
}
function refreshSyncStatus(){
  const el = document.getElementById('st_sync');
  if(el) el.textContent = syncStatusText();
}
setInterval(refreshSyncStatus, 5000);

/* 营养计算：bmi/目标可以按任意用户的档案算 */
function bmrOf(p){
  const base = 10*p.currentKg + 6.25*p.height - 5*age();
  return p.gender === 'male' ? base + 5 : base - 161;
}
function calcNutritionFor(u){
  const tdee = bmrOf(u.profile) * u.activity;
  const adj = GOAL_ADJ[u.goal && u.goal.mode] || 0;
  const kcal = Math.round(tdee + adj);
  const kg = u.profile.currentKg;
  const pg = u.goal.mode === 'bulk' ? 1.8 : 1.6;
  const protein = Math.round(pg * kg);
  const fat = Math.round(kcal * 0.25 / 9);
  const carbs = Math.max(0, Math.round((kcal - protein*4 - fat*9) / 4));
  return { auto:true, kcal, protein, carbs, fat };
}

/* ---------- 营养目标计算 ---------- */
function bmr(){ return bmrOf(state.profile); }
function calcNutrition(){ return calcNutritionFor(state); }
function syncNutrition(){
  if(state.nutrition.auto){ state.nutrition = Object.assign({auto:true}, calcNutrition()); }
}
function target(){
  syncNutrition();
  const n = state.nutrition, has = v => v !== null && v !== undefined;
  /* v4.4:nullish 兜底——合法的 0 值目标(手动档)不再被 || 显示成默认值 */
  return { kcal: has(n.kcal) ? n.kcal : 2000, p: has(n.protein) ? n.protein : 120,
           c: has(n.carbs) ? n.carbs : 200, f: has(n.fat) ? n.fat : 55 };
}

/* ---------- 饮食数据辅助 ---------- */
function mealItem(food, g){ return { id:uid(), name:food.name, per100:Object.assign({}, food.per100), g:Math.round(g) }; }
function dayMeals(date){
  if(!state.meals[date]) state.meals[date] = { breakfast:[], lunch:[], dinner:[], snack:[] };
  return state.meals[date];
}
function addMealItem(date, slot, item){ dayMeals(date)[slot].push(item); save(); }
function itemMacro(it){ return { kcal: it.per100.kcal*it.g/100, p: it.per100.p*it.g/100, c: it.per100.c*it.g/100, f: it.per100.f*it.g/100 }; }
function mealSlotTotals(date, slot){
  const m = dayMeals(date)[slot];
  let t = { kcal:0, p:0, c:0, f:0 };
  m.forEach(it => { const x = itemMacro(it); t.kcal+=x.kcal; t.p+=x.p; t.c+=x.c; t.f+=x.f; });
  return { kcal:round(t.kcal,0), p:round(t.p,0), c:round(t.c,0), f:round(t.f,0) };
}
function dayTotals(date){
  let t = { kcal:0, p:0, c:0, f:0 };
  SLOTS.forEach(s => { const x = mealSlotTotals(date, s.id); t.kcal+=x.kcal; t.p+=x.p; t.c+=x.c; t.f+=x.f; });
  return t;
}

/* ---------- 运动数据辅助（v4.11：一次安排 = 一条汇总，无组无段） ---------- */
function exName(exId){ const e = state.exercises.find(x => x.id === exId); return e ? e.name : (exId||'动作'); }
/* v4.12：计划与记录是同一条数据、完成的粒度在**每一项**上（`item.done`），
 * 一天只要有一项打了勾，这天就算已运动（进历史统计、算 PR）。
 * 「按天汇总」：一天最多一条，容器与项都由「逐项弹窗」按需创建/回收（见 openItemDlg / delItem）。 */
function workoutForDate(date){ return state.workouts.find(w => w.date === date) || null; }
function itemDone(it){ return !!(it && it.done); }
function doneCount(w){ return (w && w.items ? w.items : []).filter(itemDone).length; }
function allDone(w){ return !!w && w.items.length > 0 && doneCount(w) === w.items.length; }
function isDone(w){ return !!w && doneCount(w) > 0; }   /* 任一项打勾 = 当天已运动 */
function workoutsByDone(done){ return state.workouts.filter(w => isDone(w) === done); }

/* 计数方式只看项里有没有时长/距离——单一事实来源，不存可能打架的 mode 标记位。
 * 与方案 §5.1 的差异（有意）：不回退库里的 libMode(exId)——正常 UI 路径下计时项必有 mins/km，
 * 回退只影响旧数据/异常导入，而那种数据本该被 normalizeWorkoutDays 清掉，多一处判据反而更难查。 */
function itemMode(it){ return (it.mins !== undefined && it.mins !== null) || (it.km !== undefined && it.km !== null) ? 'time' : 'reps'; }
function itemVolume(it){ return (it.weight||0) * (it.reps||0); }   /* NaN 防线：计时项天然贡献 0 */
function itemMins(it){ return it.mins || 0; }
function itemKm(it){ return it.km || 0; }
/* 副标题（名称下方小字）：大类 + 部位，如「力量 · 胸」「有氧 · 全身」；两者相同只留一个 */
function itemSub(it){
  const bits = [];
  if(it.cat) bits.push(it.cat);
  if(it.muscle && it.muscle !== it.cat) bits.push(it.muscle);
  return bits.join(' · ');
}
function fmtMins(m){ return m < 1 ? Math.round(m*60) + ' 秒' : (m % 1 ? round(m,1) + ' 分钟' : m + ' 分钟'); }
/* 项文案：力量 "32 次 @60kg" / 重量没填就只写 "30 次"（不自造「自重」）；计时 "30 分钟 · 5 km" / "45 分钟" */
function fmtItem(it){
  if(itemMode(it) === 'time'){
    const parts = [];
    if(it.mins) parts.push(fmtMins(it.mins));
    if(it.km) parts.push(round(it.km, 2) + ' km');
    return parts.join(' · ') || '—';
  }
  if(!it.reps) return it.weight ? '— @' + round(it.weight,1) + 'kg' : '—';
  return it.reps + ' 次' + (it.weight ? ' @' + round(it.weight,1) + 'kg' : '');
}

function bestOf(items){ let bestW = 0; items.forEach(it => { if(it.weight && it.weight > bestW) bestW = it.weight; }); return bestW; }
/* 最大重量 PR。v4.11 起 reps = 总次数，原 weight×(1+reps/30) 的估算 1RM 已移除（公式前提失效）
 * v4.12：历史 = 比 date 更早的、已打勾的项（同日不算、未来安排不算、未打勾的项不算） */
function isPRItem(it, date){
  const cur = bestOf([it]);
  if(!cur) return { wPR:false };
  let histBestW = 0;
  state.workouts.forEach(w => {
    if(w.date >= date) return;
    w.items.forEach(x => { if(!itemDone(x) || x.exId !== it.exId) return; const b = bestOf([x]); if(b > histBestW) histBestW = b; });
  });
  return { wPR: cur > histBestW };
}
/* 实际完成量（只算已打勾项）——历史图表与已开始的那一天都用它；
 * 计划量（全部项）只用于还没开始的那一天，免得卡头空着 */
function sumItems(items, fn){ let v = 0; items.forEach(it => { v += fn(it); }); return v; }
function doneItems(w){ return (w && w.items ? w.items : []).filter(itemDone); }
function wkVolume(w){ return sumItems(doneItems(w), itemVolume); }
function wkMinutes(w){ return sumItems(doneItems(w), itemMins); }
function wkDistance(w){ return sumItems(doneItems(w), itemKm); }
function planVolume(w){ return sumItems(w.items || [], itemVolume); }
function planMinutes(w){ return sumItems(w.items || [], itemMins); }
/* 单项打勾 / 取消：完成的最小单位。写盘后整页重渲染（保持与卡片和统计一致） */
function toggleItemDone(dayId, itemId){
  const w = state.workouts.find(x => x.id === dayId); if(!w) return;
  const it = w.items.find(x => x.id === itemId); if(!it) return;
  if(it.done) delete it.done; else it.done = true;
  save(); renderView();
  if(allDone(w)) toast('全部完成，' + w.date + ' 记为运动记录 💪');
}
/* 逐项删除：删掉最后一项，这条安排就不存在了（那天回到「未安排」，一天一条的容器不做空占位） */
function delItem(date, itemId){
  const w = workoutForDate(date); if(!w) return;
  const it = w.items.find(x => x.id === itemId);
  if(!it || !confirm('删除「' + it.exName + '」？')) return;
  w.items = w.items.filter(x => x.id !== itemId);
  if(!w.items.length) state.workouts = state.workouts.filter(x => x.id !== w.id);
  save(); renderView(); toast('已删除');
}

/* ---------- 身体数据辅助 ---------- */
/* 指标清单：身体页磁贴 / 趋势图下拉 / 记录表列 / 记录弹窗字段 / 写库白名单 都以此为准 */
const MEASURES = [
  {id:'weight', label:'体重', unit:'kg'},
  {id:'chest',  label:'胸围', unit:'cm'},
  {id:'waist',  label:'腰围', unit:'cm'},
  {id:'hip',    label:'臀围', unit:'cm'},
  {id:'arm',    label:'臂围', unit:'cm'},
  {id:'thigh',  label:'大腿围', unit:'cm'},
  {id:'calf',   label:'小腿围', unit:'cm'},
  {id:'bf',     label:'体脂率', unit:'%'},
];
function upsertBody(rec){
  const patch = {};
  MEASURES.forEach(m => { const k = m.id; if(rec[k] !== undefined && rec[k] !== '') patch[k] = num(rec[k]); });
  let exIx = -1;
  for(let i = state.body.length - 1; i >= 0; i--){ if(state.body[i].date === rec.date){ exIx = i; break; } }
  if(exIx >= 0){ Object.assign(state.body[exIx], patch); } else { state.body.push(Object.assign({date:rec.date}, patch)); }
  if(patch.weight){ state.profile.currentKg = patch.weight; }
  state.body.sort((a,b)=> a.date < b.date ? -1 : 1);
  save();
}
function bodyLatest(){ return state.body.length ? state.body[state.body.length-1] : null; }
function bodyVal(metric, date){
  const recs = state.body.filter(b => b[metric] !== undefined && b[metric] !== null);
  if(!recs.length) return null;
  // 取 <=date 的最近一条
  let last = null; recs.forEach(r => { if(r.date <= date) last = r; });
  if(!last) return recs[0][metric]; // 未来第一条兜底
  return last[metric];
}
function latestVal(metric){ return bodyVal(metric, today()); }
function bmi(){ const w = latestVal('weight'); if(!w || !state.profile.height) return null; return round(w / Math.pow(state.profile.height/100, 2), 1); }
/* BMI 分档：偏瘦(<18.5)/正常(<24)/超重(<28)/肥胖——颜色与判定的单一来源，身体页与概览磁贴共用 */
function bmiTone(v){
  if(v === null || v === undefined) return null;
  return v < 18.5 ? { c:'var(--cat1)',   ok:false, tag:'偏瘦' }
       : v < 24   ? { c:'var(--brand)',  ok:true,  tag:'正常' }
       : v < 28   ? { c:'var(--warn)',   ok:false, tag:'超重' }
       :            { c:'var(--danger)', ok:false, tag:'肥胖' };
}

/* ---------- 睡眠饮水辅助（v4.6 睡眠多段：一天 = 段数组 [{t,bed,wake,mins,quality}]） ----------
 * 类型枚举 / 时长计算 / 形状归一化都在 js/sleep-shape.js（服务端 mapper 共用同一份）：
 * SLEEP_TYPES、SLEEP_GOAL_MINS、sleepType(未知返回 null)、sleepDur、normalizeSleepDay */
/* 读侧再兜一层：ensureUserIntact 已清洗过，但 state 也可能被导入/调试钩子直接塞进脏元素，
 * 一个 null 段就够让 renderHome 抛错、概览整页空白 */
function sleepSessions(date){ const v = state.sleep[date]; return Array.isArray(v) ? v.filter(s => s && typeof s === 'object') : []; }
function sleepTotalMins(date){ return sleepSessions(date).reduce((n, s) => n + (num(s.mins) || 0), 0); }
function waterFor(date){ return state.water[date] || 0; }

/* ---------- 习惯辅助 ---------- */
function habitStreak(h, until){
  let d = until;
  if(!h.done[d]) d = addDays(d, -1);
  let n = 0;
  while(h.done[d]){ n++; d = addDays(d, -1); }
  return n;
}


/* ---------- 主题 ---------- */
function curTheme(){ return state.theme === 'dark' ? 'dark' : 'light'; }
/* 主题有三处显示口：根属性（样式）、侧栏底部「外观」图标（桌面）、档案卡头的太阳/月亮图标钮（#themeToggle）。
 * 三处统一由 applyTheme 刷新——否则从任意一处切换后，别处的图标会停在旧档位。 */
function applyTheme(){
  const t = curTheme();
  document.documentElement.setAttribute('data-theme', t);
  const sb = $('#sidebar [data-themeclick] .ic'); if(sb) sb.textContent = (t === 'dark') ? '🌙' : '☀️';
  const tg = $('#themeToggle'); if(tg) tg.textContent = (t === 'dark') ? '🌙' : '☀️';
}
function setTheme(t){ state.theme = (t === 'dark') ? 'dark' : 'light'; save(); applyTheme(); }
function toggleTheme(){ setTheme(curTheme() === 'dark' ? 'light' : 'dark'); }

/* ---------- Toast ---------- */
function toast(msg, isErr){
  const box = $('#toasts'); const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg; box.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .3s'; }, 2200);
  setTimeout(()=> el.remove(), 2600);
}

/* ---------- 弹窗（dialogStack 支持叠层：只有栈顶响应 Esc / 接收 closeDialog） ---------- */
let curDialog = null;
const dialogStack = [];
function showDialog(title, html, opts){
  opts = opts || {};
  const ov = document.createElement('div'); ov.className = 'overlay';
  const d = document.createElement('div'); d.className = 'dialog';
  if(opts.size === 'lg') d.style.maxWidth = '880px';
  d.innerHTML = '<div class="d-h"><div class="d-t">' + esc(title) + '</div><button class="d-x" type="button">✕</button></div><div class="d-b"></div>';
  const box = d.querySelector('.d-b');
  box.insertAdjacentHTML('beforeend', html);
  ov.appendChild(d);
  /* 支持叠层弹窗（v4.6 起睡眠段编辑器就是从概览卡/历史弹窗里再开一层）：
   * 旧写法每个弹窗都往 document 挂一个 Esc 监听、关闭时把 curDialog 直接置空——
   * 按一次 Esc 会把内外两层一起关掉，且内层关了以后外层虽然还开着、curDialog 却是 null
   * （导入结尾的 if(curDialog) closeDialog() 与各测试取 curDialog.box 都会踩空）。
   * 现在维护一个栈：只有栈顶响应 Esc，curDialog 恒等于栈顶。 */
  const entry = { box, el: d };
  function close(){
    ov.remove();
    const i = dialogStack.indexOf(entry); if(i >= 0) dialogStack.splice(i, 1);
    curDialog = dialogStack.length ? dialogStack[dialogStack.length - 1] : null;
    document.removeEventListener('keydown', esk);
    if(opts.onClose) opts.onClose();   /* 关闭后回调:设置页库入口用它刷新按钮上的库计数 */
  }
  entry.close = close;                        // closeDialog() 走 curDialog.close，故挂在 entry 上
  function esk(e){ if(e.key === 'Escape' && dialogStack[dialogStack.length - 1] === entry) close(); }
  document.addEventListener('keydown', esk);
  ov.addEventListener('mousedown', e => { if(e.target === ov) close(); });
  d.querySelector('.d-x').addEventListener('click', close);
  document.body.appendChild(ov);
  dialogStack.push(entry);
  curDialog = entry;
  if(opts.onOpen) opts.onOpen(box, close);
  return curDialog;
}
function closeDialog(){ if(curDialog) curDialog.close(); }

/* ---------- 导航渲染 ---------- */
let curView = 'home';
/* v4.15：设置页「数据管理」里点食物库/动作库由弹窗改为独立页面。
 * 这两个子页面不进 NAV（不占侧栏/底栏），借父级 settings 的高亮与持久化：
 * 刷新后落回设置页，而不是停在一个「返回」无处可去的半截子页。 */
const SUBVIEW = { foodlib:'settings', exlib:'settings' };
function navActiveId(){ return SUBVIEW[curView] || curView; }
function rebuildNav(){
  const group1 = ['home'];
  const group2 = ['diet','train','body'];
  const group3 = ['stats','settings'];
  const active = navActiveId();
  const render = ids => ids.map(id => {
    const n = NAV.find(x=>x.id===id);
    return '<div class="navbtn ' + (active===id?'active':'') + '" data-go="' + id + '"><span class="ic">' + n.ic + '</span>' + esc(n.label) + '</div>';
  }).join('');
  $('#sidebar').innerHTML =
    '<div class="brand"><div class="logo">💪</div><div>健康管理<small>我的健身日记</small></div></div>' +
    '<div class="navgroup">主页</div>' + render(group1) +
    '<div class="navgroup">记录</div>' + render(group2) +
    '<div class="navgroup">分析 · 设置</div>' + render(group3) +
    '<div style="flex:1"></div>' +
    '<div class="navbtn" data-themeclick><span class="ic">' + (state.theme==='dark'?'🌙':'☀️') + '</span>外观</div>';
  $('#tabbar').innerHTML = NAV.map(n =>
    '<button class="tabbtn ' + (active===n.id?'active':'') + '" data-go="' + n.id + '"><span class="ti">' + n.ic + '</span>' + esc(n.label) + '</button>').join('');
  $$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  const tc = $('#sidebar [data-themeclick]'); if(tc) tc.addEventListener('click', toggleTheme);
}
/* 记住当前页面（v4.14）：刷新后回到上次浏览的页面而不是总回概览。
 * 键名按账户隔离，与离线缓存同一口径；只存 UI 状态，不参与服务器同步。 */
function viewKey(){ return 'jjhealth_view:' + storeWho(); }
function readView(){
  try { const v = localStorage.getItem(viewKey()); return NAV.some(n => n.id === v) ? v : 'home'; } catch(e){ return 'home'; }
}
function writeView(v){ try { localStorage.setItem(viewKey(), v); } catch(e){} }
/* 滚动位置记忆（v4.15，手机端反馈）：切页时把离开那页的滚动量存起来，回来时原位恢复——
 * 从设置页进「数据管理」的两个子页面再点返回，不再被打回设置页顶部。
 * 桌面滚文档、手机滚 .main（见 style.css 响应式段），两个滚动量都记（存的是纯 UI 状态，不入数据树）。
 * 恢复/归零一律 behavior:'auto'（瞬时）：旧写法是 smooth 归零，手机上会先看到一段「进页往上滚」。 */
const viewScroll = {};
function readScroll(){
  const m = document.querySelector('.main');
  return {
    doc: window.scrollY || document.documentElement.scrollTop || 0,
    main: (m && m.scrollTop) || 0,
  };
}
function applyScroll(keep){
  const t = keep || { doc:0, main:0 };
  try { window.scrollTo({ top: t.doc, behavior: 'auto' }); } catch(e){ window.scrollTo(0, t.doc); }
  const m = document.querySelector('.main'); if(!m) return;
  if(typeof m.scrollTo === 'function') m.scrollTo({ top: t.main, behavior: 'auto' });
  else m.scrollTop = t.main;
}
function go(v){
  const same = (v === curView);
  if(!same) viewScroll[curView] = readScroll();   /* 离开前记下当前页的滚动位置 */
  curView = v;
  writeView(SUBVIEW[v] || v);   /* 子页面记父级,刷新后回到设置页 */
  rebuildNav(); renderView();
  /* 换页 = 回该页上次的位置（没来过就顶部）；同页重入（点当前页/刷新后重渲染）= 仍回顶部与旧行为一致 */
  applyScroll(same ? null : viewScroll[v]);
}
/* 下拉刷新：移动端滚动容器收到 .main 后(见 style.css 响应式段)，文档不再滚动，
 * 浏览器原生下拉刷新(挂在根滚动器上)无从触发，故手写一个等价手势。
 * 语义与原生一致：松手整页重载，重走 init()→load() 的冷启动收敛(含脏缓存/rev 裁决)。
 * 仅 ≤899px 且无登录门/弹窗遮挡时接管。 */
function bindPullToRefresh(){
  if(typeof window.matchMedia !== 'function' || !window.matchMedia('(max-width:899px)').matches) return;
  const el = document.getElementById('main');
  if(!el) return;
  const THRESHOLD = 72;   /* 触发阈值(px) */
  const MAX = 120;        /* 最大下拉距离，再拉也不动 */
  const DAMP = 0.5;       /* 阻尼：手指走 2px，指示器走 1px */

  const ind = document.createElement('div');
  ind.id = 'ptr';
  ind.innerHTML = '<span class="ptr-ic">↻</span><span class="ptr-tx">下拉刷新</span>';
  document.body.appendChild(ind);
  const tx = ind.querySelector('.ptr-tx');

  let startY = null, dist = 0, armed = false;
  const paint = (d, busy) => {
    dist = d;
    ind.style.transform = 'translate(-50%,' + (d - 60) + 'px)';
    ind.style.opacity = (d > 4 || busy) ? '1' : '0';
    ind.classList.toggle('ready', d >= THRESHOLD);
    if(!busy) tx.textContent = d >= THRESHOLD ? '松开刷新' : '下拉刷新';
  };
  paint(0, false);

  el.addEventListener('touchstart', e => {
    /* 概览卡拖动中：下拉刷新让路，否则长按下拉会同时拉起两个手势 */
    if(homeDrag){ startY = null; paint(0, false); return; }
    if(e.touches.length !== 1 || el.scrollTop > 0 || document.querySelector('.authgate,.overlay')){ startY = null; return; }
    startY = e.touches[0].clientY; armed = false; paint(0, false);
  }, {passive:true});

  el.addEventListener('touchmove', e => {
    if(homeDrag){ startY = null; paint(0, false); return; }
    if(startY === null) return;
    if(el.scrollTop > 0){ startY = null; paint(0, false); return; }   /* 已往上滚过就不再接管 */
    const dy = e.touches[0].clientY - startY;
    if(dy <= 0){ paint(0, false); return; }
    armed = true;
    paint(Math.min(MAX, dy * DAMP), false);
    if(e.cancelable) e.preventDefault();   /* 压住浏览器自身的回弹 */
  }, {passive:false});

  const end = () => {
    if(homeDrag){ startY = null; armed = false; paint(0, false); return; }
    if(startY === null) return;
    const fire = armed && dist >= THRESHOLD;
    startY = null; armed = false;
    if(fire){
      tx.textContent = '正在刷新…';
      paint(THRESHOLD, true);
      location.reload();
    } else {
      paint(0, false);
    }
  };
  el.addEventListener('touchend', end, {passive:true});
  el.addEventListener('touchcancel', end, {passive:true});
}
function renderView(){
  cancelHomeDrag();   /* 切页时若有拖动中的卡片，收干净（否则监听器/样式会带到下一页） */
  const map = { home:renderHome, diet:renderDiet, train:renderTrain, body:renderBody, stats:renderStats, settings:renderSettings,
    foodlib:renderFoodLibPage, exlib:renderExLibPage };   /* v4.15 数据管理下的两个子页面 */
  (map[curView])();
}

/* =====================================================
   首次引导
===================================================== */
function showOnboard(){
  const html =
    '<div class="empty" style="padding:6px 4px 2px"><div class="e-ic">👋</div></div>' +
    '<p style="margin:2px 0 14px;color:var(--ink-2)">欢迎使用健康管理！简单填几项基础信息，就能开始估算你的每日营养目标（按减脂倾向估算，之后可在「设置」页的营养目标里改热量倾向）。</p>' +
    '<div class="form-grid">' +
      '<div><label>性别</label><select class="select" id="ob_gender"><option value="male">男</option><option value="female">女</option></select></div>' +
      '<div><label>出生年份</label><input class="input" id="ob_year" type="number" min="1930" max="2020" value="1992"></div>' +
      '<div><label>身高 cm</label><input class="input" id="ob_height" type="number" min="130" max="230" value="175"></div>' +
      '<div><label>当前体重 kg</label><input class="input" id="ob_weight" type="number" min="30" max="300" value="72"></div>' +
      '<div class="span2"><label>日常活动量</label><select class="select" id="ob_act">' + ACTIVITIES.map(a => '<option value="' + a.v + '">' + a.label + '</option>').join('') + '</select></div>' +
    '</div>' +
    '<div class="d-f" style="position:static;justify-content:flex-end;margin-top:18px">' +
      '<button class="btn primary" id="ob_skip">直接开始</button>' +
    '</div>';
  const dlg = showDialog('开始使用', html, {size:'lg'});
  const b = dlg.box;
  $('#ob_act', b).value = String(state.activity);
  const collect = () => {
    state.profile = {
      gender: $('#ob_gender', b).value,
      birthYear: num($('#ob_year', b).value) || 1992,
      height: num($('#ob_height', b).value) || 175,
      currentKg: num($('#ob_weight', b).value) || 72,
    };
    state.activity = num($('#ob_act', b).value);
    syncNutrition(); save();
  };
  $('#ob_skip', b).addEventListener('click', () => { collect(); USERS.onboarded = true; save(); closeDialog(); go('home'); });
}

/* =====================================================
   修改基础资料（v4.8：原 ⚙️ 设置弹窗的档案部分，改为「设置」页卡片弹窗）
===================================================== */
function openProfileEditor(){
  const p = state.profile;
  const html =
    '<div class="form-grid">' +
      '<div><label>性别</label><select class="select" id="pr_gender"><option value="male">男</option><option value="female">女</option></select></div>' +
      '<div><label>出生年份</label><input class="input" id="pr_year" type="number" min="1930" max="2020" value="' + p.birthYear + '"></div>' +
      '<div><label>身高 cm</label><input class="input" id="pr_height" type="number" min="130" max="230" value="' + p.height + '"></div>' +
      '<div><label>当前体重 kg</label><input class="input" id="pr_weight" type="number" min="30" max="300" value="' + p.currentKg + '"></div>' +
    '</div>' +
    '<div class="tiny" style="margin-top:8px;color:var(--ink-3)">基础资料用于估算每日营养目标（自动档）。在「身体」页记录体重后会自动同步到这里；热量倾向、活动量与饮水目标请在「营养目标」卡片中修改。</div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="pr_save">保存</button></div>';
  const dlg = showDialog('修改基础资料', html);
  const b = dlg.box;
  $('#pr_gender', b).value = p.gender;
  $('#pr_save', b).addEventListener('click', () => {
    state.profile = { gender:$('#pr_gender', b).value, birthYear:num($('#pr_year', b).value)||1992, height:num($('#pr_height', b).value)||175, currentKg:num($('#pr_weight', b).value)||state.profile.currentKg };
    syncNutrition(); save(); closeDialog(); renderView(); toast('已保存');
  });
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
}

function exportData(){
  save();
  const blob = new Blob([JSON.stringify(USERS, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '健康管理备份-' + today() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('已导出备份文件');
}
function importData(file){
  const rd = new FileReader();
  rd.onload = () => {
    let raw;
    try { raw = JSON.parse(rd.result); } catch(e){ toast('文件不是有效的备份 JSON', true); return; }
    if(!adoptRaw(raw)){ toast('无法识别该文件：不是本应用导出的备份', true); return; }
    USERS.onboarded = true;
    normalizeSelfTree();   /* 多人备份只取"当前成员"一份，重挂为本账户数据 */
    materialize(); applyTheme(); save();
    if(curDialog) closeDialog();
    go('home');
    toast('导入成功：已作为本账户数据' + (legacyShapeCleaned ? '（旧版运动数据已按新结构清理）' : ''));
    legacyShapeCleaned = false;
  };
  rd.onerror = () => toast('读取文件失败', true);
  rd.readAsText(file);
}

/* =====================================================
   我的档案（v4：一账户一档案，成员切换/增删已退役）
   呈现位置 = 设置页首卡（2026-09-11 顶栏移除后并入）
   卡片只读展示：整块「头像 + 昵称/账户」即修改入口，走 openProfileDialog() 弹窗
   ——与基础资料/每日目标等卡片体验一致
   （2026-09-11 同日再改：按要求删掉卡头行与「修改档案」按钮；主题图标钮 #themeToggle 移到本行右侧）
===================================================== */
function colorOpts(sel){
  const labels = {green:'绿', blue:'蓝', orange:'橙', violet:'紫', teal:'青', pink:'粉'};
  return USER_COLORS.map(c => '<option value="' + c.id + '"' + (c.id === sel ? ' selected' : '') + '>' + (labels[c.id] || c.id) + '</option>').join('');
}
function profileCardHTML(){
  const u = activeUser();
  const isAdmin = !!(me && me.role === 'admin');
  return '<div class="card">' +
    '<div class="pf-top">' +
      /* 整块「头像 + 昵称/账户」= 修改档案入口（.pf-hit 占满本行剩余宽度，右侧只留主题图标钮）。
         两行文字用 span 承载——button 内不能放 div，block 化交给 .pf-hit 的 CSS。 */
      '<button class="pf-hit" id="pf_edit" type="button" title="修改我的档案" aria-label="修改我的档案">' +
        '<span class="av big avatar-ring" style="--ring:' + userColorHex(u.color) + '">' + esc(u.avatar || '🙂') + '</span>' +
        '<span class="pf-id"><span class="b">' + esc(u.name) + (isAdmin ? ' <span class="chip ok">管理员</span>' : '') + '</span>' +
        '<span class="sub">登录账户：' + esc(me ? me.username : '（离线）') + '</span></span>' +
      '</button>' +
      themeToggleHTML() +
    '</div>' +
  '</div>';
}
/* 档案修改走弹窗（与基础资料/每日目标等卡片「只读卡 + 弹窗编辑」一致） */
function openProfileDialog(){
  const u = activeUser();
  const html =
    '<div class="form-grid">' +
      '<div><label>头像（表情）</label><input class="input" id="pf_av" maxlength="2" value="' + esc(u.avatar || '🙂') + '"></div>' +
      '<div><label>昵称</label><input class="input" id="pf_name" value="' + esc(u.name) + '"></div>' +
      '<div class="span2"><label>标识色</label><select class="select" id="pf_color">' + colorOpts(u.color) + '</select></div>' +
    '</div>' +
    '<div class="tiny" style="margin-top:8px;color:var(--ink-3)">昵称与头像显示在「我的档案」卡片上；标识色决定头像圆环颜色。</div>' +
    '<div class="d-f">' +   /* 退出登录已移出弹窗、挪到设置页最下方，这里只剩取消/保存（.d-f 本就右对齐） */
      '<button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="pf_save">保存</button>' +
    '</div>';
  const dlg = showDialog('修改我的档案', html);
  const b = dlg.box;
  $('#pf_save', b).addEventListener('click', () => {
    const name = $('#pf_name', b).value.trim(); if(!name){ toast('昵称不能为空', true); return; }
    u.name = name; u.avatar = $('#pf_av', b).value.trim() || '🙂'; u.color = $('#pf_color', b).value;
    save(); closeDialog(); renderView(); toast('已保存');
  });
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
}
/* 主题切换图标钮（太阳/月亮）= 原顶栏那颗切换键，2026-09-11 从独立「🎨 外观」卡一路收到
   档案卡、排在「修改档案」右边；2026-09-11 同日再改：随卡头行一起改挂到「头像 + 昵称/账户」那一行的右端。
   图标显示**当前**档位（☀️ 浅色 / 🌙 深色），与桌面侧栏底部「外观」入口同一口径；
   两处图标都由 applyTheme() 统一刷新。 */
function themeToggleHTML(){
  return '<button class="btn sm icon" id="themeToggle" type="button" title="切换深色/浅色" aria-label="切换深色/浅色">' +
    (curTheme() === 'dark' ? '🌙' : '☀️') + '</button>';
}
function bindThemeToggle(){
  const b = $('#themeToggle'); if(b) b.addEventListener('click', toggleTheme);
}
/* 后台管理入口卡（仅 admin，普通账户不渲染 → 保持「用户端零管理功能」）
 * 2026-09-11 由「我的档案」卡底移出，改为设置页最后一张卡 */
function adminCardHTML(){
  if(!(me && me.role === 'admin')) return '';
  return '<div class="card"><h3><span>🛠 后台管理</span></h3>' +
    '<a class="btn block" style="text-decoration:none;justify-content:center" href="/admin" target="_blank" rel="noopener">进入后台管理（系统库 · 用户权限）→</a>' +
    '<div class="tiny muted mt">管理员专属：维护系统共享的食物库/动作库，以及账户权限（设为/撤销管理员、重置密码、删除账户）。</div>' +
  '</div>';
}
async function doLogout(){
  /* v4.3：退出必须拿到服务器确认再清本地——旧版吞掉网络错误直接 reload，
   * Cookie/会话行还有效，reload 后 /api/me 自动放行，共享设备下一个人会直接进上一个人的账户。
   * v4.4：401 视为已退出（会话被管理员重置密码/删除时 /api/logout 在会话门处即返回 401，
   * 服务器侧会话已删，本地没理由滞留——旧版把 401 当失败，用户被关在失效账户里）。 */
  let state2 = null;   /* 'done' 已确认 | 'dead' 会话已失效 | 'fail' 其他非 2xx | 'down' 连不上 */
  try {
    const r = await srvFetch('/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 4000);
    state2 = r.ok ? 'done' : (r.status === 401 ? 'dead' : 'fail');
  } catch(e){ state2 = 'down'; }
  if(state2 === 'fail'){ toast('服务器未确认退出，会话可能仍有效——请重试', true); return; }
  if(state2 === 'down'){ toast('服务器离线：无法确认退出，会话 Cookie 仍在——恢复联网后请再次退出', true); return; }
  srv.fatal = true;
  if(srv.pushTimer){ clearTimeout(srv.pushTimer); srv.pushTimer = null; }
  if(srv.retryTimer){ clearTimeout(srv.retryTimer); srv.retryTimer = null; }
  me = null;
  localStorage.removeItem(AUTH_KEY); localStorage.removeItem(AUTH_ROLE_KEY);
  location.reload();
}

/* =====================================================
   概览首页
===================================================== */
/* valRight：数值行右侧的小字（紧跟在数值后面，如 BMI 的分档「✓ 正常」）；第 6 位原本是个从没被用过的 icon 形参 */
function tileHTML(lab, val, unit, delta, deltaCls, valRight, deltaColor){
  const cs = deltaColor ? ' style="color:' + deltaColor + '"' : '';
  return '<div class="tile"><div class="lab"><span>' + esc(lab) + '</span></div>' +
    '<div class="val">' + val + (valRight ? '<span class="val-tone"' + cs + '>' + esc(valRight) + '</span>' : '') +
      (unit ? '<span class="unit">' + unit + '</span>' : '') + '</div>' +
    (delta ? '<div class="delta ' + (deltaCls||'') + '"' + cs + '>' + delta + '</div>' : '') + '</div>';
}

/* ---------- 概览「今日卡片」的排序契约 ----------
 * 5 张卡共用 .home-cards 容器，DOM 顺序 = 用户顺序；拖动只摸 DOM + 落 state.homeOrder，
 * 不重渲染（卡内监听器不用重绑，也不闪）。顶部磁贴行不在容器里，固定不动。
 * HOME_CARD_WIDE：宽屏（≥900px）下整行占满的卡；其余（饮水/睡眠）可两列并排。 */
const HOME_CARD_WIDE = { diet:1, workout:1, habits:1 };

/* 只做「认识 + 去重」（不补缺）：mergeOrder 判定"当时可见"靠它，
 * 补缺会把不在 DOM 里的卡当成可见卡 */
function orderFilter(list){
  const out = [];
  (Array.isArray(list) ? list : []).forEach(id => {
    if(HOME_ORDER_DEFAULT.indexOf(id) >= 0 && out.indexOf(id) < 0) out.push(id);
  });
  return out;
}
/* 存储顺序 → 渲染顺序：丢未知 id、去重、补齐缺的（含未来新增的卡） */
function resolveHomeOrder(stored){
  const out = orderFilter(stored);
  HOME_ORDER_DEFAULT.forEach(id => { if(out.indexOf(id) < 0) out.push(id); });
  return out;
}
/* 拖完只拿得到「当时可见」的顺序：把当前不显示的卡按旧序里它后面第一个可见邻居为锚点插回，
 * 保证隐藏期间拖别的卡不会把饮水卡的位次冲掉（多张隐藏卡按旧序依次插，相对顺序不变）。 */
function mergeOrder(visibleNew, fullOld){
  const full = resolveHomeOrder(fullOld), vis = orderFilter(visibleNew);
  const out = vis.slice();
  full.forEach((id, i) => {
    if(vis.indexOf(id) >= 0) return;
    let succ = null;
    for(let j = i + 1; j < full.length; j++){ if(vis.indexOf(full[j]) >= 0){ succ = full[j]; break; } }
    out.splice(succ === null ? out.length : out.indexOf(succ), 0, id);
  });
  return out;
}
/* 卡头右端的抓手：手机长按也能拾取，抓柄只是把「能拖」显示出来
 * （触屏下抓柄 touch-action:none，按下即拖，不用等长按） */
function hcardGrip(){
  return '<span class="hcard-grip" data-hcard-grip title="按住拖动排序" aria-hidden="true">⠿</span>';
}
/* 给卡注入 data-hcard（拖动标识）+ 抓手。5 张卡的 HTML 都以 <div class="card" 开头、
 * 首个 </h3> 就是自己的卡头，故这两处替换是安全的 */
function tagCard(id, html){
  if(!html) return '';
  return html
    .replace(/^<div class="card"/, '<div class="card" data-hcard="' + id + '"' + (HOME_CARD_WIDE[id] ? ' data-wide="1"' : ''))
    .replace('</h3>', hcardGrip() + '</h3>');
}

function renderHome(){
  cancelHomeDrag();   /* 直接调 renderHome 的回调（饮水/睡眠改完重绘）不走 renderView，这里兵底 */
  const t = today();
  const T = target();
  const eat = dayTotals(t);
  const wk = weekday(t);
  const nowH = new Date().getHours();
  const greet = nowH < 5 ? '夜深了' : nowH < 11 ? '早上好' : nowH < 14 ? '中午好' : nowH < 18 ? '下午好' : '晚上好';
  const calPct = Math.round(eat.kcal / T.kcal * 100);
  const habToday = state.habits.filter(h => h.done[t]).length;
  const day = workoutForDate(t);
  const dn = day ? doneCount(day) : 0;
  const itemTotal = day ? day.items.length : 0;                  /* 概览磁贴「运动」的分母 */
  const bmiV = bmi(), bmiInfo = bmiTone(bmiV);                  /* 概览磁贴「BMI」 */

  const html =
    /* 问候语：手机端居中（.home-greet，见 style.css 的 ≤899px 块）；桌面侧仍左对齐与下方内容对齐 */
    '<div class="muted home-greet">' + esc(greet) + '，<b>' + esc(activeUser().name) + '</b> · ' + dateCNW(t) + '</div>' +
    '<div class="row mt">' +
      tileHTML('热量', fmtNum(eat.kcal), '/ ' + fmtNum(T.kcal) + ' kcal', '', '') +
      /* BMI 磁贴：数值 + 分档小字；小字跟在第二行数值右侧（标签行只剩「BMI」），颜色同身体页（bmiTone 单一来源）；无体重/身高时给提示文案 */
      tileHTML('BMI', bmiV === null ? '--' : bmiV, '', '', '',
        bmiInfo ? (bmiInfo.ok ? '✓ 正常' : '⚠ ' + bmiInfo.tag) : '记录体重后查看', bmiInfo ? bmiInfo.c : '') +
      /* 运动磁贴（需 2026-09-12：标签由「今日运动」缩为「运动」）：当天已打勾项 / 全部项；今天没安排（或安排为空）显示「休息」 */
      tileHTML('运动', itemTotal ? dn + '/' + itemTotal : '休息', itemTotal ? '项' : '', '', '') +
      tileHTML('打卡', habToday + '/' + state.habits.length, '', '', '') +
    '</div>' +
    /* 除顶部磁贴行外，其余「今日卡片」都进这个容器：顺序由 state.homeOrder 决定、可拖动调整 */
    '<div class="home-cards" id="home_cards">' + homeCardsHTML(t, eat, calPct) + '</div>';

  $('#view').innerHTML = html;
  bindHabitEvents();
  bindLifeToday($('#view'));
  bindHomeSort($('#home_cards'));
  const q = $('#view [data-additem]');
  if(q) q.addEventListener('click', () => openItemDlg(q.dataset.additem));
  bindItemChecks($('#view'));
  const g = $('#view [data-go2="diet"]');
  if(g) g.addEventListener('click', () => go('diet'));
  const gh = $('#view [data-go2="settings"]');
  if(gh) gh.addEventListener('click', () => go('settings'));
}

/* 今日饮食卡（原 renderHome 内联；与磁贴的间距交给 .home-cards 的 margin/gap，故不再内联 margin-top） */
function homeDietCardHTML(eat, calPct){
  const T = target();
  return '<div class="card"><h3>🍽️ 今日饮食</h3>' +
    (eat.kcal === 0 ? '<div class="empty"><div class="e-ic">🍽️</div>还没有记录今天的饮食<div class="mt"><button class="btn primary sm" data-go2="diet">去记录</button></div></div>'
      : '<div class="small">' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:5px"><span class="muted">已摄入 vs 目标 <span class="tiny" style="font-weight:400;color:' + (calPct>100?'var(--ink-2)':'var(--cat3)') + '">' + (calPct>100 ? '已超 ' + (calPct-100) + '%' : '还差 ' + (100-calPct) + '%') + '</span></span><b>' + fmtNum(eat.kcal) + ' / ' + fmtNum(T.kcal) + ' kcal</b></div>' +
        '<div class="meter"><i style="width:' + clamp(calPct,0,100) + '%" class="' + (calPct>100?'over':'') + '"></i></div>' +
        '</div>') +
    /* chips 行下边带分隔线（`.lrow` 的 border-bottom 同款）：与运动/睡眠卡一样，
     * 卡底入口行上方有一条横线，把入口与上面的内容隔开 */
    (eat.kcal ? '<div class="row gap8" style="margin-top:10px;padding-bottom:12px;border-bottom:1px solid var(--line)">' +
      '<span class="chip b1">蛋白 ' + eat.p + 'g / ' + T.p + 'g</span>' +
      '<span class="chip b2">碳水 ' + eat.c + 'g / ' + T.c + 'g</span>' +
      '<span class="chip b3">脂肪 ' + eat.f + 'g / ' + T.f + 'g</span>' +
    '</div>' +
    /* 有记录时的入口：与今日运动/今日睡眠卡同款同位（卡底一行、右对齐 ghost），
     * 文案用「＋ 记录一下」而不是「去记录」——三张卡的右下按钮统一成「＋ 动宾」
     * margin-left:auto 而非 space-between：窄卡换行时按钮仍靠右 */
    '<div class="row mt" style="align-items:center"><button class="btn sm ghost" data-go2="diet" style="margin-left:auto">＋ 记录一下</button></div>' : '') +
    '</div>';
}

/* 今日运动卡（原 renderHome 里的 planHTML） */
function homeWorkoutCardHTML(t, day){
  if(!day) return '<div class="card"><h3>📋 今日运动</h3><div class="empty"><div class="e-ic">🛋️</div>今天还没有运动项<br><button class="btn sm mt" data-additem="' + t + '">＋ 添加运动</button></div></div>';
  /* 逐项：行内打卡圆钮 + ✏️/🗑（与运动页同一套）；卡头只留卡名，
   * 进度 chip 与「＋ 添加运动」挪到卡底最后一行（对齐今日睡眠卡：左信息 + 右按钮） */
  const dn = doneCount(day), all = allDone(day);
  return '<div class="card"><h3><span>' + (all ? '✅' : '📋') + ' 今日运动</span></h3>' +
    (day.items.length ? day.items.map(it => exRowHTML(day, it, false)).join('')
                      : '<div class="empty" style="padding:12px">今天还没有运动项<br><span class="tiny">点「＋ 添加运动」加一项</span></div>') +
    '<div class="row mt" style="align-items:center">' +
      '<span class="chip' + (all ? ' ok' : '') + '">' + dn + '/' + day.items.length + '</span>' +
      /* margin-left:auto 而非 space-between：窄卡换行时按钮仍靠右，不会跳到下一行行首 */
      '<button class="btn sm ghost" data-additem="' + esc(day.date) + '" style="margin-left:auto">＋ 添加运动</button>' +
    '</div>' +
    '</div>';
}

/* 概览卡片区：按 state.homeOrder 拼装；空串 = 这张卡当前不显示（饮水目标设 0） */
function homeCardsHTML(t, eat, calPct){
  const day = workoutForDate(t);
  const parts = {
    diet: homeDietCardHTML(eat, calPct),
    workout: homeWorkoutCardHTML(t, day),
    water: state.waterTarget ? lifeWaterCard(t, 'home') : '',
    sleep: lifeSleepCard(t, 'home'),
    habits: habitCardHTML(),
  };
  return resolveHomeOrder(state.homeOrder).map(id => tagCard(id, parts[id])).filter(Boolean).join('');
}

/* ---------- 概览卡拖动排序（零依赖手写：HTML5 DnD 在触屏上不可用） ----------
 * 触屏：长按 250ms 拾取（期间移动 >8px 视为滚动，取消）；抓柄按下即拾取。
 * 鼠标：按下即拾取（桌面不存在“滚动抢手势”问题）。
 * 拖动只挪 DOM + 落 state.homeOrder，不重渲染（卡内监听器不重绑、不闪）。 */
let homeDrag = null;                        /* 当前拖动会话；bindPullToRefresh / cancelHomeDrag 靠它 */
const HDRAG = { LONG:250, CANCEL:8, EDGE:64, SPEED:12 };
const raf = fn => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));
const caf = id => { if(!id) return; if(typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); else clearTimeout(id); };

function homeScrollPane(){                 /* 手机端滚动容器收在 .main，桌面滚文档 */
  const m = document.getElementById('main');
  return (m && m.scrollHeight > m.clientHeight + 1) ? m : null;
}
function cancelHomeDrag(){
  const d = homeDrag; if(!d) return;
  homeDrag = null;
  if(d.timer){ clearTimeout(d.timer); d.timer = 0; }
  caf(d.raf);
  d.card.classList.remove('dragging', 'pressing');
  d.card.style.transform = '';
  document.body.classList.remove('hcard-dragging');
  if(d.touch){
    window.removeEventListener('touchmove', d.onMove);
    window.removeEventListener('touchend', d.onUp);
    window.removeEventListener('touchcancel', d.onUp);
  } else {
    window.removeEventListener('pointermove', d.onMove);
    window.removeEventListener('pointerup', d.onUp);
    window.removeEventListener('pointercancel', d.onUp);
  }
}
/* 拖动结束后紧跟的那次 click 不能落到卡内按钮上（长按抬手会补一个 click） */
function swallowNextClick(){
  const stop = e => { e.stopPropagation(); e.preventDefault(); off(); };
  const off = () => { document.removeEventListener('click', stop, true); clearTimeout(timer); };
  const timer = setTimeout(off, 400);
  document.addEventListener('click', stop, true);
}

function bindHomeSort(container){
  if(!container || typeof container.querySelectorAll !== 'function') return;
  const cards = () => [...container.querySelectorAll('.card[data-hcard]')];
  if(cards().length < 2) return;                 /* 只有一张卡：拖没意义（也不该长按选中文字） */
  const pane = homeScrollPane();
  const pickable = el => !(el && el.closest && el.closest('button,input,a,textarea,select,label'));

  /* 落位：读 DOM 顺序 → 把不显示的卡插回 → 存 */
  function commit(){
    const next = mergeOrder(cards().map(c => c.dataset.hcard), state.homeOrder);
    if(next.join(',') !== resolveHomeOrder(state.homeOrder).join(',')){ state.homeOrder = next; save(); }
  }
  /* 跟手 + 越过邻居中线就交换 DOM；交换后用实际布局位移把起算点抵消掉，视觉上原地不动
   * （单列交换 = 一个卡高；宽屏同排换列 ≈0；旧写法用邻居高度，同排换列时会凭空跳一截） */
  const DEAD = 6;   /* 中线死区：同一排两张窄卡的中线几乎重合，给几像素余量免得手抖就换位 */
  function follow(d){
    d.dy = d.lastY - d.y0;
    for(let guard = 0; guard < 20; guard++){
      const card = d.card;
      card.style.transform = d.dy ? 'translateY(' + d.dy + 'px)' : '';
      if(!d.dy) return;
      const list = cards(), i = list.indexOf(card);
      if(i < 0) return;
      const r = card.getBoundingClientRect(), mid = (r.top + r.bottom) / 2;
      const pr = i > 0 ? list[i-1].getBoundingClientRect() : null;
      const nr = i < list.length - 1 ? list[i+1].getBoundingClientRect() : null;
      const up = !!pr && mid < (pr.top + pr.bottom) / 2 - DEAD;
      const down = !up && !!nr && mid > (nr.top + nr.bottom) / 2 + DEAD;
      if(!up && !down) return;
      const before = card.getBoundingClientRect().top;
      if(up) container.insertBefore(card, list[i-1]);
      else container.insertBefore(card, list[i+1].nextSibling);
      d.y0 += card.getBoundingClientRect().top - before;
      d.dy = d.lastY - d.y0;
    }
  }
  function moveTo(d, y){
    d.lastY = y;
    d.edge = y < HDRAG.EDGE ? -1 : (y > window.innerHeight - HDRAG.EDGE ? 1 : 0);
    follow(d);
  }
  /* 拖到屏幕上下边缘时自动滚（不然卡长过一屏就没法跨屏搬） */
  function tick(){
    const d = homeDrag; if(!d) return;
    d.raf = raf(tick);
    if(!d.edge) return;
    const delta = d.edge * HDRAG.SPEED;
    if(pane) pane.scrollTop += delta; else window.scrollBy(0, delta);
    d.y0 -= delta;                               /* 内容相对指位移了，起算点跟着挪 */
    follow(d);
  }
  function start(card, y, fromTouch){
    const d = { card, y0:y, lastY:y, dy:0, edge:0, touch:fromTouch, timer:0, raf:0 };
    d.onUp = () => finish(d);
    d.onMove = ev => {
      const t = ev.touches ? ev.touches[0] : ev;
      if(!t) return;
      if(ev.touches && ev.cancelable) ev.preventDefault();   /* 触屏：压住滚动/回弹 */
      moveTo(d, t.clientY);
    };
    if(fromTouch){
      window.addEventListener('touchmove', d.onMove, {passive:false});   /* 非 passive 才能 preventDefault */
      window.addEventListener('touchend', d.onUp, {passive:true});
      window.addEventListener('touchcancel', d.onUp, {passive:true});
    } else {
      window.addEventListener('pointermove', d.onMove);
      window.addEventListener('pointerup', d.onUp);
      window.addEventListener('pointercancel', d.onUp);
    }
    homeDrag = d;
    card.classList.remove('pressing');
    card.classList.add('dragging');
    document.body.classList.add('hcard-dragging');
    if(navigator.vibrate){ try { navigator.vibrate(10); } catch(e){} }
    d.raf = raf(tick);
  }
  function finish(d){
    if(homeDrag !== d) return;
    cancelHomeDrag();
    commit();
    swallowNextClick();
  }

  /* --- 触屏：长按拾取（抓柄按下即拾取） --- */
  let pend = null;
  function pendClear(){
    if(!pend) return;
    clearTimeout(pend.timer);
    pend.card.classList.remove('pressing');
    window.removeEventListener('touchmove', pend.onMove);
    window.removeEventListener('touchend', pendClear);
    window.removeEventListener('touchcancel', pendClear);
    pend = null;
  }
  container.addEventListener('touchstart', e => {
    if(homeDrag || pend || e.touches.length !== 1) return;
    if(document.querySelector('.authgate,.overlay')) return;
    const y = e.touches[0].clientY;
    const card = e.target.closest && e.target.closest('.card[data-hcard]');
    if(!card || !container.contains(card) || !pickable(e.target)) return;
    if(e.target.closest('[data-hcard-grip]')){ start(card, y, true); return; }
    pend = { card, y0:y, timer:0, onMove:null };
    pend.onMove = ev => {
      const t = ev.touches[0];
      if(!t || Math.abs(t.clientY - pend.y0) > HDRAG.CANCEL) pendClear();   /* 是页面滚动，不是拖动 */
    };
    window.addEventListener('touchmove', pend.onMove, {passive:true});
    window.addEventListener('touchend', pendClear, {passive:true});
    window.addEventListener('touchcancel', pendClear, {passive:true});
    card.classList.add('pressing');
    pend.timer = setTimeout(() => { const c = pend.card; pendClear(); start(c, y, true); }, HDRAG.LONG);
  }, {passive:true});
  /* --- 鼠标：按下即拾取（只认 mouse；触屏的兼容 mouse 事件不会带 pointerType） --- */
  container.addEventListener('pointerdown', e => {
    if(homeDrag || e.pointerType !== 'mouse' || e.button !== 0) return;
    const card = e.target.closest && e.target.closest('.card[data-hcard]');
    if(!card || !container.contains(card) || !pickable(e.target)) return;
    start(card, e.clientY, false);
  });
  container.addEventListener('dragstart', e => e.preventDefault());   /* 别让浏览器原生拖图/拖字抢走 */
}

/* =====================================================
   饮食模块
===================================================== */
let dietDate = today();

function renderDiet(){
  const d = dietDate;
  const T = target();
  const tot = dayTotals(d);
  const calPct = Math.round(tot.kcal / T.kcal * 100);
  const rows = SLOTS.map(s => {
    const items = dayMeals(d)[s.id];
    const st = mealSlotTotals(d, s.id);
    const list = items.length ? items.map((it,i) =>
      '<div class="lrow" data-item="' + it.id + '">' +
        '<div class="thumb" style="background:' + slotColor(s.id) + '22;font-size:15px">' + s.ic + '</div>' +
        '<div class="grow"><div class="b">' + esc(it.name) + '</div>' +
          '<div class="sub">' + it.g + 'g · ' + st2kcal(it) + ' kcal · <span class="tiny">P' + st2p(it) + ' C' + st2c(it) + ' F' + st2f(it) + '</span></div></div>' +
        '<div class="textright"><b>' + round(st2kcal(it), 0) + '</b><div class="tiny">kcal</div></div>' +
        '<button class="iconbtn2" data-edit="' + it.id + '" title="修改">✏️</button>' +
        '<button class="iconbtn2" data-del="' + it.id + '" style="color:var(--danger)" title="删除">🗑</button>' +
      '</div>').join('')
      : '<div class="empty" style="padding:10px"><div class="e-ic" style="font-size:22px">🍴</div>未记录</div>';
    return '<div class="card" style="margin-bottom:12px"><h3>' + s.ic + ' ' + esc(s.label) +
      '<span class="grow"></span><span class="hint">' + st.kcal + ' kcal</span>' +
      '<button class="btn plus" data-addslot="' + s.id + '" title="添加' + esc(s.label) + '" aria-label="添加' + esc(s.label) + '">＋</button></h3>' + list + '</div>';
  }).join('');

  const html =
    '<div class="card"><div class="row" style="justify-content:center;align-items:center">' +
      '<div class="daynav"><button class="iconbtn2" data-day="-1">‹</button>' +
        '<div class="lbl">' + dateCN(d) + '<small>' + (d===today() ? '今天' : '周' + DAY_CN[weekday(d)]) + '</small></div>' +
        '<button class="iconbtn2" data-day="1">›</button>' +
        (d !== today() ? '<button class="btn sm" data-day="today">回到今天</button>' : '') +
      '</div>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;margin:12px 0 6px" class="small"><span class="muted">热量目标</span><b>' + fmtNum(tot.kcal) + ' / ' + fmtNum(T.kcal) + ' kcal</b></div>' +
    '<div class="meter"><i style="width:' + clamp(calPct,0,100) + '%" class="' + (calPct>100?'over':'') + '"></i></div>' +
    '<div class="row gap8" style="margin-top:10px">' +
      '<span class="chip b1">蛋白 ' + tot.p + ' / ' + T.p + 'g</span>' +
      '<span class="chip b2">碳水 ' + tot.c + ' / ' + T.c + 'g</span>' +
      '<span class="chip b3">脂肪 ' + tot.f + ' / ' + T.f + 'g</span>' +
    '</div></div>' +
    rows;

  $('#view').innerHTML = html;
  const v = $('#view');
  $$('[data-day]', v).forEach(b => b.addEventListener('click', () => {
    if(b.dataset.day === 'today') dietDate = today();
    else dietDate = addDays(dietDate, num(b.dataset.day));
    renderDiet();
  }));
  $$('[data-addslot]', v).forEach(b => b.addEventListener('click', () => addMealDialog(dietDate, b.dataset.addslot)));
  $$('[data-edit]', v).forEach(b => b.addEventListener('click', () => editMealDialog(dietDate, b.dataset.edit)));
  $$('[data-del]', v).forEach(b => b.addEventListener('click', () => delMealItem(dietDate, b.dataset.del)));
}
function slotColor(id){ return {breakfast:'#eda100', lunch:'#eb6834', dinner:'#4a3aa7', snack:'#1baf7a'}[id] || 'var(--brand)'; }
function st2kcal(it){ const x = itemMacro(it); return round(x.kcal,0); }
function st2p(it){ return round(itemMacro(it).p,0); }
function st2c(it){ return round(itemMacro(it).c,0); }
function st2f(it){ return round(itemMacro(it).f,0); }
function findMealItem(date, id){ const dm = dayMeals(date); for(const s of SLOTS){ const f = dm[s.id].find(i => i.id === id); if(f) return f; } return null; }
function slotOfItem(date, id){ const dm = dayMeals(date); for(const s of SLOTS){ if(dm[s.id].some(i => i.id === id)) return s.id; } return null; }
function delMealItem(date, id){
  const dm = dayMeals(date);
  for(const s of SLOTS){ const ix = dm[s.id].findIndex(i => i.id === id); if(ix >= 0){ dm[s.id].splice(ix,1); save(); renderDiet(); toast('已删除'); return; } }
}

/* ---------- 记录饮食弹窗：三 tab（我的库 / 系统库 / 新增）+ 共用底栏 ----------
 * 我的库/系统库 = 只读营养 + 只填「实际吃了多少克」；新增 = 全字段手填。
 * 后两者带「同时保存到我的食物库」勾选：系统库未拥有的默认勾选（已有的折叠），
 * 新增默认不勾。入库 src 沿用源条目（USDA/用户），与食物库页「＋我的库」挑入口径一致。
 * tab 不做跨次记忆：正式入口（饮食页「＋ 添加」）每次打开都停在「我的库」；
 * opts.tab 只是调用方显式指定的初始分页（供测试与以后复用），不是记忆。 */
let mdTab = 'mine';        /* 弹窗内当前 tab */
let mdQuery = '';          /* 当前 tab 的搜索词（切 tab 清空） */
const PICK_LIMIT = 40;     /* 弹窗候选只渲染前 40 条（记录饮食 / 添加运动共用），配合关键字收敛；避免 300+ 行 DOM */
/* 「同时保存到我的食物库」默认勾选口径：只有从系统库选中、且自己库里还没同名的才默认勾；
 * 新增 tab 默认不勾（避免手填半成品污染个人库），我的库 tab 压根不给这个选项。 */
function mealDlgSaveDefault(tab, name){ return tab === 'sys' && !state.foods.some(x => x.name === name); }
/* 入库勾选可见性（与 mealDlgSaveDefault 配套）：只有非「我的库」分页、且当前食物名在本人的库里
 * 还没同名时才给勾选；库里已有同名的改成「已有」提示（不静默跳过）。按名判重沿用同一规则。 */
function mealShowSaveChk(tab, cur){ return tab !== 'mine' && !!cur && !state.foods.some(x => x.name === cur.name); }
/* 「已有」提示行：只说口径（本次只记这一餐、不重复入库），不写操作指引 */
function mealOwnedTipHTML(name){ return '<span class="chip b3">已有</span> 我的库里已有「' + esc(name) + '」，本次只记这一餐，不会入库、也不会改库里那份的营养。'; }
function addMealDialog(date, slot, opts){
  mdTab = (opts && ['mine','sys','new'].indexOf(opts.tab) >= 0) ? opts.tab : 'mine'; mdQuery = '';
  let sysFoods = null;     /* 本次弹窗拉到的系统库（走 SYS_LIB 缓存，切 tab 不重下） */
  let selMine = null;      /* 我的库选中条目 */
  let selSys = null;       /* 系统库选中条目 */
  const S = SLOTS.find(s => s.id === slot) || { ic:'🍽️', label:'记录' };
  const html =
    '<div class="row gap8" style="margin-bottom:10px">' +
      '<span class="chip">' + dateCNW(date) + '</span><span class="chip slot" style="background:' + slotColor(slot) + '22;border-color:transparent">' + S.ic + ' ' + esc(S.label) + '</span>' +
    '</div>' +
    '<div class="seg" id="md_seg" style="display:flex;width:100%;margin-bottom:12px">' +
      '<button type="button" data-mtab="mine" style="flex:1">我的库</button>' +
      '<button type="button" data-mtab="sys" style="flex:1">系统库</button>' +
      '<button type="button" data-mtab="new" style="flex:1">新增</button>' +
    '</div>' +
    '<div id="md_p_mine"><div class="field" style="margin-bottom:8px"><label>搜索并选择</label>' +
      '<input class="input" id="mi_q" type="search" placeholder="搜索食物名…">' +
      '<div class="picklist" id="mi_list"></div></div></div>' +
    '<div id="md_p_sys" style="display:none"><div class="field" style="margin-bottom:8px"><label>搜索并选择系统库食物</label>' +
      '<input class="input" id="mi_qs" type="search" placeholder="搜索食物名…">' +
      '<div class="picklist" id="mi_syslist"></div></div></div>' +
    '<div id="md_p_new" style="display:none"><div class="form-grid" style="margin-bottom:8px">' +
      '<div class="span2"><label>食物名称</label><input class="input" id="mi_name" placeholder="如：鸡胸肉"></div>' +
      '<div><label>每100g热量</label><input class="input" id="mi_kcal" type="number" min="0"></div>' +
      '<div><label>每100g蛋白 g</label><input class="input" id="mi_p" type="number" min="0" step="0.1"></div>' +
      '<div><label>每100g碳水 g</label><input class="input" id="mi_c" type="number" min="0" step="0.1"></div>' +
      '<div><label>每100g脂肪 g</label><input class="input" id="mi_f" type="number" min="0" step="0.1"></div>' +
    '</div>' +
    '<div class="tiny muted" style="margin-bottom:8px">营养按每 100g 填，留空按 0 记。</div></div>' +
    '<div class="tiny" id="mi_per100" style="margin-bottom:8px"></div>' +
    '<div class="form-grid"><div class="span2"><label>实际吃了多少（克）</label>' +
      '<input class="input" id="mi_g" type="number" min="1" value="100">' +
      '<div class="tiny muted" id="mi_prev" style="margin-top:6px"></div></div></div>' +
    '<label class="chkline" id="mi_save_wrap" style="margin-top:2px"><input type="checkbox" id="mi_savefood"> 同时保存到我的食物库</label>' +
    '<div class="tiny" id="mi_owned" style="display:none;margin-top:6px"></div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="mi_save">保存</button></div>';
  const dlg = showDialog('记录饮食', html);
  const b = dlg.box;
  const owned = name => state.foods.some(x => x.name === name);
  function readNew(){ return { name:$('#mi_name', b).value.trim(), kcal:num($('#mi_kcal', b).value), p:num($('#mi_p', b).value), c:num($('#mi_c', b).value), f:num($('#mi_f', b).value) }; }
  /* 当前 tab 下的「这一餐吃了什么」：{ name, src, per100 }；未选/未填 → null */
  function currentFood(){
    if(mdTab === 'mine') return selMine ? { name:selMine.name, src:selMine.src || FOOD_SRC_USER, per100:selMine.per100 || null } : null;
    if(mdTab === 'sys')  return selSys  ? { name:selSys.name,  src:selSys.src  || FOOD_SRC_SYS,  per100:selSys.per100  || null } : null;
    const f = readNew();
    return f.name ? { name:f.name, src:FOOD_SRC_USER, per100:{ kcal:f.kcal, p:f.p, c:f.c, f:f.f } } : null;
  }
  function refresh(){
    const cur = currentFood(), per = cur ? cur.per100 : null;
    $('#mi_prev', b).innerHTML = per ? mealPrevHTML(per, num($('#mi_g', b).value) || 0)
      : '<span class="muted">' + (!cur ? (mdTab === 'new' ? '填写名称与每100g营养后自动换算合计' : '先选一个食物，再填吃了多少克')
          : '该条目无营养表，合计按 0 记；要补营养请走「新增」') + '</span>';
    /* 库条目的每100g 只读回显（新增 tab 的表单自己承载，不重复显示） */
    const box = $('#mi_per100', b);
    if(!cur || mdTab === 'new' || !per){ box.style.display = 'none'; box.innerHTML = ''; }
    else {
      box.style.display = '';
      box.innerHTML = '<span class="chip slot" style="margin-right:6px">' + esc(cur.src) + '</span>每100g：'
        + Math.round(per.kcal || 0) + ' kcal · P' + (per.p || 0) + ' C' + (per.c || 0) + ' F' + (per.f || 0);
    }
    /* 入库可见性：我的库不给这个选项；其余 tab 选了/填了名字且库里还没同名的才给勾选。
     * 已有同名（系统库选中同名条目、或新增填了库里已有的名字）→ 把勾选行换成与系统库行内
     * 同口径的「已有」提示，说清本次只记这一餐不入库，不静默跳过。 */
    const showChk = mealShowSaveChk(mdTab, cur);
    const showTip = !showChk && mdTab !== 'mine' && !!cur;
    $('#mi_save_wrap', b).style.display = showChk ? '' : 'none';
    $('#mi_owned', b).style.display = showTip ? '' : 'none';
    $('#mi_owned', b).innerHTML = showTip ? mealOwnedTipHTML(cur.name) : '';
    if(!showChk) $('#mi_savefood', b).checked = false;
    $$('#md_seg [data-mtab]', b).forEach(btn => btn.classList.toggle('active', btn.dataset.mtab === mdTab));
    ['mine', 'sys', 'new'].forEach(t => { $('#md_p_' + t, b).style.display = (t === mdTab ? '' : 'none'); });
  }
  function pickRowHTML(f, attr, selected, badge){
    return '<button type="button" class="pickrow' + (selected ? ' on' : '') + '" ' + attr + '>' +
      '<span class="grow">' + esc(f.name) + (badge || '') + '</span>' +
      '<span class="tiny muted">' + (f.per100 ? Math.round(f.per100.kcal || 0) + ' kcal/100g' : '无营养表') + '</span></button>';
  }
  function hitList(arr, q){ return q ? arr.filter(f => String(f.name).toLowerCase().indexOf(q) >= 0) : arr; }
  function moreHint(total){ return total > PICK_LIMIT
    ? '<div class="tiny muted" style="padding:6px 12px">还有 ' + (total - PICK_LIMIT) + ' 条，输入关键字继续筛选</div>' : ''; }
  function renderMine(){
    const q = mdQuery.trim().toLowerCase();
    let h;
    if(!state.foods.length){
      h = '<div class="tiny muted" style="padding:12px">我的食物库是空的，切到「系统库」挑一条，或在「新增」手填（勾选可顺手存进我的库）。</div>';
    } else {
      const hits = hitList(state.foods, q);
      h = hits.length
        ? hits.slice(0, PICK_LIMIT).map(f => pickRowHTML(f, 'data-mypick="' + esc(f.id) + '"', selMine && selMine.id === f.id)).join('') + moreHint(hits.length)
        : '<div class="tiny muted" style="padding:8px 12px">没有匹配「' + esc(q) + '」的食物</div>';
      if(hits.length && !q) h = '<div class="tiny muted" style="padding:6px 12px 2px">共 ' + state.foods.length + ' 条，输入关键字筛选</div>' + h;
    }
    $('#mi_list', b).innerHTML = h;
    $$('[data-mypick]', b).forEach(btn => btn.addEventListener('click', () => {
      selMine = state.foods.find(f => f.id === btn.dataset.mypick) || null;
      selSys = null; renderMine(); refresh();
    }));
  }
  async function renderSys(){
    if(sysFoods === null){
      $('#mi_syslist', b).innerHTML = '<div class="tiny muted" style="padding:8px 12px">载入系统库…</div>';
      const lib = await fetchSysLib();
      sysFoods = lib ? (lib.foods || []) : false;
      if(mdTab !== 'sys') return;   /* 载入期间用户切走了 */
    }
    if(sysFoods === false){
      $('#mi_syslist', b).innerHTML = sysLibErrTipHTML();
      return;
    }
    const q = mdQuery.trim().toLowerCase();
    const all = sysFoods.map((f, i) => ({ f, i })).filter(x => !q || String(x.f.name).toLowerCase().indexOf(q) >= 0);
    let h;
    if(!all.length){
      h = '<div class="tiny muted" style="padding:8px 12px">' + (sysFoods.length ? '没有匹配「' + esc(q) + '」的食物' : '系统库暂无食物') + '</div>';
    } else {
      h = '<div class="tiny muted" style="padding:6px 12px 2px">共 ' + all.length + ' 条；标「已有」的说明我的库里同名，选中也不会重复入库。</div>' +
        all.slice(0, PICK_LIMIT).map(x => pickRowHTML(x.f, 'data-syspick="' + x.i + '"', selSys && selSys.name === x.f.name,
          owned(x.f.name) ? '<span class="chip b3" style="margin-left:6px;padding:1px 7px;font-size:11px">已有</span>' : '')).join('') + moreHint(all.length);
    }
    $('#mi_syslist', b).innerHTML = h;
    $$('[data-syspick]', b).forEach(btn => btn.addEventListener('click', () => {
      selSys = sysFoods[num(btn.dataset.syspick)] || null;
      selMine = null;
      if(selSys) $('#mi_savefood', b).checked = mealDlgSaveDefault('sys', selSys.name);   /* 未拥有的默认入库 */
      renderSys(); refresh();
    }));
  }
  function renderList(){ if(mdTab === 'mine') renderMine(); else if(mdTab === 'sys') renderSys(); }
  function switchTab(t){
    mdTab = t; mdQuery = '';
    $('#mi_q', b).value = ''; $('#mi_qs', b).value = '';
    selMine = null; selSys = null;
    $('#mi_savefood', b).checked = false;   /* 新增默认不勾（避免污染个人库） */
    refresh(); renderList();
  }
  $$('#md_seg [data-mtab]', b).forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.mtab)));
  $('#mi_q', b).addEventListener('input', e => { mdQuery = e.target.value; renderMine(); });
  $('#mi_qs', b).addEventListener('input', e => { mdQuery = e.target.value; renderSys(); });
  $$('input', b).forEach(i => i.addEventListener('input', refresh));
  invalidateSysLib();   /* v4.4 口径：每次打开弹窗失效一次，管理员的改动进弹窗即新 */
  refresh(); renderList();
  $('#mi_save', b).addEventListener('click', () => {
    const g = num($('#mi_g', b).value);
    if(mdTab === 'mine'){
      if(!selMine){ toast('请从我的库选一个食物', true); return; }
      if(!g){ toast('请填写克数', true); return; }
      addMealItem(date, slot, { id:uid(), name:selMine.name, per100:safePer100(selMine.per100), g });
    } else if(mdTab === 'sys'){
      if(!selSys){ toast('请从系统库选一个食物', true); return; }
      if(!g){ toast('请填写克数', true); return; }
      if($('#mi_savefood', b).checked && !owned(selSys.name)){
        const nf = { id:uid(), name:selSys.name, src:selSys.src || FOOD_SRC_SYS };   /* 来源随条目一起挑进来 */
        if(selSys.per100) nf.per100 = Object.assign({}, selSys.per100);
        state.foods.push(nf); toast('已加入食物库：' + selSys.name);
      }
      addMealItem(date, slot, { id:uid(), name:selSys.name, per100:safePer100(selSys.per100), g });
    } else {
      const f = readNew();
      if(!f.name){ toast('请填写食物名称', true); return; }
      if(!g){ toast('请填写克数', true); return; }
      const per100 = { kcal:f.kcal, p:f.p, c:f.c, f:f.f };
      if($('#mi_savefood', b).checked && !owned(f.name)){
        state.foods.push({ id:uid(), name:f.name, src:FOOD_SRC_USER, per100 }); toast('已加入食物库：' + f.name);
      }
      addMealItem(date, slot, { id:uid(), name:f.name, per100, g });
    }
    save(); closeDialog(); renderDiet();
  });
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
}

/* 修改一条已记录的食物：只改「实际吃了多少克」+ 删除。
 * 记录是 name+per100+g 的副本，按名匹配回库不可靠，故不开放改营养、也不写回食物库。 */
function editMealDialog(date, itemId){
  const item = findMealItem(date, itemId);
  if(!item) return;
  const slot = slotOfItem(date, itemId);
  const S = SLOTS.find(s => s.id === slot) || { ic:'🍽️', label:'记录' };
  const per = item.per100 || {};
  const html =
    '<div class="row gap8" style="margin-bottom:10px">' +
      '<span class="chip">' + dateCNW(date) + '</span><span class="chip slot" style="background:' + slotColor(slot) + '22;border-color:transparent">' + S.ic + ' ' + esc(S.label) + '</span>' +
    '</div>' +
    '<div class="b" style="margin-bottom:4px">' + esc(item.name) + '</div>' +
    '<div class="tiny muted" style="margin-bottom:10px">每100g：' + Math.round(per.kcal || 0) + ' kcal · P' + (per.p || 0) + ' C' + (per.c || 0) + ' F' + (per.f || 0)
      + '（记录时已定格，不支持改营养；要改请删掉重记）</div>' +
    '<div class="form-grid"><div class="span2"><label>实际吃了多少（克）</label>' +
      '<input class="input" id="me_g" type="number" min="1" value="' + item.g + '">' +
      '<div class="tiny muted" id="me_prev" style="margin-top:6px"></div></div></div>' +
    '<div class="d-f"><button class="btn danger ghost" id="me_del">删除</button>' +
      '<button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="me_save">保存</button></div>';
  const dlg = showDialog('修改记录', html);
  const box = dlg.box;
  function refresh(){ $('#me_prev', box).innerHTML = mealPrevHTML(per, num($('#me_g', box).value) || 0); }
  $$('input', box).forEach(i => i.addEventListener('input', refresh));
  refresh();
  $('#me_save', box).addEventListener('click', () => {
    const g = num($('#me_g', box).value);
    if(!g){ toast('请填写克数', true); return; }
    item.g = g; save(); closeDialog(); renderDiet();
  });
  $('#me_del', box).addEventListener('click', () => { delMealItem(date, itemId); closeDialog(); });
  const cx = $('[data-cancel]', box); if(cx) cx.addEventListener('click', closeDialog);
}
function mealPrevHTML(per, g){ const k = (per.kcal || 0) * g / 100, p = (per.p || 0) * g / 100, c = (per.c || 0) * g / 100, fa = (per.f || 0) * g / 100;
  return '合计：<b>' + Math.round(k) + ' kcal</b> · 蛋白 ' + round(p, 1) + 'g · 碳水 ' + round(c, 1) + 'g · 脂肪 ' + round(fa, 1) + 'g'; }
/* 库条目可能没有 per100（早期挑入/自录留空），补 0 兜底：itemMacro 不做存在性检查，缺字段会算出 NaN */
function safePer100(per){ const x = per || {}; return { kcal:num(x.kcal), p:num(x.p), c:num(x.c), f:num(x.f) }; }

/* =====================================================
   系统共享库（v4：管理员维护，普通用户只读；个人库可从中挑入）
===================================================== */
let SYS_LIB = null;
let SYS_LIB_ERR = null;              /* 'timeout' = 4s 超时主动放弃；'offline' = 连接失败；'http' = 服务端非 2xx */
/* v4.16：区分「超时」与「真离线」——旧版把任何失败都写成「服务器离线」，
 * 网络抖动（或主线程被长任务卡住使 4s 定时器“过得比响应还快”）时属于误报。 */
function sysLibErrTipHTML(){
  return '<div class="tiny muted" style="padding:12px">' + (SYS_LIB_ERR === 'timeout'
    ? '⏳ 系统库加载超时（网络较慢）；'
    : '🔌 服务器离线，暂时看不到系统库；') + '「我的库」与「新增」仍可正常记录。</div>';
}
function sysLibErrEmptyHTML(){
  return '<div class="empty" style="padding:14px"><div class="e-ic" style="font-size:24px">' + (SYS_LIB_ERR === 'timeout' ? '⏳' : '🔌') + '</div>'
    + (SYS_LIB_ERR === 'timeout' ? '系统库加载超时（网络较慢）；重开本页会自动重试' : '服务器离线，暂时看不到系统库') + '</div>';
}
async function fetchSysLib(){
  if(SYS_LIB) return SYS_LIB;
  try {
    const r = await srvFetch('/system/library', { method: 'GET' }, 4000);
    if(r.status === 401){ authExpired(); return null; }
    if(!r.ok) throw new Error('HTTP ' + r.status);
    SYS_LIB = await r.json();
    SYS_LIB_ERR = null;
    return SYS_LIB;
  } catch(e){
    SYS_LIB_ERR = (e && e.name === 'AbortError') ? 'timeout' : 'offline';
    return null;
  }
}
/* v4.4:系统库在「每次打开食物库 / 动作库弹窗」时拉取一次,之后导入与分页切换都走内存——
 * 旧版两处调用点 force=true 把 SYS_LIB 写成只写不读的死缓存,每个导入动作/每次切系统库
 * 都整库重下(上限 5000 条)。管理员的改动发生在另一个页面会话,进入时失效一次已足够新。 */
function invalidateSysLib(){ SYS_LIB = null; }
function importFoodFromSys(fo){
  if(!fo || !fo.name) return false;
  if(USERS.shared.foods.some(x => x.name === fo.name)){ toast('我的库已有「' + fo.name + '」', true); return false; }
  const nf = { id: uid(), name: fo.name, src: fo.src || FOOD_SRC_SYS };   /* 来源随条目一起挑进来 */
  if(fo.per100) nf.per100 = Object.assign({}, fo.per100);
  USERS.shared.foods.push(nf); save();
  return true;
}
function importExerciseFromSys(e){
  if(!e || !e.name) return false;
  if(USERS.shared.exercises.some(x => x.name === e.name)){ toast('我的库已有「' + e.name + '」', true); return false; }
  const ne = { id: uid(), name: e.name };
  if(e.cat) ne.cat = e.cat;
  if(e.muscle) ne.muscle = e.muscle;
  if(e.mode) ne.mode = e.mode;
  USERS.shared.exercises.push(ne); save();
  return true;
}
/* 行内 = 名称 + 营养来源小签 + 每100g 一行。srcFallback 兜老条目缺 src 的情况
 * （我的库缺字段 = 用户自录 → 「用户」；系统库缺字段 = 系统种子 → USDA）。 */
function foodRowHTML(f, dataAttr, srcFallback){
  const sub = f.per100 ? ('每100g：' + Math.round(f.per100.kcal||0) + ' kcal · P' + (f.per100.p||0) + ' C' + (f.per100.c||0) + ' F' + (f.per100.f||0)) : '无营养表';
  const src = f.src || srcFallback;
  return '<div class="lrow" ' + dataAttr + '><div class="grow"><div class="b">' + esc(f.name) +
    (src ? '<span class="chip slot" style="margin-left:6px;font-weight:600">' + esc(src) + '</span>' : '') +
    '</div><div class="sub">' + esc(sub) + '</div></div>';
}

/* ---------- 库页共用小工具（食物库 / 动作库两页同款：名称搜索 + 分页条） ----------
 * 两页的分页口径一致（20 条/页、换搜索词或切分页回第 1 页），抽出来免得各自漂移。 */
function libMatchName(query, name){
  const q = String(query == null ? '' : query).trim().toLowerCase();
  return !q || String(name == null ? '' : name).toLowerCase().indexOf(q) >= 0;
}
function libClampPage(page, size, n){
  const pages = Math.max(1, Math.ceil(n / size));
  return Math.min(Math.max(1, page), pages);
}
function libPagerHTML(page, size, n){
  const pages = Math.max(1, Math.ceil(n / size));
  const from = n ? (page - 1) * size + 1 : 0;
  const to = Math.min(n, page * size);
  return '<div class="pager">' +
    '<button class="btn sm ghost" data-fpage="prev"' + (page <= 1 ? ' disabled' : '') + '>‹ 上一页</button>' +
    '<span class="tiny">第 ' + page + '/' + pages + ' 页 · 共 ' + n + ' 条' + (n ? '（' + from + '–' + to + '）' : '') + '</span>' +
    '<button class="btn sm ghost" data-fpage="next"' + (page >= pages ? ' disabled' : '') + '>下一页 ›</button>' +
    '</div>';
}

/* 食物库管理（设置页 → 💾 数据管理 → 本页）：我的库（可增删）| 系统库（只读 + 挑入我的库）。
 * v4.15：由弹窗改为独立页面——页头第一行是「返回 + 数据管理-食物库」，返回落回设置页。 */
let foodLibTab = 'mine';   /* 页面级状态：切到系统库后再进来仍停在原分页 */
let foodLibQuery = '';     /* 搜索词：两个分页共用，切分页保留 */
let foodLibPage = 1;       /* 当前页码：换搜索词/切分页时回到第 1 页 */
let foodLibSysCount = null;/* 本次进页拉到的系统库条数（tab 上显示）；未拉到就只写「系统库」 */
let foodLibGen = 0;        /* 页面代次：系统库异步回来时若已切走页面，就别再碰旧 DOM */
const FOOD_PAGE_SIZE = 20; /* 移动端一屏能扫完的行数 */
function renderFoodLibPage(){
  invalidateSysLib();   /* v4.4:每次进页拉一次系统库即可,页内切分页不再重下 */
  const gen = ++foodLibGen;
  foodLibSysCount = null;
  $('#view').innerHTML =
    '<div class="pagehead"><button class="iconbtn2" id="fl_back" title="返回设置">‹</button><div class="ph-t">数据管理-食物库</div></div>' +
    '<div class="card">' +
      '<div class="row" style="margin-bottom:10px"><div class="seg" id="fl_seg"></div></div>' +
      '<div class="field" style="margin:0 0 4px"><input class="input" id="fl_search" type="search" placeholder="搜索食物名称…" value="' + esc(foodLibQuery) + '"></div>' +
      '<div id="fl_body"><div class="tiny muted">载入中…</div></div>' +
    '</div>';
  $('#fl_back').addEventListener('click', () => go('settings'));
  const b = $('#view');
  let tab = foodLibTab;
  let sysCache = null;   /* 本次进页拉到的系统库：切分页/改搜索词不再重下 */
  let sysReady = null;   /* 进页那次拉取（tab 条数与系统库分页共用同一份）；失败置回 null 以便重试 */
  /* 页面是否还在：换页只换 #view 的 innerHTML（代次只在本页重进时自增），两个都得查——
   * 否则异步回来时会往已经不在的 #fl_seg / #fl_body 上写（null.innerHTML → TypeError）。 */
  const alive = () => gen === foodLibGen && !!$('#fl_body', b);
  const loadSys = () => (sysReady = sysReady || fetchSysLib());
  /* 进页就把系统库拉回来：tab 上要显示它的条数（用户裁定），切到系统库分页时也直接复用这一份 */
  loadSys().then(sys => {
    if(!alive()) return;   /* 页面已切走：不碰旧 DOM */
    if(!sys){ sysReady = null; return; }   /* 离线/失败：tab 数字留空（不写 0），切分页时重试 */
    foodLibSysCount = (sys.foods || []).length;
    paintSeg();
  });
  $('#fl_search', b).addEventListener('input', e => { foodLibQuery = e.target.value; foodLibPage = 1; render(); });
  function matchName(name){ return libMatchName(foodLibQuery, name); }
  function pageSlice(arr){
    foodLibPage = libClampPage(foodLibPage, FOOD_PAGE_SIZE, arr.length);
    const start = (foodLibPage - 1) * FOOD_PAGE_SIZE;
    return arr.slice(start, start + FOOD_PAGE_SIZE);
  }
  function pagerHTML(n){ return libPagerHTML(foodLibPage, FOOD_PAGE_SIZE, n); }
  function bindPager(){
    $$('[data-fpage]', b).forEach(btn => btn.addEventListener('click', () => {
      foodLibPage += (btn.dataset.fpage === 'next' ? 1 : -1);
      render();
    }));
  }
  function paintSeg(){
    const seg = $('#fl_seg', b);
    if(!seg) return;   /* 页面已切走（换页会清 #view）：别往旧 DOM 上写 */
    seg.innerHTML =
      '<button data-ft="mine" class="' + (tab==='mine'?'active':'') + '">我的库（' + state.foods.length + '）</button>' +
      '<button data-ft="sys" class="' + (tab==='sys'?'active':'') + '">系统库' +
        (foodLibSysCount === null ? '' : '（' + foodLibSysCount + '）') + '</button>';
    $$('#fl_seg [data-ft]', b).forEach(btn => btn.addEventListener('click', () => { tab = foodLibTab = btn.dataset.ft; foodLibPage = 1; paintSeg(); render(); }));
  }
  function renderMine(){
    const hits = state.foods.filter(f => matchName(f.name));
    const list = pageSlice(hits).map(f =>
      foodRowHTML(f, 'data-id="' + f.id + '"', FOOD_SRC_USER) +
        '<button class="iconbtn2" data-editf="' + f.id + '" title="修改">✏️</button>' +
        '<button class="iconbtn2" data-delf="' + f.id + '" title="删除" style="color:var(--danger)">🗑</button></div>').join('');
    /* 添加表单收进弹窗（卡头一颗「＋ 添加食物」），列表与计数留给页面 */
    $('#fl_body', b).innerHTML =
      '<h3><span>📚 我的食物库（' + state.foods.length + '）</span><span class="grow"></span>' +
        '<button class="btn sm primary" id="nf_open">＋ 添加食物</button></h3>' +
      '<div class="tiny muted" style="margin-bottom:8px">「系统库」分页可挑选管理员维护的公共食物；记饮食请到「饮食」页。</div>' +
      (list || (state.foods.length
        ? '<div class="empty" style="padding:14px"><div class="e-ic" style="font-size:24px">🔍</div>没有匹配「' + esc(foodLibQuery.trim()) + '」的食物</div>'
        : '<div class="empty" style="padding:14px"><div class="e-ic" style="font-size:24px">📚</div>我的食物库是空的，去「系统库」挑一些吧</div>')) +
      (hits.length ? pagerHTML(hits.length) : '');
    $('#nf_open', b).addEventListener('click', () => openFoodAdder(() => { paintSeg(); foodLibPage = 1; renderMine(); }));
    $$('[data-editf]', b).forEach(btn => btn.addEventListener('click', () => {
      const f = state.foods.find(x => x.id === btn.dataset.editf);
      if(f) openFoodEditor(f, () => { paintSeg(); renderMine(); });
    }));
    $$('[data-delf]', b).forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.delf;
      USERS.shared.foods = USERS.shared.foods.filter(f => f.id !== id);
      state.foods = USERS.shared.foods;
      save(); paintSeg(); renderMine();
    }));
    bindPager();
  }
  async function renderSys(){
    if(!sysCache){
      $('#fl_body', b).innerHTML = '<div class="tiny muted">载入系统库…</div>';
      sysCache = await loadSys();   /* 进页时已发起（见上），这里复用同一份，不再重下 */
      if(!alive()) return;   /* 载入期间用户离开了本页（换页 / 重进） */
      if(tab !== 'sys') return;   /* 载入期间用户切回了我的库 */
      if(!sysCache) sysReady = null;   /* 离线/失败：这次不缓存，下次切分页再试一次 */
    }
    if(!sysCache){ $('#fl_body', b).innerHTML = sysLibErrEmptyHTML(); return; }
    /* 已在我的库（同名）= 只读标记，与动作库系统分页同一口径；用 Set 一次建索引，避免逐行 O(n) 扫 */
    const sysFoods = sysCache.foods || [];
    const ownedNames = new Set(USERS.shared.foods.map(x => x.name));
    const all = sysFoods.map((f, i) => ({ f, i })).filter(x => matchName(x.f.name));
    const rows = pageSlice(all).map(x =>
      foodRowHTML(x.f, 'data-sysf="' + x.i + '"', FOOD_SRC_SYS) +
      (ownedNames.has(x.f.name)
        ? '<span class="chip b3" style="padding:2px 9px;font-size:12px">已有</span></div>'
        : '<button class="btn sm ghost" data-impf="' + x.i + '">＋我的库</button></div>')).join('');
    $('#fl_body', b).innerHTML =
      '<div class="tiny muted" style="margin-bottom:8px">系统共享库由管理员在后台维护，只读。点「＋我的库」把它挑进自己的食物库；与你库里同名的直接标「已有」。</div>' +
      (rows || '<div class="empty" style="padding:14px"><div class="e-ic" style="font-size:24px">' + (sysFoods.length ? '🔍' : '🗂') + '</div>' +
        (sysFoods.length ? '没有匹配「' + esc(foodLibQuery.trim()) + '」的食物' : '系统库暂无食物') + '</div>') +
      (all.length ? pagerHTML(all.length) : '');
    $$('[data-impf]', b).forEach(btn => btn.addEventListener('click', () => {
      if(importFoodFromSys(sysFoods[num(btn.dataset.impf)])){ btn.outerHTML = '<span class="chip b3" style="padding:2px 9px;font-size:12px">已有</span>'; paintSeg(); }
    }));
    bindPager();
  }
  function render(){ if(tab === 'mine') renderMine(); else renderSys(); }
  paintSeg(); render();   /* 按 tab 渲染：foodLibTab 会被记住，再进页可能停在「系统库」 */
}

/* 添加食物弹窗（我的库）：名称必填、同名拒绝；营养值留空按 0 记。
 * 写入本人食物库后立即落库并关闭，after() 让页面列表与「我的库（n）」计数即时刷新。 */
function openFoodAdder(after){
  const dlg = showDialog('添加食物',
    '<div class="field"><label>食物名称</label><input class="input" id="nf_name" placeholder="如：鸡胸肉"></div>' +
    '<div class="form-grid">' +
      '<div><label>热量 kcal / 100g</label><input class="input" id="nf_kcal" type="number" min="0" inputmode="decimal"></div>' +
      '<div><label>蛋白质 g / 100g</label><input class="input" id="nf_p" type="number" min="0" inputmode="decimal"></div>' +
      '<div><label>碳水 g / 100g</label><input class="input" id="nf_c" type="number" min="0" inputmode="decimal"></div>' +
      '<div><label>脂肪 g / 100g</label><input class="input" id="nf_f" type="number" min="0" inputmode="decimal"></div>' +
    '</div>' +
    '<div class="tiny muted" style="margin-top:10px">留空按 0 记；与库里已有的同名食物会被拒绝。</div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="nf_add">添加</button></div>');
  const b = dlg.box;
  const add = () => {
    const name = $('#nf_name', b).value.trim(); if(!name){ toast('请填名称', true); return; }
    if(foodDupInMine(name)){ toast('该食物已存在', true); return; }   /* 与编辑共用同一口径 */
    state.foods.push({ id:uid(), name, src:FOOD_SRC_USER, per100:{ kcal:num($('#nf_kcal', b).value), p:num($('#nf_p', b).value), c:num($('#nf_c', b).value), f:num($('#nf_f', b).value) } });
    save(); closeDialog(); if(after) after(); toast('已添加：' + name);
  };
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
  $('#nf_add', b).addEventListener('click', add);
  $('#nf_name', b).addEventListener('keydown', e => { if(e.key === 'Enter') add(); });   /* 桌面端回车即添加 */
}

/* 库内判重口径（添加 / 编辑共用）：按 name 比对，两侧都 trim（存量条目可能带多余空白）。
 * exceptId 用于编辑时排掉自己；一处实现，免得两条入口各自漂移。 */
function foodDupInMine(name, exceptId){
  const nm = String(name == null ? '' : name).trim();
  return USERS.shared.foods.some(x => x.id !== exceptId && String(x.name == null ? '' : x.name).trim() === nm);
}
/* 编辑我的库里的食物（行内 ✏️）：名称与四项营养都能改。同名（除自己）仍拒绝——
 * 库内条目一律按 name 比对（挑入/「已有」判断都走 name）。 */
/* 编辑保存的口径（纯函数，便于测试）：名称必填、不得与库里其他条目重名（库内比对一律走 name），
 * 通过后写回名称/营养，并且来源一律改记「用户」。返回 '' 表示已写入，'name' / 'dup' 为拒绝原因。
 * 四项都留空且原本就没有营养表 → 保持「无营养表」（不写成 0 冒充）。 */
function applyFoodEdit(f, name, per){
  const nm = String(name == null ? '' : name).trim();
  if(!nm) return 'name';
  if(foodDupInMine(nm, f.id)) return 'dup';
  const raw = k => String((per && per[k]) == null ? '' : per[k]).trim();
  const blank = ['kcal', 'p', 'c', 'f'].every(k => raw(k) === '');
  f.name = nm;
  if(blank && !f.per100) delete f.per100;
  else f.per100 = { kcal:num(per && per.kcal), p:num(per && per.p), c:num(per && per.c), f:num(per && per.f) };
  f.src = FOOD_SRC_USER;   /* 改过的条目不再是原样挑进来的那份（USDA） */
  return '';
}
function openFoodEditor(f, after){
  const per = safePer100(f.per100);
  const v = k => f.per100 ? String(per[k]) : '';   /* 无营养表的旧条目留空，不冒充 0 */
  const dlg = showDialog('编辑食物',
    '<div class="field"><label>食物名称</label><input class="input" id="ef_name" value="' + esc(f.name) + '"></div>' +
    '<div class="form-grid">' +
      '<div><label>热量 kcal / 100g</label><input class="input" id="ef_kcal" type="number" min="0" inputmode="decimal" value="' + v('kcal') + '"></div>' +
      '<div><label>蛋白质 g / 100g</label><input class="input" id="ef_p" type="number" min="0" inputmode="decimal" value="' + v('p') + '"></div>' +
      '<div><label>碳水 g / 100g</label><input class="input" id="ef_c" type="number" min="0" inputmode="decimal" value="' + v('c') + '"></div>' +
      '<div><label>脂肪 g / 100g</label><input class="input" id="ef_f" type="number" min="0" inputmode="decimal" value="' + v('f') + '"></div>' +
    '</div>' +
    '<div class="tiny muted" style="margin-top:10px">留空按 0 记；与库里其他食物重名会被拒绝。</div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="ef_save">保存</button></div>');
  const b = dlg.box;
  const saveEdit = () => {
    const err = applyFoodEdit(f, $('#ef_name', b).value,
      { kcal: $('#ef_kcal', b).value, p: $('#ef_p', b).value, c: $('#ef_c', b).value, f: $('#ef_f', b).value });
    if(err){ toast(err === 'dup' ? '该食物已存在' : '请填名称', true); return; }
    save(); closeDialog(); if(after) after(); toast('已保存：' + f.name);
  };
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
  $('#ef_save', b).addEventListener('click', saveEdit);
  $('#ef_name', b).addEventListener('keydown', e => { if(e.key === 'Enter') saveEdit(); });
}

/* =====================================================
   训练模块
===================================================== */
/* 周视图：一周七张日卡，卡内逐项打勾（勾过的行变暗、圆钮变实心）。
 * 不再分「计划 / 记录」两档——同一条数据上既有计划量又有完成进度，一眼看清。
 * 动作库已移至「设置 → 数据管理」弹窗入口。 */
function exRowHTML(w, it, showPR){
  const done = itemDone(it);
  const pr = showPR && done ? isPRItem(it, w.date) : { wPR:false };
  return '<div class="lrow"' + (done ? ' style="opacity:.6"' : '') + '>' +
    '<button class="hab-dot ' + (done ? 'on' : '') + '" data-itemdone="' + esc(w.id) + '" data-item="' + esc(it.id) + '" title="' + (done ? '取消完成' : '打勾完成') + '">✓</button>' +
    '<div class="grow"><div class="b">' + esc(it.exName) + '</div>' +
    (itemSub(it) ? '<div class="sub">' + esc(itemSub(it)) + '</div>' : '') + '</div>' +
    (pr.wPR ? '<span style="color:var(--cat3)" title="最大重量纪录">🏆</span>' : '') +
    '<div class="tiny" style="white-space:nowrap">' + esc(fmtItem(it)) + '</div>' +
    '<button class="iconbtn2" data-itemedit="' + esc(w.date) + '" data-item="' + esc(it.id) + '" title="修改">✏️</button></div>';
}
/* 行内两件事：打卡圆钮（本项直接生效）+ 逐项修改（删除在编辑弹窗里，行尾不再放 🗑） */
function bindItemChecks(root){
  $$('[data-itemdone]', root).forEach(b => b.addEventListener('click', () => toggleItemDone(b.dataset.itemdone, b.dataset.item)));
  $$('[data-itemedit]', root).forEach(b => b.addEventListener('click', () => openItemDlg(b.dataset.itemedit, b.dataset.item)));
}

/* 周视图：顶部一张周汇总卡（周导航 + 进度条 + 汇总 chips），下面每天一张全宽卡竖排——
 * 版式对齐饮食页的「顶部日导航卡 + 餐次卡」。可整周前后翻。
 * 数据仍是「一天一条 workouts」——这里只换呈现：有安排的天渲染项与打卡，
 * 空白的天给一个「＋ 安排运动」直接给那天加计划（页头不再另放全局按钮），看历史靠切周。 */
let trainMonday = null;                                  /* 当前展示周的周一；null = 跟随本周 */
function thisMonday(){ return mondayOf(today()); }
function trainWeek(){ return trainMonday || thisMonday(); }
function setTrainWeek(monday){ trainMonday = monday; renderTrain(); }   /* 周切换唯一入口（按钮与测试共用） */
function weekOffset(mon){ return Math.round((parseISO(mon) - parseISO(thisMonday())) / 604800000); }
function weekLabel(mon){
  const k = weekOffset(mon);
  return k === 0 ? '本周' : k === -1 ? '上周' : k === 1 ? '下周' : (k < 0 ? -k + ' 周前' : k + ' 周后');
}

function renderTrain(){
  const mon = trainWeek(), sun = addDays(mon, 6);
  /* 周汇总：打勾过的天才算「已运动」，容量/时长/距离只累加已打勾项 */
  let days = 0, vol = 0, mins = 0, km = 0;
  for(let i = 0; i < 7; i++){
    const w = workoutForDate(addDays(mon, i));
    if(!w) continue;
    if(isDone(w)) days++;
    vol += wkVolume(w); mins += wkMinutes(w); km += wkDistance(w);
  }
  const pct = Math.round(days / 7 * 100);
  /* 版式对齐饮食页：顶部一张「周导航 + 进度条 + 汇总 chips」的卡，下面每天一张全宽卡竖排 */
  $('#view').innerHTML =
    '<div class="card"><div class="row" style="justify-content:center;align-items:center">' +
      '<div class="daynav">' +
        '<button class="iconbtn2" id="tr_prev" title="上一周">‹</button>' +
        '<div class="lbl">' + dateCN(mon) + ' – ' + dateCN(sun) + '<small>' + weekLabel(mon) + '</small></div>' +
        '<button class="iconbtn2" id="tr_next" title="下一周">›</button>' +
        (weekOffset(mon) !== 0 ? '<button class="btn sm" id="tr_now">回到本周</button>' : '') +
      '</div>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;margin:12px 0 6px" class="small"><span class="muted">本周运动</span><b>已运动 ' + days + '/7 天</b></div>' +
    '<div class="meter"><i style="width:' + clamp(pct,0,100) + '%"></i></div>' +
    '<div class="row gap8" style="margin-top:10px">' +
      '<span class="chip b1">容量 ' + Math.round(vol) + ' kg</span>' +
      '<span class="chip b2">时长 ' + Math.round(mins) + ' 分钟</span>' +
      (km > 0 ? '<span class="chip b3">距离 ' + round(km, 1) + ' km</span>' : '') +
    '</div></div><div id="tabBody"></div>';
  $('#tr_prev', $('#view')).addEventListener('click', () => setTrainWeek(addDays(mon, -7)));
  $('#tr_next', $('#view')).addEventListener('click', () => setTrainWeek(addDays(mon, 7)));
  const nowBtn = $('#tr_now', $('#view'));
  if(nowBtn) nowBtn.addEventListener('click', () => setTrainWeek(null));
  renderWorkoutWeek($('#tabBody'), mon);
}

/* ---------- 周网格：7 张日卡 ---------- */
function renderWorkoutWeek(body, mon){
  const t = today();
  let html = '';
  for(let i = 0; i < 7; i++){
    const d = addDays(mon, i);
    html += dayCardHTML(d, workoutForDate(d), t);
  }
  body.innerHTML = html;
  bindItemChecks(body);
  $$('[data-additem]', body).forEach(b => b.addEventListener('click', () => openItemDlg(b.dataset.additem)));
}

/* ---------- 日卡（版式对齐饮食页的餐次卡：卡头一行搞定标题/进度/操作） ---------- */
/* 还没开始的那天显示「计划量」，已开始的显示「实际完成量」（只算打勾项） */
function dayVolumeText(w){
  const started = doneCount(w) > 0;
  const vol = started ? wkVolume(w) : planVolume(w);
  const mins = started ? wkMinutes(w) : planMinutes(w);
  const bits = [];
  if(vol > 0) bits.push((started ? '' : '计划 ') + '容量 ' + Math.round(vol) + ' kg');
  if(mins > 0) bits.push('时长 ' + Math.round(mins) + ' 分钟');
  return bits.join(' · ');
}
function dayCardHTML(date, w, todayStr){
  const isToday = date === todayStr;
  const past = date < todayStr;
  const tot = w ? w.items.length : 0, dn = w ? doneCount(w) : 0, all = w ? allDone(w) : false;
  const missed = tot > 0 && dn === 0 && past;             /* 排了却一项没勾的过去那天 */
  const meta = w ? dayVolumeText(w) : '';
  return '<div class="card' + (isToday ? ' today' : '') + '" data-daycard="' + esc(date) + '"' +
      (w ? ' data-wk="' + esc(w.id) + '"' : '') + ' style="margin-bottom:12px">' +
    '<h3><span>周' + DAY_CN[weekday(date)] + ' ' + dateCN(date) + '</span>' +
      (isToday ? '<span class="chip ok">今天</span>' : '') +
      (tot ? '<span class="chip' + (all ? ' ok' : '') + '">' + dn + '/' + tot + '</span>' : '') +
      (missed ? '<span class="chip" style="color:var(--danger);border-color:var(--danger)">未完成</span>' : '') +
      '<span class="grow"></span>' +
      '<button class="btn sm" data-additem="' + esc(date) + '">＋ 添加运动</button>' +
    '</h3>' +
    (meta ? '<div class="tiny" style="margin:-6px 0 6px">' + esc(meta) + '</div>' : '') +
    (!w
      ? '<div class="empty" style="padding:10px"><div class="e-ic" style="font-size:22px">' + (past ? '😴' : '🗓') + '</div>' + (past ? '休息日' : '未安排') + '</div>'
      : (tot ? w.items.map(it => exRowHTML(w, it, true)).join('')
             : '<div class="empty" style="padding:10px">这天还没有动作<br><span class="tiny">点「＋ 添加运动」加一项</span></div>')) +
    '</div>';
}


/* 排序口径：大类 → 部位 → 名称（中文）。比较器单列出来：库页「系统分页」要在带上原索引的
 * 数组上排序（好按索引挑入），不能直接用 exLibSort 的返回形状。 */
function exLibCmp(a, b){
  const ca = CAT_RANK[a.cat], cb = CAT_RANK[b.cat];
  const ma = MUSCLE_RANK[a.muscle], mb = MUSCLE_RANK[b.muscle];
  return (ca === undefined ? 99 : ca) - (cb === undefined ? 99 : cb)
      || (ma === undefined ? 99 : ma) - (mb === undefined ? 99 : mb)
      || String(a.name).localeCompare(String(b.name), 'zh');
}
function exLibSort(arr){ return arr.slice().sort(exLibCmp); }

/* ---------- 运动项形状辅助（单项编辑弹窗与清洗共用） ----------
 * v4.11：一次记录 = 一条汇总。力量 = 总次数 + 重量（**可选**，不填就是空键、不显示「自重」）；计时 = 总时长(分钟) + 距离 km(可选)。
 * 空输入一律删键（服务端 NULL↔缺键保真，空值不能落成 0）；
 * _mode 是编辑期提示（形态由库条目的 mode 设定），入库前由 collectItems 剥掉。 */
function setItemField(it, k, v){ const n = num(v); if(n > 0) it[k] = n; else delete it[k]; }   /* 空/0/负数/NaN 一律删键（服务端 NULL↔缺键保真） */
/* 行形态切换时清掉另一种形态的残留，否则会存出"既有次数又有分钟"的混合项 */
function setItemMode(m, mode){
  m._mode = mode;
  if(mode === 'time'){ delete m.reps; delete m.weight; } else { delete m.mins; delete m.km; }
}
/* 内存模型 → 库形状：剥 _mode、丢空项、只留填了数的键 */
function collectItems(model, needEx){
  const out = [];
  model.forEach(m => {
    const it = { exName: m.exName };
    if(m.exId) it.exId = m.exId;
    if(m.cat) it.cat = m.cat;
    if(m.muscle) it.muscle = m.muscle;
    if(m.done) it.done = true;                       /* v4.12：完成状态在项上，编辑时不能丢 */
    ['reps', 'weight', 'mins', 'km'].forEach(k => { if(m[k]) it[k] = num(m[k]); });
    if(!it.exName) return;
    if(!(it.reps || it.mins || it.km)) return;
    if(needEx && !it.exId) return;
    out.push(it);
  });
  return out;
}


/* ---------- 逐项弹窗：添加 / 修改一个运动项 ----------
 * 添加态分三 tab：我的库 / 系统库 / 新增（v4.16；与「记录饮食」同一套交互，用户裁定 2026-09-12）——
 * 动作名与「计次 / 计时」方式都来自选中条目或新增表单，用户不能自造方式。从系统库选 / 新增的动作
 * 在保存时由 ensureExId() 并入我的动作库（不给「同时保存」勾选框，弹窗里只写一句说明）。
 * 修改态收敛成「只改数值 + 删除」（与 editMealDialog 一致）——要换动作就删掉重加。
 * 那天的容器按需创建，删空后由 delItem 回收；完成状态不在弹窗里改（行首圆钮就地勾）。 */

/* 库条目三件套兜底：缺字段的存量条目按大类默认值补齐（别让形态落到 undefined / 非法 mode） */
function exTriple(e){
  const cat = CATS.indexOf(e.cat) >= 0 ? e.cat : '其他';
  return { cat:cat,
    muscle: MUSCLES.indexOf(e.muscle) >= 0 ? e.muscle : defaultMuscle(cat),
    mode: MODES.indexOf(e.mode) >= 0 ? e.mode : defaultMode(cat) };
}
/* 添加运动弹窗三面板共用的取数（纯函数，便于测试）：我的库/系统库选中条目、或「新增」表单，
 * 统一成 { name, cat, muscle, mode }（我的库还带 exId）。没选 / 没填名 → null。 */
function itPickOf(tab, selMine, selSys, form){
  const src = tab === 'mine' ? selMine : (tab === 'sys' ? selSys : (form && form.name ? form : null));
  const name = src && src.name ? String(src.name).trim() : '';
  if(!name) return null;
  const t = exTriple(src);
  const pick = { name:name, cat:t.cat, muscle:t.muscle, mode:t.mode };
  if(tab === 'mine' && src.id) pick.exId = src.id;
  return pick;
}
/* 「已有」提示行（与 mealOwnedTipHTML 同口径）：只说本次不入库、不改库里那份，不写操作指引 */
function exOwnedTipHTML(name){ return '<span class="chip b3">已有</span> 我的动作库里已有「' + esc(name) + '」，本次只记这一次运动，不会改库里那份的大类/部位/方式。'; }

function ensureExId(it){
  if(it.exId) return;
  const ex = state.exercises.find(e => e.name === it.exName);
  if(ex){ it.exId = ex.id; if(ex.cat) it.cat = ex.cat; if(ex.muscle) it.muscle = ex.muscle; return; }
  const nid = uid();
  const ne = { id:nid, name:it.exName, cat:it.cat || '其他', muscle:it.muscle || ((it.cat || '其他') === '力量' ? '其他' : '全身'), mode:itemMode(it) };
  state.exercises.push(ne);
  it.exId = nid; it.cat = ne.cat; it.muscle = ne.muscle;
}
const QUICK_MINS = [15, 20, 30, 45, 60];   /* 计时项时长的下拉预设（20 分 = 默认值，datalist 挂在输入框上） */
const DEFAULT_MINS = 20, DEFAULT_REPS = 30;   /* 添加时的起步值：计时 20 分钟 / 计次 30 次（用户裁定 2026-09-11） */
/* 按方式补起步值：只补空缺，不覆盖用户或旧数据里已有的值 */
function defaultForMode(m){
  if(m._mode === 'time' && !m.mins) m.mins = DEFAULT_MINS;
  if(m._mode === 'reps' && !m.reps) m.reps = DEFAULT_REPS;
  return m;
}
let itTab = 'mine';   /* 弹窗内当前分页：每次打开都落「我的库」（不做跨次记忆，与记录饮食一致） */
function openItemDlg(date, itemId){
  const w = workoutForDate(date);
  const src = itemId && w ? w.items.find(x => x.id === itemId) : null;
  const editing = !!src;
  /* 编辑期模型：_mode 由库条目的 mode（或旧数据的字段）决定，入库前由 collectItems 剥掉；
   * done 原样带着，改数值不会丢完成 */
  const m = { exId:'', exName:'', cat:'', muscle:'', _mode:'reps' };
  if(src){
    ['exId','exName','cat','muscle'].forEach(k => { if(src[k]) m[k] = src[k]; });
    m._mode = itemMode(src);
    ['reps','weight','mins','km'].forEach(k => { if(src[k]) m[k] = src[k]; });
    if(src.done) m.done = true;
  }
  itTab = 'mine';
  let itQuery = '';          /* 库分页共用搜索词（切分页清空） */
  let sysExs = null;         /* 本次弹窗拉到的系统库；false = 拉失败（不缓存，切分页再试） */
  let selMine = null, selSys = null;
  const html =
    '<div class="row gap8" style="margin-bottom:10px"><span class="chip">' + dateCNW(date) + '</span>' +
      '<span class="chip slot">' + (editing ? '修改这一项' : '新增一项') + '</span></div>' +
    (editing ? '' :
      '<div class="seg" id="it_seg" style="display:flex;width:100%;margin-bottom:12px">' +
        '<button type="button" data-ittab="mine" style="flex:1">我的库</button>' +
        '<button type="button" data-ittab="sys" style="flex:1">系统库</button>' +
        '<button type="button" data-ittab="new" style="flex:1">新增</button>' +
      '</div>' +
      '<div id="it_p_mine"><div class="field" style="margin-bottom:8px"><label>搜索并选择</label>' +
        '<input class="input" id="it_q" type="search" placeholder="搜索动作名…">' +
        '<div class="picklist" id="it_mylist"></div></div></div>' +
      '<div id="it_p_sys" style="display:none"><div class="field" style="margin-bottom:8px"><label>搜索并选择系统库动作</label>' +
        '<input class="input" id="it_qs" type="search" placeholder="搜索动作名…">' +
        '<div class="picklist" id="it_syslist"></div></div></div>' +
      '<div id="it_p_new" style="display:none"><div class="form-grid" style="margin-bottom:8px">' +
        '<div class="span2"><label>动作名称</label><input class="input" id="it_new_name" placeholder="如：窄距俯卧撑"></div>' +
        '<div><label>大类</label><select class="select" id="it_new_cat">' + CATS.map(c => '<option>' + c + '</option>').join('') + '</select></div>' +
        '<div><label>部位</label><select class="select" id="it_new_muscle">' + MUSCLES.map(x => '<option>' + x + '</option>').join('') + '</select></div>' +
        '<div><label>记录方式</label><select class="select" id="it_new_mode">' + MODES.map(x => '<option value="' + x + '">' + MODE_CN[x] + '</option>').join('') + '</select></div>' +
      '</div>' +
      '<div class="tiny muted" style="margin-bottom:8px">换大类会自动带出默认部位与记录方式，仍可手改；系统库与新增的动作保存后会自动加入我的动作库。</div></div>' +
      '<div class="tiny" id="it_owned" style="display:none;margin-bottom:8px"></div>') +
    '<div id="it_body"></div>' +
    '<div class="tiny muted" id="it_prev" style="margin-top:8px;min-height:18px"></div>' +
    '<div class="d-f">' +
      (editing ? '<button class="btn danger ghost" id="it_del">删除这一项</button>' : '') +
      '<button class="btn ghost" data-cancel>取消</button>' +
      '<button class="btn primary" id="it_save">' + (editing ? '保存' : '添加') + '</button></div>';
  const dlg = showDialog(editing ? '修改运动' : '添加运动', html);
  const b = dlg.box;
  const bodyBox = $('#it_body', b);
  function bodyHTML(){
    const picked = !!m.exName;
    const head = '<div class="row gap8" style="align-items:center">' +
        '<span class="b">' + (picked ? esc(m.exName) : '还没选动作') + '</span>' +
        (picked ? '<span class="chip">' + (m._mode === 'time' ? '⏱ ' : '🔢 ') + esc(MODE_CN[m._mode] || '计次') + '</span>'
                : '<span class="tiny muted">从上面的分页里选一个</span>') +
      '</div>' +
      (picked && itemSub(m) ? '<div class="tiny muted" style="margin-top:6px">' + esc(itemSub(m)) + ' · 方式随动作自动设定</div>' : '');
    if(!picked) return '<div class="field">' + head + '</div><div class="tiny muted">先从动作库选一个动作，或在「新增」里填一个。</div>';
    if(m._mode === 'time'){
      /* 时长的常用值 = 输入框右侧自绘下拉（不用原生 datalist：各浏览器对 list/autocomplete 的支持
       * 差别大，用户反馈点开没有可选项）。点 ▾ 或输入框右侧打开，选一项填进框，也可以直接敲数字/小数 */
      return '<div class="field">' + head + '</div><div class="form-grid">' +
        '<div><label>总时长（分钟）</label>' +
          '<div class="mins-wrap">' +
            '<input class="input" id="it_mins" type="text" inputmode="decimal" autocomplete="off" value="' + (m.mins || '') + '" placeholder="如 20" style="padding-right:36px">' +
            '<button type="button" class="mins-toggle" id="it_mins_btn" title="常用时长" aria-label="常用时长">▾</button>' +
            '<div class="mins-menu" id="it_mins_menu">' + QUICK_MINS.map(v =>
              '<button type="button" data-min="' + v + '">' + v + ' 分钟</button>').join('') + '</div>' +
          '</div>' +
        '</div>' +
        '<div><label>距离 km（可选）</label><input class="input" id="it_km" type="number" min="0" step="0.1" value="' + (m.km || '') + '" placeholder="如 5"></div></div>';
    }
    return '<div class="field">' + head + '</div><div class="form-grid">' +
      '<div><label>总次数</label><input class="input" id="it_reps" type="number" min="0" value="' + (m.reps || '') + '" placeholder="如 32"></div>' +
      '<div><label>重量 kg（可选，不填就留空）</label><input class="input" id="it_w" type="number" min="0" step="0.5" value="' + (m.weight || '') + '" placeholder="如 70"></div></div>';
  }
  /* 输入 → 模型：空 / 0 / 负数一律删键（与服务端 NULL↔缺键保真一致）——重量不填就是空，不会落成 0 */
  function syncModel(){
    const reps = $('#it_reps', b), wt = $('#it_w', b), mins = $('#it_mins', b), km = $('#it_km', b);
    if(reps) setItemField(m, 'reps', reps.value);
    if(wt) setItemField(m, 'weight', wt.value);
    if(mins) setItemField(m, 'mins', mins.value);
    if(km) setItemField(m, 'km', km.value);
  }
  function paintPrev(){
    if(!m.exName){ $('#it_prev', b).innerHTML = ''; return; }
    const sub = itemSub(m), vol = itemVolume(m);
    $('#it_prev', b).innerHTML = '合计：' + esc(fmtItem(m)) + (sub ? ' · ' + esc(sub) : '') + (vol > 0 ? ' · 容量 ' + Math.round(vol) + ' kg' : '');
  }
  function updatePrev(){ syncModel(); paintPrev(); }
  let curMenu = null;                       /* 当前渲染出的常用时长菜单（每次重绘都换新节点） */
  function closeMinsMenu(){ if(curMenu) curMenu.classList.remove('open'); }
  b.addEventListener('click', closeMinsMenu);   /* 只在弹窗上挂一次：点别处收起；选项的 handler 先跑再冒泡到这里 */
  function bindFields(){
    ['it_reps', 'it_w', 'it_mins', 'it_km'].forEach(id => {
      const el = $('#' + id, b); if(el) el.addEventListener('input', updatePrev);
    });
    curMenu = $('#it_mins_menu', bodyBox) || null;
    const minsToggle = $('#it_mins_btn', bodyBox);
    if(minsToggle && curMenu){
      minsToggle.addEventListener('click', e => { e.stopPropagation(); curMenu.classList.toggle('open'); });
      $$('button', curMenu).forEach(opt => opt.addEventListener('click', () => {
        syncModel();
        m.mins = num(opt.dataset.min);
        const inp = $('#it_mins', b);
        if(inp){ inp.value = m.mins; inp.focus(); }
        closeMinsMenu(); paintPrev();
      }));
    }
  }
  function paintFields(){ bodyBox.innerHTML = bodyHTML(); bindFields(); paintPrev(); }
  /* 「新增」tab 的表单 → 候选（名称 + 三件套；换大类由下方 bindNewForm 带出默认值） */
  function readNew(){
    const val = id => { const el = $('#' + id, b); return el ? el.value : ''; };
    return { name: val('it_new_name').trim(), cat: val('it_new_cat'), muscle: val('it_new_muscle'), mode: val('it_new_mode') };
  }
  /* 面板选择 → 编辑期模型（三面板共用）：先落地已填数值免得重绘丢掉，再写名称/三件套/方式并补起步值。
   * 传 null（切分页）时连数值一起清：不做跨分页记忆，免得上一页填的 30 次惄惄带到下一条动作上 */
  function applyPick(pick){
    syncModel();
    if(!pick){
      delete m.exId; m.exName = ''; delete m.cat; delete m.muscle;
      ['reps', 'weight', 'mins', 'km'].forEach(k => { delete m[k]; });
      paintFields(); return;
    }
    if(pick.exId) m.exId = pick.exId; else delete m.exId;
    m.exName = pick.name; m.cat = pick.cat; m.muscle = pick.muscle;
    setItemMode(m, pick.mode === 'time' ? 'time' : 'reps');   /* 方式随动作自动设定，用户不选 */
    defaultForMode(m);                                        /* 起步值：计时 20 分钟 / 计次 30 次 */
    paintFields();
  }
  function pickRowHTML(ex, attr, selected, badge){
    const t = exTriple(ex);
    return '<button type="button" class="pickrow' + (selected ? ' on' : '') + '" ' + attr + '>' +
      '<span class="grow">' + esc(ex.name) + (badge || '') + '</span>' +
      '<span class="tiny muted">' + esc([t.cat, t.muscle, MODE_CN[t.mode]].join(' · ')) + '</span></button>';
  }
  function moreHint(total){ return total > PICK_LIMIT
    ? '<div class="tiny muted" style="padding:6px 12px">还有 ' + (total - PICK_LIMIT) + ' 条，输入关键字继续筛选</div>' : ''; }
  function renderMine(){
    const q = itQuery.trim().toLowerCase();
    let h;
    if(!state.exercises.length){
      h = '<div class="tiny muted" style="padding:12px">我的动作库是空的，切到「系统库」挑一个，或在「新增」手填。</div>';
    } else {
      const hits = q ? state.exercises.filter(e => String(e.name).toLowerCase().indexOf(q) >= 0) : exLibSort(state.exercises);
      h = hits.length
        ? hits.slice(0, PICK_LIMIT).map(e => pickRowHTML(e, 'data-mypick="' + esc(e.id) + '"', !!selMine && selMine.id === e.id)).join('') + moreHint(hits.length)
        : '<div class="tiny muted" style="padding:8px 12px">没有匹配「' + esc(q) + '」的动作</div>';
      if(hits.length && !q) h = '<div class="tiny muted" style="padding:6px 12px 2px">共 ' + state.exercises.length + ' 条，输入关键字筛选</div>' + h;
    }
    $('#it_mylist', b).innerHTML = h;
    $$('[data-mypick]', b).forEach(btn => btn.addEventListener('click', () => {
      selMine = state.exercises.find(e => e.id === btn.dataset.mypick) || null;
      selSys = null;
      applyPick(itPickOf('mine', selMine, null, null));
      renderMine(); paintOwned();
    }));
  }
  async function renderSys(){
    if(sysExs === null){
      $('#it_syslist', b).innerHTML = '<div class="tiny muted" style="padding:8px 12px">载入系统库…</div>';
      const lib = await fetchSysLib();
      sysExs = lib ? (lib.exercises || []) : false;
      if(!$('#it_syslist', b) || itTab !== 'sys') return;   /* 载入期间用户切走了 / 弹窗关了 */
    }
    if(sysExs === false){ $('#it_syslist', b).innerHTML = sysLibErrTipHTML(); return; }
    const q = itQuery.trim().toLowerCase();
    const all = sysExs.map((e, i) => ({ e, i })).filter(x => !q || String(x.e.name).toLowerCase().indexOf(q) >= 0);
    all.sort((x, y) => exLibCmp(x.e, y.e));
    let h;
    if(!all.length){
      h = '<div class="tiny muted" style="padding:8px 12px">' + (sysExs.length ? '没有匹配「' + esc(q) + '」的动作' : '系统库暂无动作') + '</div>';
    } else {
      h = '<div class="tiny muted" style="padding:6px 12px 2px">共 ' + all.length + ' 条；选中保存后会自动加入我的动作库，同名的标「已有」。</div>' +
        all.slice(0, PICK_LIMIT).map(x => pickRowHTML(x.e, 'data-syspick="' + x.i + '"', !!selSys && selSys.name === x.e.name,
          exDupInMine(x.e.name) ? '<span class="chip b3" style="margin-left:6px;padding:1px 7px;font-size:11px">已有</span>' : '')).join('') + moreHint(all.length);
    }
    $('#it_syslist', b).innerHTML = h;
    $$('[data-syspick]', b).forEach(btn => btn.addEventListener('click', () => {
      selSys = sysExs[num(btn.dataset.syspick)] || null;
      selMine = null;
      applyPick(itPickOf('sys', null, selSys, null));
      renderSys(); paintOwned();
    }));
  }
  function renderList(){ if(itTab === 'mine') renderMine(); else if(itTab === 'sys') renderSys(); }
  /* 「已有」提示（非「我的库」分页、且名字已在库里）：只说口径，不摆勾选框——运动项本就靠库条目落 exId */
  function paintOwned(){
    const el = $('#it_owned', b);
    if(!el) return;
    const pick = editing ? null : itPickOf(itTab, selMine, selSys, readNew());
    const own = itTab !== 'mine' && !!pick && exDupInMine(pick.name);
    el.style.display = own ? '' : 'none';
    el.innerHTML = own ? exOwnedTipHTML(pick.name) : '';
  }
  function switchTab(t){
    itTab = t; itQuery = '';
    const q = $('#it_q', b), qs = $('#it_qs', b);
    if(q) q.value = '';
    if(qs) q.value = '';
    selMine = null; selSys = null;
    applyPick(null);   /* 换分页清空已选动作（不做跨分页记忆，与记录饮食一致） */
    $$('#it_seg [data-ittab]', b).forEach(btn => btn.classList.toggle('active', btn.dataset.ittab === itTab));
    ['mine', 'sys', 'new'].forEach(k => { const p = $('#it_p_' + k, b); if(p) p.style.display = (k === itTab ? '' : 'none'); });
    renderList(); paintOwned();
  }
  /* 「新增」tab：换大类带出默认部位/方式；名称与三件套任一变化都重算候选（数值区与合计跟着走） */
  function bindNewForm(){
    const catSel = $('#it_new_cat', b), musSel = $('#it_new_muscle', b), modSel = $('#it_new_mode', b), nameEl = $('#it_new_name', b);
    if(!catSel || !nameEl) return;
    const syncDefaults = () => { musSel.value = defaultMuscle(catSel.value); modSel.value = defaultMode(catSel.value); };
    syncDefaults();
    catSel.addEventListener('change', () => { syncDefaults(); applyPick(itPickOf('new', null, null, readNew())); paintOwned(); });
    [nameEl, musSel, modSel].forEach(el => el.addEventListener('input', () => { applyPick(itPickOf('new', null, null, readNew())); paintOwned(); }));
  }
  /* 库分页搜索 + 三 tab 切换：仅添加态；修改态收敛成「只改数值 + 删除」（不再有更换动作入口） */
  if(!editing){
    const q = $('#it_q', b), qs = $('#it_qs', b);
    if(q) q.addEventListener('input', e => { itQuery = e.target.value; renderMine(); });
    if(qs) qs.addEventListener('input', e => { itQuery = e.target.value; renderSys(); });
    $$('#it_seg [data-ittab]', b).forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.ittab)));
    bindNewForm();
    invalidateSysLib();   /* v4.4 口径：每次打开弹窗失效一次，管理员的改动进弹窗即新 */
    switchTab('mine');    /* 默认落「我的库」并画出首屏列表/数值区 */
  } else {
    paintFields();
  }
  $('#it_save', b).addEventListener('click', () => {
    syncModel();
    if(!editing){
      /* 添加态：以当前分页选中的那条为准写进模型（名称/三件套/方式）；
       * exId 缺省时由 ensureExId() 按名称并入我的动作库（系统库/新增同理） */
      const pick = itPickOf(itTab, selMine, selSys, readNew());
      if(!pick){ toast(itTab === 'new' ? '请填写动作名称' : '请先从动作库选择动作', true); return; }
      if(pick.exId) m.exId = pick.exId; else delete m.exId;
      m.exName = pick.name; m.cat = pick.cat; m.muscle = pick.muscle;
      setItemMode(m, pick.mode === 'time' ? 'time' : 'reps');
    }
    if(!m.exName){ toast('请先从动作库选择动作', true); return; }
    const it = collectItems([m], false)[0];
    if(!it){ toast('请填写数值', true); return; }
    ensureExId(it);                       /* 兜底：旧数据里不在库中的动作名，保存时并入我的库 */
    let day = workoutForDate(date);
    if(!day){ day = { id:uid(), date, name:'', items:[] }; state.workouts.push(day); }
    if(editing){
      const i = day.items.findIndex(x => x.id === itemId);
      if(i >= 0) day.items[i] = Object.assign({ id:itemId }, it);   /* 原地替换：保 done、位置不变 */
      else day.items.push(Object.assign({ id:uid() }, it));
    } else day.items.push(Object.assign({ id:uid() }, it));
    trainMonday = mondayOf(date);        /* 存完把周视图定到那天所在周（从首页弹窗进来也不会跳错页） */
    save(); closeDialog(); renderView(); toast(editing ? '已修改' : '已添加');
  });
  const delBtn = $('#it_del', b);
  if(delBtn) delBtn.addEventListener('click', () => { closeDialog(); delItem(date, itemId); });
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
}

/* 动作库行内 = 名称 + 「大类 · 部位 · 方式」小字一行（与食物库的 lrow 同一版式，不再用表格）。 */
function exLibRowHTML(e, dataAttr, actionHTML){
  const sub = [e.cat, e.muscle, MODE_CN[e.mode]].filter(Boolean).join(' · ') || '—';
  return '<div class="lrow" ' + dataAttr + '><div class="grow"><div class="b">' + esc(e.name) + '</div>' +
    '<div class="sub">' + esc(sub) + '</div></div>' + (actionHTML || '') + '</div>';
}

/* ---------- 动作库（设置页 → 💾 数据管理 → 本页）：我的库（可增删改）| 系统库（只读 + 挑入我的库） ----------
 * v4.15：由弹窗改为独立页面——页头第一行是「返回 + 数据管理-动作库」。
 * 与食物库同一套交互（v4.16，用户裁定 2026-09-12）：两个分页共用名称搜索、20 条/页分页、tab 带条数，
 * 「我的库」每行 ✏️ 单项编辑；异步回来前一律过 alive()（代次 + #xl_body 是否还在）。 */
let exLibTab = 'mine';     /* 页面级状态：切到系统库后再进来仍停在原分页 */
let exLibQuery = '';       /* 搜索词：两个分页共用，切分页保留 */
let exLibPage = 1;         /* 当前页码：换搜索词/切分页时回到第 1 页 */
let exLibSysCount = null;  /* 本次进页拉到的系统库条数（tab 上显示）；未拉到就只写「系统动作库」 */
let exLibGen = 0;          /* 页面代次：系统库异步回来时若已切走页面，就别再碰旧 DOM */
const EX_PAGE_SIZE = 20;   /* 与食物库同口径：移动端一屏能扫完的行数 */
function renderExLibPage(){
  invalidateSysLib();   /* v4.4:每次进页拉一次系统库即可,页内切分页不再重下 */
  const gen = ++exLibGen;
  exLibSysCount = null;
  $('#view').innerHTML =
    '<div class="pagehead"><button class="iconbtn2" id="xl_back" title="返回设置">‹</button><div class="ph-t">数据管理-动作库</div></div>' +
    '<div class="card">' +
      '<div class="row" style="margin-bottom:10px"><div class="seg" id="xl_seg"></div></div>' +
      '<div class="field" style="margin:0 0 4px"><input class="input" id="xl_search" type="search" placeholder="搜索动作名称…" value="' + esc(exLibQuery) + '"></div>' +
      '<div id="xl_body"><div class="tiny muted">载入中…</div></div>' +
    '</div>';
  $('#xl_back').addEventListener('click', () => go('settings'));
  const b = $('#view');
  let tab = exLibTab;
  let sysCache = null;   /* 本次进页拉到的系统库：切分页/改搜索词不再重下 */
  let sysReady = null;   /* 进页那次拉取（tab 条数与系统库分页共用同一份）；失败置回 null 以便重试 */
  const alive = () => gen === exLibGen && !!$('#xl_body', b);
  const loadSys = () => (sysReady = sysReady || fetchSysLib());
  /* 进页就把系统库拉回来：tab 上要显示它的条数（与食物库同口径），切到系统库分页时也复用它 */
  loadSys().then(sys => {
    if(!alive()) return;   /* 页面已切走：不碰旧 DOM */
    if(!sys){ sysReady = null; return; }   /* 离线/失败：tab 数字留空（不写 0），切分页时重试 */
    exLibSysCount = (sys.exercises || []).length;
    paintSeg();
  });
  $('#xl_search', b).addEventListener('input', e => { exLibQuery = e.target.value; exLibPage = 1; render(); });
  function pageSlice(arr){
    exLibPage = libClampPage(exLibPage, EX_PAGE_SIZE, arr.length);
    const start = (exLibPage - 1) * EX_PAGE_SIZE;
    return arr.slice(start, start + EX_PAGE_SIZE);
  }
  function paintSeg(){
    const seg = $('#xl_seg', b);
    if(!seg) return;   /* 页面已切走（换页会清 #view）：别往旧 DOM 上写 */
    seg.innerHTML =
      '<button data-xlt="mine" class="' + (tab==='mine'?'active':'') + '">我的动作库（' + state.exercises.length + '）</button>' +
      '<button data-xlt="sys" class="' + (tab==='sys'?'active':'') + '">系统动作库' +
        (exLibSysCount === null ? '' : '（' + exLibSysCount + '）') + '</button>';
    $$('#xl_seg [data-xlt]', b).forEach(btn => btn.addEventListener('click', () => { tab = exLibTab = btn.dataset.xlt; exLibPage = 1; paintSeg(); render(); }));
  }
  function bindPager(){
    $$('[data-fpage]', b).forEach(btn => btn.addEventListener('click', () => {
      exLibPage += (btn.dataset.fpage === 'next' ? 1 : -1);
      render();
    }));
  }
  function renderMine(){
    const hits = exLibSort(state.exercises.filter(e => libMatchName(exLibQuery, e.name)));
    const rows = pageSlice(hits).map(e =>
      exLibRowHTML(e, 'data-id="' + esc(e.id) + '"',
        '<button class="iconbtn2" data-editx="' + esc(e.id) + '" title="修改">✏️</button>' +
        '<button class="iconbtn2" data-delx="' + esc(e.id) + '" title="删除" style="color:var(--danger)">🗑</button>')).join('');
    /* 添加表单收进弹窗（卡头一颗「＋ 添加动作」），列表与计数留给页面 */
    $('#xl_body', b).innerHTML =
      '<h3><span>📚 我的动作库（' + state.exercises.length + '）</span><span class="grow"></span>' +
        '<button class="btn sm primary" id="nx_open">＋ 添加动作</button></h3>' +
      '<div class="tiny muted" style="margin-bottom:8px">运动中保存的新动作会自动进来；「系统动作库」分页可挑入管理员维护的公共动作。</div>' +
      (rows || (state.exercises.length
        ? '<div class="empty" style="padding:14px"><div class="e-ic" style="font-size:24px">🔍</div>没有匹配「' + esc(exLibQuery.trim()) + '」的动作</div>'
        : '<div class="empty" style="padding:14px"><div class="e-ic" style="font-size:24px">📚</div>我的动作库是空的，去「系统动作库」挑一些吧</div>')) +
      (hits.length ? libPagerHTML(exLibPage, EX_PAGE_SIZE, hits.length) : '');
    $('#nx_open', b).addEventListener('click', () => openExAdder(() => { paintSeg(); exLibPage = 1; renderMine(); }));
    $$('[data-editx]', b).forEach(btn => btn.addEventListener('click', () => {
      const e = state.exercises.find(x => x.id === btn.dataset.editx);
      if(e) openExEditor(e, () => { paintSeg(); renderMine(); });
    }));
    $$('[data-delx]', b).forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.delx;
      /* 注意:必须改 USERS.shared.exercises 本体(再重新取引用),只换 state.exercises 指向会同步不生效 */
      USERS.shared.exercises = USERS.shared.exercises.filter(e => e.id !== id);
      state.exercises = USERS.shared.exercises;
      save(); paintSeg(); renderMine();
    }));
    bindPager();
  }
  async function renderSys(){
    if(!sysCache){
      $('#xl_body', b).innerHTML = '<div class="tiny muted">载入系统库…</div>';
      sysCache = await loadSys();   /* 进页时已发起（见上），这里复用同一份，不再重下 */
      if(!alive()) return;   /* 载入期间用户离开了本页（换页 / 重进） */
      if(tab !== 'sys') return;   /* 载入期间用户切回了我的库 */
      if(!sysCache) sysReady = null;   /* 离线/失败：这次不缓存，下次切分页再试一次 */
    }
    if(!sysCache){ $('#xl_body', b).innerHTML = sysLibErrEmptyHTML(); return; }
    /* 已在我的库（同名）= 只读标记，与食物库系统分页同一口径；用 Set 一次建索引，避免逐行 O(n) 扫 */
    const sysEx = sysCache.exercises || [];
    const ownedNames = new Set(USERS.shared.exercises.map(x => x.name));
    const all = sysEx.map((e, i) => ({ e, i })).sort((x, y) => exLibCmp(x.e, y.e)).filter(x => libMatchName(exLibQuery, x.e.name));
    const rows = pageSlice(all).map(x => exLibRowHTML(x.e, 'data-sysx="' + x.i + '"',
      ownedNames.has(x.e.name)
        ? '<span class="chip b3" style="padding:2px 9px;font-size:12px">已有</span>'
        : '<button class="btn sm ghost" data-impex="' + x.i + '">＋我的库</button>')).join('');
    $('#xl_body', b).innerHTML =
      '<div class="tiny muted" style="margin-bottom:8px">系统共享库由管理员在后台维护，只读。点「＋我的库」把它挑进自己的动作库；与你库里同名的直接标「已有」。</div>' +
      (rows || '<div class="empty" style="padding:14px"><div class="e-ic" style="font-size:24px">' + (sysEx.length ? '🔍' : '🗂') + '</div>' +
        (sysEx.length ? '没有匹配「' + esc(exLibQuery.trim()) + '」的动作' : '系统库暂无动作') + '</div>') +
      (all.length ? libPagerHTML(exLibPage, EX_PAGE_SIZE, all.length) : '');
    $$('[data-impex]', b).forEach(btn => btn.addEventListener('click', () => {
      if(importExerciseFromSys(sysEx[num(btn.dataset.impex)])){ paintSeg(); render(); }
    }));
    bindPager();
  }
  function render(){ if(tab === 'mine') renderMine(); else renderSys(); }
  paintSeg(); render();   /* 按 tab 渲染：exLibTab 会被记住，再进页可能停在「系统库」 */
}
/* 添加动作弹窗（我的库）：名称必填；换大类即把 部位/记录方式 拨到该大类的默认值（仍可手改：核心+计时 = 平板支撑）。
 * 写入本人动作库后立即落库并关闭，after() 让页面列表与「我的动作库（n）」计数即时刷新。 */
function openExAdder(after){
  const dlg = showDialog('添加动作',
    '<div class="field"><label>动作名称</label><input class="input" id="nx_name" placeholder="如：窄距俯卧撑"></div>' +
    '<div class="form-grid">' +
      '<div><label>大类</label><select class="select" id="nx_cat">' + CATS.map(c => '<option>' + c + '</option>').join('') + '</select></div>' +
      '<div><label>部位</label><select class="select" id="nx_muscle">' + MUSCLES.map(m => '<option>' + m + '</option>').join('') + '</select></div>' +
      '<div><label>记录方式</label><select class="select" id="nx_mode">' + MODES.map(m => '<option value="' + m + '">' + MODE_CN[m] + '</option>').join('') + '</select></div>' +
    '</div>' +
    '<div class="tiny muted" style="margin-top:10px">换大类会自动带出该大类的默认部位与记录方式，仍可手改（如「核心 + 计时」= 平板支撑）。</div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="nx_add">添加</button></div>');
  const b = dlg.box;
  const catSel = $('#nx_cat', b), musSel = $('#nx_muscle', b), modSel = $('#nx_mode', b);
  const syncDefaults = () => { musSel.value = defaultMuscle(catSel.value); modSel.value = defaultMode(catSel.value); };
  catSel.addEventListener('change', syncDefaults);
  syncDefaults();
  const add = () => {
    const name = $('#nx_name', b).value.trim();
    if(!name){ toast('请填写动作名', true); return; }
    if(exDupInMine(name)){ toast('该动作已存在', true); return; }   /* 与编辑共用同一口径 */
    state.exercises.push({ id:uid(), name, cat:catSel.value, muscle:musSel.value, mode:modSel.value });
    save(); closeDialog(); if(after) after(); toast('已添加：' + name);
  };
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
  $('#nx_add', b).addEventListener('click', add);
  $('#nx_name', b).addEventListener('keydown', e => { if(e.key === 'Enter') add(); });   /* 桌面端回车即添加 */
}
/* 库内判重口径（添加 / 编辑 / 挑入共用）：按 name 比对，两侧都 trim（存量条目可能带多余空白）。
 * exceptId 用于编辑时排掉自己；一处实现，免得两条入口各自漂移。 */
function exDupInMine(name, exceptId){
  const nm = String(name == null ? '' : name).trim();
  return USERS.shared.exercises.some(x => x.id !== exceptId && String(x.name == null ? '' : x.name).trim() === nm);
}
/* 编辑保存口径（纯函数，便于测试）：名称必填、不得与库里其他条目重名（库内一律按 name 比对）；
 * 大类/部位/记录方式只在取值合法（在枚举内）时写入，非法值保持原样。
 * 返回 '' 表示已写入，'name' / 'dup' 为拒绝原因。 */
function applyExEdit(e, name, cat, muscle, mode){
  const nm = String(name == null ? '' : name).trim();
  if(!nm) return 'name';
  if(exDupInMine(nm, e.id)) return 'dup';
  e.name = nm;
  if(CATS.indexOf(cat) >= 0) e.cat = cat;
  if(MUSCLES.indexOf(muscle) >= 0) e.muscle = muscle;
  if(MODES.indexOf(mode) >= 0) e.mode = mode;
  return '';
}
/* 编辑我的库里的动作（行内 ✏️）：名称与 大类/部位/记录方式 都能改；同名（除自己）仍拒绝。
 * 三件套缺字段的存量条目（老数据）预选该大类的默认值，而不是让浏览器默默落到第一项。 */
function openExEditor(e, after){
  const curCat = CATS.indexOf(e.cat) >= 0 ? e.cat : '其他';
  const curMuscle = MUSCLES.indexOf(e.muscle) >= 0 ? e.muscle : defaultMuscle(curCat);
  const curMode = MODES.indexOf(e.mode) >= 0 ? e.mode : defaultMode(curCat);
  const opts = (list, cur, cn) => list.map(v => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + (cn ? MODE_CN[v] : v) + '</option>').join('');
  const dlg = showDialog('编辑动作',
    '<div class="field"><label>动作名称</label><input class="input" id="ex_name" value="' + esc(e.name) + '"></div>' +
    '<div class="form-grid">' +
      '<div><label>大类</label><select class="select" id="ex_cat">' + opts(CATS, curCat, false) + '</select></div>' +
      '<div><label>部位</label><select class="select" id="ex_muscle">' + opts(MUSCLES, curMuscle, false) + '</select></div>' +
      '<div><label>记录方式</label><select class="select" id="ex_mode">' + opts(MODES, curMode, true) + '</select></div>' +
    '</div>' +
    '<div class="tiny muted" style="margin-top:10px">换大类会自动带出该大类的默认部位与记录方式，仍可手改（如「核心 + 计时」= 平板支撑）；与库里其他动作重名会被拒绝。</div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="ex_save">保存</button></div>');
  const b = dlg.box;
  const catSel = $('#ex_cat', b), musSel = $('#ex_muscle', b), modSel = $('#ex_mode', b);
  const syncDefaults = () => { musSel.value = defaultMuscle(catSel.value); modSel.value = defaultMode(catSel.value); };
  catSel.addEventListener('change', syncDefaults);
  const saveEdit = () => {
    const err = applyExEdit(e, $('#ex_name', b).value, catSel.value, musSel.value, modSel.value);
    if(err){ toast(err === 'dup' ? '该动作已存在' : '请填写动作名', true); return; }
    save(); closeDialog(); if(after) after(); toast('已保存：' + e.name);
  };
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
  $('#ex_save', b).addEventListener('click', saveEdit);
  $('#ex_name', b).addEventListener('keydown', evt => { if(evt.key === 'Enter') saveEdit(); });   /* 桌面端回车即保存 */
}

/* =====================================================
   身体数据
===================================================== */
let bodyMetric = 'weight';        /* 趋势图当前选中的指标（MEASURES 里的 id） */

function renderBody(){
  const lb = bodyLatest();
  const bmiV = bmi();
  const last30 = lastNDates(30);
  const weight30ago = bodyVal('weight', last30[0]);
  const w = lb && lb.weight !== undefined ? lb.weight : null;
  let delta = null, cls = '';
  if(w !== null && weight30ago !== null){ const d = w - weight30ago; delta = (d>0?'+':'') + d.toFixed(1) + ' kg / 近30天'; cls = d>0?'up':(d<0?'down':''); }

  const tileVals = MEASURES.map(m => {
    const v = lb && lb[m.id] !== undefined ? lb[m.id] : null;
    const prev = bodyVal(m.id, addDays(today(), -7));
    let dlt = ''; let c = '';
    if(v !== null && prev !== null && v !== prev){ dlt = (v-prev>0?'+':'') + round(v-prev,1) + ' / 7天'; c = v-prev>0 ? 'up' : 'down'; }
    return '<div class="tile"><div class="lab">' + esc(m.label) + '</div><div class="val">' + (v===null?'--':(m.id==='bf' ? v : round(v,1))) + '<span class="unit">' + m.unit + '</span></div><div class="delta ' + c + '">' + dlt + '</div></div>';
  }).join('');

  const metricOpts = MEASURES.map(m => '<option value="' + m.id + '"' + (m.id===bodyMetric?' selected':'') + '>' + esc(m.label) + '</option>').join('');
  const chart = chartCard('chartBody', (MEASURES.find(m=>m.id===bodyMetric)||{}).label + ' 趋势', '近60条 · 鼠标悬停查看数值',
    '<select class="select" id="bm_select" style="max-width:120px;padding:5px 8px">' + metricOpts + '</select>');

  // 最近记录表
  const rows = [...state.body].sort((a,b) => a.date < b.date ? 1 : -1).slice(0, 14).map(r =>
    '<tr><td>' + dateCN(r.date) + '</td>' + MEASURES.map(m => '<td>' + (r[m.id] !== undefined && r[m.id] !== null ? round(r[m.id],1) : '—') + '</td>').join('') + '</tr>').join('');
  const history = state.body.length ?
    '<div class="card" style="padding:6px 12px 12px"><div style="overflow:auto"><table class="tbl"><thead><tr><th>日期</th>' + MEASURES.map(m => '<th>' + m.label + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>'
    : '';

  /* BMI 显示数值本身，颜色按分档自动选取（bmiTone：18.5/24/28 → 偏瘦蓝/正常绿/超重橙/肥胖红），小字注明正常范围 */
  const bmiInfo = bmiTone(bmiV);

  const html =
    '<div class="card">' +
      /* 两列统一的三行节奏（标签 → hero 大字 → 小字说明，间距同为 6px），保证体重与 BMI 行行对齐 */
      '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
        '<div class="grow" style="min-width:190px">' +
          '<div class="tiny muted">当前体重</div>' +
          '<div class="hero" style="color:var(--brand-ink);margin-top:6px">' + (w===null?'--':w.toFixed(1)) + '<span class="unit">kg</span></div>' +
          '<div class="delta ' + cls + '" style="font-size:12.5px;margin-top:6px">' + (delta || '&nbsp;') + '</div>' +
        '</div>' +
        '<div style="min-width:120px;text-align:center">' +
          '<div class="tiny muted">BMI</div>' +
          '<div class="hero" style="color:' + (bmiInfo ? bmiInfo.c : 'var(--ink-2)') + ';margin-top:6px">' + (bmiV === null ? '--' : bmiV) + '</div>' +
          '<div class="tiny muted" style="margin-top:6px">' + (bmiInfo ? (bmiInfo.ok ? '✓ 正常范围 18.5~24' : '⚠ 正常范围 18.5~24') : '记录体重后查看') + '</div>' +
        '</div>' +
      '</div>' +
      /* 记录按钮收进卡内底部居中（「查看全部」入口已移除，页尾最近记录表仍可看近期数据） */
      '<div style="text-align:center;margin-top:14px"><button class="btn primary" id="bm_add">✏️ 记录今天</button></div>' +
    '</div>' +
    '<div class="row mt">' + tileVals + '</div>' +
    '<div class="mt">' + chart + '</div>' +
    history;

  $('#view').innerHTML = html;
  $('#bm_add').addEventListener('click', () => openBodyDialog());
  const sel = $('#bm_select'); if(sel) sel.addEventListener('change', () => { bodyMetric = sel.value; renderBody(); });
  renderBodyChart(bodyMetric);
}

function openBodyDialog(){
  const lb = bodyLatest();
  const valOf = m => { const v = lb && lb[m.id] !== undefined ? lb[m.id] : null; return v === null ? '' : v; };
  const fields = MEASURES.map(m =>
    '<div><label>' + esc(m.label) + (m.unit ? ' <span class="tiny muted">' + m.unit + '</span>' : '') + '</label>' +
    '<input class="input bd" type="number" data-m="' + m.id + '" step="0.1" min="0" value="' + (m.id==='weight' ? valOf('weight') || '' : valOf(m.id)) + '"' + (m.id==='weight' ? ' placeholder="必填"' : '') + '></div>').join('');
  const html =
    '<div class="field"><label>记录日期</label><input class="input" type="date" id="bd_date" value="' + today() + '"></div>' +
    '<div class="form-grid">' + fields + '</div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="bd_save">保存</button></div>';
  const dlg = showDialog('记录身体数据', html);
  const b = dlg.box;
  $('#bd_save', b).addEventListener('click', () => {
    const date = $('#bd_date', b).value || today();
    const rec = { date };
    $$('.bd', b).forEach(i => { const v = i.value; if(v !== '' && v !== null && v !== undefined) rec[i.dataset.m] = num(v); });
    if(rec.weight === undefined){ toast('至少记录体重', true); return; }
    upsertBody(rec); closeDialog(); renderBody(); toast('已记录 ' + dateCN(date));
  });
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
}

function renderBodyChart(metric){
  const mdef = MEASURES.find(m => m.id === metric);
  // 汇总按日期取最近一条，取最近 60 条
  const recs = state.body.filter(r => r[metric] !== undefined && r[metric] !== null);
  if(recs.length < 2){ $('#chartBody').innerHTML = '<div class="empty"><div class="e-ic">📏</div>数据不足，先去记录几次吧</div>'; return; }
  const pts = recs.map(r => ({ x:r.date, y:r[metric] }));
  const out = pts.slice(Math.max(0, pts.length - 60));
  const svg = lineChartSVG({
    points: out,
    color: 'var(--brand)',
    fill: true,
    yUnit: mdef.unit,
    fmtY: v => mdef.id === 'bf' ? v.toFixed(0) : (v < 10 ? v.toFixed(1) : v.toFixed(0)),
  });
  $('#chartBody').innerHTML = '<div class="cc-h"><div class="cc-t">' + esc(mdef.label) + ' 趋势</div><span class="cc-s">近' + out.length + '条 · 悬停看数值</span></div>' + svg;
}

/* 卡片容器 html：给历史页（统计看板）与身体页复用 */
function chartCard(containerId, title, sub, controls){
  return '<div class="chart-card" style="margin-bottom:16px"><div class="cc-h"><div><div class="cc-t">' + esc(title) + '</div>' + (sub ? '<div class="cc-s">' + sub + '</div>' : '') + '</div>' + (controls || '') + '</div><div id="' + containerId + '"></div></div>';
}

/* =====================================================
   今日睡眠 / 今日饮水（原「睡眠饮水」页并入概览页）
   记录以日期为键（state.water[date]=杯数；state.sleep[date]=睡眠段数组），
   睡眠归属"起床那天"。v4.6 多段化：一天可记多段（夜间/午睡/其他休息），
   每段 {t,bed,wake,mins,quality}，达标与统计按全天总时长口径。
   概览页两张"今日"卡直接记录当天；补记入口在历史页睡眠/饮水图表卡标题的 🕘，
   打开**各自**的历史弹窗（v4.5:睡眠与饮水分开补记、互不混排），弹窗内可翻任意日期查看 / 补记 / 修改 / 删除。
===================================================== */
let waterHisDate = today();        // 饮水历史弹窗内翻页的当前日期
let sleepHisDate = today();        // 睡眠历史弹窗内翻页的当前日期
/* 睡眠质量 1-5 档。2026-09-12 用户裁定：由表情改成星等。
 * 原 😖😕😐🙂😄 五张脸在卡面 16px 上中间三档几乎分不出（而且段首类型图标也是表情，两张脸挤一行）。
 * 现在档位 = 实心 ★ 的个数 + 空心 ☆ 补足 5 格，“几档”一眼看得出；编辑器那排也用同一套星。 */
const QUALITY = [1,2,3,4,5].map(n => ({ n, stars: '★'.repeat(n) + '☆'.repeat(5 - n) }));
/* 卡面质量小签（HTML）：实心 ★ 金色 = 已给档，空心 ☆ 灰色 = 剩余档（无评分不显，返回空串） */
function qStarsHTML(v){
  const q = QUALITY.find(x => x.n === v);
  if (!q) return '';
  return '<span class="qstars"><span class="qf">' + '★'.repeat(q.n) + '</span><span class="qe">' + '☆'.repeat(5 - q.n) + '</span></span>';
}

function lifeWaterCard(d, ctx){    // ctx:'home'=概览今日卡（标题带「今日」）| 'dlg'=历史弹窗卡
  const isHome = ctx === 'home';
  const wCups = waterFor(d);
  const wPct = Math.round(wCups / state.waterTarget * 100);
  return '<div class="card" style="margin-bottom:0"><h3><span>' + (isHome ? '💧 今日饮水' : '💧 饮水') + '</span></h3>' +
    '<div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-top:6px">' +
      '<button class="iconbtn2" data-wmin style="font-size:20px">−</button>' +
      '<span style="font-size:34px;font-weight:800;min-width:52px;text-align:center">' + wCups + '</span>' +
      '<span class="muted" style="font-size:14px">/ ' + state.waterTarget + ' 杯</span>' +
      '<button class="iconbtn2" data-wplus style="font-size:20px;color:var(--brand)">＋</button>' +
    '</div>' +
    '<div class="meter mt"><i style="width:' + clamp(wPct,0,100) + '%"></i></div>' +
    '<div class="tiny muted" style="text-align:center;margin-top:8px">' + (wCups < state.waterTarget ? '再喝 ' + (state.waterTarget - wCups) + ' 杯达标' : '达标，继续保持 🎉') + '</div>' +
  '</div>';
}

function lifeSleepCard(d, ctx){
  const isHome = ctx === 'home';
  const list = sleepSessions(d);
  const total = sleepTotalMins(d);
  const totalTxt = '合计 ' + round(total/60,1) + ' 小时 · ' + (total >= SLEEP_GOAL_MINS ? '达标' : '偏少');
  /* 概览「今日」卡：合计挪到底部按钮那一行的最左（v4.15，用户要求），标题只留卡名；
   * 历史弹窗卡仍留在卡头 hint（isHome=false 分支不变） */
  const head = '<span>' + (isHome ? '😴 今日睡眠' : '😴 睡眠') + '</span>' +
    (list.length && !isHome ? '<span class="hint">' + totalTxt + '</span>' : '');
  // 无当日快速表单：空态只留一句提示，新增一律走「记录一段」弹窗（v4.6 用户要求收敛）
  return '<div class="card" style="margin-bottom:0"><h3>' + head + '</h3>' +
    (list.length ? list.map((s, i) => {
      const tp = sleepType(s.t);
      // 未知类型如实显形（❓ + 原始 t），不冒充「夜间睡眠」——旧写法会让人看错档，
      // 并在编辑保存时把原值悄悄改成 night
      const ic = tp ? tp.ic : '❓';
      const label = tp ? tp.label : '未知类型 ' + esc(String(s.t === undefined || s.t === null || s.t === '' ? '(空)' : s.t));
      // 重点展示时长；质量贴个星等小签（无评分不显——qStarsHTML 自己返空）；具体时段小字
      return '<div class="lrow"><div class="thumb">' + ic + '</div>' +
        '<div class="grow"><div class="b" style="font-size:17px">' + round((num(s.mins) || 0)/60,1) + ' 小时' +
        qStarsHTML(num(s.quality)) + '</div>' +
        '<div class="sub">' + label + ' · ' + esc(s.bed || '--:--') + ' → ' + esc(s.wake || '--:--') + '</div></div>' +
        '<button class="iconbtn2" data-sleedit data-i="' + i + '" title="修改/删除">✏️</button></div>';
    }).join('') : '<div class="tiny muted" style="text-align:center;padding:8px 0">还没有睡眠记录</div>') +
    '<div class="row mt" style="' + (isHome ? 'align-items:center' : 'justify-content:flex-end') + '">' +
      (isHome && list.length ? '<span class="tiny">' + totalTxt + '</span>' : '') +
      /* margin-left:auto 而非 space-between：窄卡换行时按钮仍靠右，不会跳到下一行行首 */
      '<button class="btn sm ghost" data-sleadd' + (isHome ? ' style="margin-left:auto"' : '') + '>＋ 记录一段</button>' +
    '</div>' +
  '</div>';
}

/* 概览页两张"今日"卡（date 恒为今天）的按钮绑定（渲染已改由 homeCardsHTML 按 state.homeOrder 拼装；
 * 饮水目标设为 0 时那张卡本身就不渲染） */
function bindLifeToday(v){
  bindWaterCard(v, today(), renderHome);
  bindSleepCard(v, today(), renderHome);
}

/* 历史弹窗共用的日期翻页条（‹ 日期 › [+回到今天] 居中，可选下方一句提示） */
function hisDaynav(d, hint){
  const isToday = d === today();
  return '<div style="display:flex;flex-direction:column;align-items:center;gap:6px;margin-bottom:14px">' +
    '<div class="daynav"><button class="iconbtn2" data-day="-1">‹</button>' +
      '<div class="lbl">' + dateCN(d) + '<small>' + (isToday ? '今天' : '周' + DAY_CN[weekday(d)]) + '</small></div>' +
      '<button class="iconbtn2" data-day="1">›</button>' +
      (isToday ? '' : '<button class="btn sm" data-day="today">回到今天</button>') +
    '</div>' +
    (hint ? '<div class="tiny muted">' + hint + '</div>' : '') +
  '</div>';
}
function bindDaynav(b, onStep){   // onStep('today' | ±1)：更新所属弹窗的日期游标并重绘
  $$('[data-day]', b).forEach(btn => btn.addEventListener('click', () => onStep(btn.dataset.day === 'today' ? 'today' : num(btn.dataset.day))));
}

/* ---------- 饮水历史弹窗（单卡，与睡眠分开补记） ---------- */
function openWaterHistory(){
  const dlg = showDialog('💧 饮水 · 历史记录', '', {size:'lg'});
  renderWaterHistory(dlg.box, dlg.close);   // 传 captured close：弹窗内部重绘时不能误关当时正好在最上面的其他层
}
function renderWaterHistory(b, close){
  const d = waterHisDate;
  b.innerHTML = hisDaynav(d) +
    lifeWaterCard(d, 'dlg') +
    '<div class="d-f"><button class="btn ghost" data-cancel>关闭</button></div>';
  bindDaynav(b, step => { waterHisDate = step === 'today' ? today() : addDays(waterHisDate, step); renderWaterHistory(b, close); });
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', close);
  bindWaterCard(b, d, () => { renderWaterHistory(b, close); renderView(); });   // 弹窗背后的概览/历史页同步刷新
}

/* ---------- 睡眠历史弹窗（单卡，与饮水分开补记） ---------- */
function openSleepHistory(){
  const dlg = showDialog('😴 睡眠 · 历史记录', '', {size:'lg'});
  renderSleepHistory(dlg.box, dlg.close);
}
function renderSleepHistory(b, close){
  const d = sleepHisDate;
  b.innerHTML = hisDaynav(d, '睡眠以「起床那天」归属 · ＋记录一段可补午睡/小憩') +
    lifeSleepCard(d, 'dlg') +
    '<div class="d-f"><button class="btn ghost" data-cancel>关闭</button></div>';
  bindDaynav(b, step => { sleepHisDate = step === 'today' ? today() : addDays(sleepHisDate, step); renderSleepHistory(b, close); });
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', close);
  bindSleepCard(b, d, () => { renderSleepHistory(b, close); renderView(); });   // 弹窗背后的概览/历史页同步刷新
}

/* 绑定 root 内的饮水卡（+/− stepper） */
function bindWaterCard(root, d, after){
  const wp = $('[data-wplus]', root); if(wp) wp.addEventListener('click', () => { state.water[d] = (state.water[d]||0) + 1; save(); after(); });
  const wm = $('[data-wmin]', root); if(wm) wm.addEventListener('click', () => { if(waterFor(d) > 0){ state.water[d] = waterFor(d) - 1; save(); after(); } });
}

/* 绑定 root 内的睡眠卡（有无记录都只有「＋ 记录一段」与逐段 ✏️，表单统一在弹窗里） */
function bindSleepCard(root, d, after){
  const add = $('[data-sleadd]', root); if(add) add.addEventListener('click', () => sleepSessionEditor(d, null, after));
  $$('[data-sleedit]', root).forEach(b2 =>
    b2.addEventListener('click', () => sleepSessionEditor(d, b2.dataset.i === undefined ? null : num(b2.dataset.i), after)));
}
/* 按下标写回一段（editing=null 追加）。**重新取**当日段数组，不用开弹窗时的快照——期间
 * 概览卡/历史弹窗的另一处操作、或后台同步采纳（retrySync/handleConflict 的 materialize）
 * 都可能改写 state.sleep[d]，拿旧快照整份覆盖会丢掉期间新增的段。段数变了说明下标已失效，
 * 返回 false 让调用方提示重试，而不是写出越界空洞（JSON 化后变 null，服务端会 500）。 */
function putSleepSeg(d, editing, newSeg){
  const arr = sleepSessions(d).slice();
  if(editing === null) arr.push(newSeg);
  else if(editing < arr.length) arr[editing] = newSeg;
  else return false;
  state.sleep[d] = arr;
  return true;
}
function dropSleepSeg(d, editing){
  const arr = sleepSessions(d).slice();
  if(editing !== null && editing < arr.length) arr.splice(editing, 1);
  const segs = normalizeSleepDay(arr);   // 最后一段删完 → 空数组不留键（形状契约规则 4）
  if(segs) state.sleep[d] = segs; else delete state.sleep[d];
}

/* ---------- 时间滚轮（2026-09-12：手机端用 input[type=time] 会弹系统「圆盘」时钟，改成上下滑动） ----------
 * 自绘两列滚动列表（小时 / 分钟），CSS scroll-snap 吸附，中间一条高亮 band 表示选中项。
 * 值仍写回**同名隐藏 input**：调用方继续读 `$('#sq_bed', b).value`，sleepDur 与存储形状零改动。
 * 列高恒为 5 项、上下各留 2 项空白（CSS 的 --tw-h 与 TW_ITEM_H 必须一致），
 * 这样「滚到某个值」= scrollTop = 下标 × 项高，选中项自然停在正中。 */
const TW_ITEM_H = 34;                                   // 单项高度(px)，与 style.css 的 .twheel --tw-h 同步
const TW_MIN_STEP = 5;                                  // 分钟档位步长（0/5/…/55，睡眠记到 5 分钟足够）
const TW_HOURS = Array.from({ length: 24 }, (_, i) => i);
/* 'HH:MM' → [时, 分]；缺值/非法（含 25:00、12:99）→ null（调用方按默认时段兜底，不写脏值） */
function twParts(v){
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(typeof v === 'string' ? v.trim() : '');
  if(!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return (h <= 23 && mi <= 59) ? [h, mi] : null;
}
const tw2 = n => (n < 10 ? '0' : '') + n;
function twFmt(h, m){ return tw2(h) + ':' + tw2(m); }
/* 分钟列档位：0,5,…,55；当前值不在档位（旧记录里的 23:07 这类）就把它插进去——
 * 不然一打开编辑弹窗就把用户的分钟数悄悄挪到最近的 5 分。 */
function twMinList(cur){
  const out = [];
  for(let i = 0; i < 60; i += TW_MIN_STEP) out.push(i);
  if(typeof cur === 'number' && Number.isFinite(cur) && cur >= 0 && cur < 60 && out.indexOf(cur) < 0){
    out.push(cur); out.sort((a, b) => a - b);
  }
  return out;
}
function twColHTML(kind, list, sel){
  return '<div class="tw-col" data-tw-col="' + kind + '">' + list.map(v =>
    '<button type="button" class="tw-item' + (v === sel ? ' on' : '') + '" data-n="' + v + '">' + tw2(v) + '</button>'
  ).join('') + '</div>';
}
/* 滚轮内胆（挂载时重画也走这里 → 单一来源） */
function twInner(id, p){
  return '<input type="hidden" id="' + id + '" value="' + twFmt(p[0], p[1]) + '">' +
    '<div class="tw-cols">' + twColHTML('h', TW_HOURS, p[0]) +
      '<span class="tw-sep">:</span>' + twColHTML('m', twMinList(p[1]), p[1]) + '</div>' +
    '<span class="tw-band" aria-hidden="true"></span>';
}
function timeWheelHTML(id, value){
  const p = twParts(value) || [0, 0];                    // 脏值只能落到 00:00（滚轮没有「空」态）
  return '<div class="twheel" data-tw="' + id + '">' + twInner(id, p) + '</div>';
}
/* 组装/重画一个滚轮并绑监听：换时段或程序改值都走这里（重画顺带重绑；回调挂在节点上不丢）。
 * 值存在节点上（`__twv`），**不靠 DOM 回读**——布局万一没就绪，scrollTop 赋值会静默留在 0，
 * 那时再从滚动位置反推就会把 23:35 写成 00:00。 */
function timeWheelMount(root, id, value, onChange){
  const w = $('[data-tw="' + id + '"]', root); if(!w) return null;
  if(onChange) w.__twcb = onChange;
  const p = twParts(value) || [0, 0];
  w.__tw = { h: TW_HOURS, m: twMinList(p[1]) };          // 下标 ↔ 值 的映射（列里的 data-n 与它同序）
  w.__twv = [p[0], p[1]];
  w.innerHTML = twInner(id, p);
  twBindCol(w, 'h'); twBindCol(w, 'm');
  twScrollTo(w, 'h'); twScrollTo(w, 'm');               // 只摆视觉位置
  twWrite(w);
  return w;
}
/* 程序改值（如换睡眠类型带默认时段）：整轮重画，回调沿用节点上存的 */
function twSet(root, id, value){ timeWheelMount(root, id, value, null); }
function twColOf(w, kind){ return $('[data-tw-col="' + kind + '"]', w); }
/* 项高优先量 DOM（CSS 改了也不用动 JS），量不到（未布局/测试桩）退回常量 */
function twItemH(col){
  const it = col && col.children && col.children[0];
  return (it && it.offsetHeight) || TW_ITEM_H;
}
/* 当前停在第几项；**没有项 / 量不到滚动量**（渲染未完、测试桩）时返回 null：
 * 这种时候不能拿「位置 0」去反推值，否则一打开编辑弹窗就把 23:07 改写成 00:00。 */
function twIdx(col){
  const n = col && col.children ? col.children.length : 0;
  if(!n || typeof col.scrollTop !== 'number') return null;
  const i = Math.round(col.scrollTop / twItemH(col));
  return Math.max(0, Math.min(n - 1, i));
}
/* 按当前值把某一列滚到选中项（纯视觉） */
function twScrollTo(w, kind){
  const col = twColOf(w, kind), list = w.__tw && w.__tw[kind]; if(!col || !list) return;
  const i = list.indexOf(w.__twv[kind === 'h' ? 0 : 1]); if(i < 0) return;
  col.scrollTop = i * twItemH(col);
  twPaint(w, kind);
}
function twPaint(w, kind){
  const col = twColOf(w, kind); if(!col || !col.children) return;
  const v = w.__twv[kind === 'h' ? 0 : 1];
  Array.prototype.forEach.call(col.children, it => it.classList.toggle('on', num(it.dataset.n) === v));
}
/* 用户在某一列滑停 → 由下标回写值（两列都回写：不知道刚才动的是哪一列） */
function twPull(w){
  ['h', 'm'].forEach((kind, i) => {
    const col = twColOf(w, kind), list = w.__tw && w.__tw[kind]; if(!col || !list) return;
    const k = twIdx(col); if(k === null) return;
    w.__twv[i] = list[k];
  });
}
/* 值 → 隐藏 input（= 调用方读的 .value）+ 中线高亮 */
function twWrite(w){
  const ip = $('#' + (w.dataset.tw || ''), w); if(ip) ip.value = twFmt(w.__twv[0], w.__twv[1]);
  twPaint(w, 'h'); twPaint(w, 'm');
}
/* 滚到最近的一档：浏览器对**程序设定**的 scrollTop 不会补吸附（实测 122px 停在两档之间），
 * 拖停后统一对一次，保证「看见的那一格」= 写进去的值。 */
function twAlign(w, kind){
  const col = twColOf(w, kind); if(!col) return;
  const k = twIdx(col); if(k === null) return;
  const want = k * twItemH(col);
  if(Math.abs(col.scrollTop - want) > 0.5) col.scrollTop = want;
}
/* 滑动停下再取值（拖动中每帧回调会把 prev() 打成刷屏；大于一次停顿的间隔就不该再当拖动中）。
 * 点数字 = 直接选中该项（手机上一列 24 小时盲滑太累）。 */
function twBindCol(w, kind){
  const col = twColOf(w, kind); if(!col || !col.addEventListener) return;
  let timer = null;
  const settle = () => {
    twAlign(w, 'h'); twAlign(w, 'm');
    twPull(w); twWrite(w);
    const cb = w.__twcb; if(cb) cb();
  };
  col.addEventListener('scroll', () => {
    if(timer) clearTimeout(timer);
    timer = setTimeout(settle, 120);
  });
  Array.prototype.forEach.call(col.children || [], it =>
    it.addEventListener('click', () => {
      w.__twv[kind === 'h' ? 0 : 1] = num(it.dataset.n);
      twScrollTo(w, kind); twWrite(w);
      const cb = w.__twcb; if(cb) cb();
    }));
}

/* 睡眠段编辑弹窗（概览今日卡 / 历史弹窗共用）：idx=null 新增，否则按下标修改（含删除该段）。
 * 新增默认类型：当日已有夜间段则建议「午睡」；新增态换类型重置默认时段，编辑态保留已填时间。
 * 编辑态原样承接已存的 t（未知类型不预选任何档、保存也不改写）。 */
function sleepSessionEditor(d, idx, after){
  after = after || (() => renderHome());
  const editing = typeof idx === 'number' ? idx : null;
  const list = sleepSessions(d);                       // 只用于回填表单与推断默认类型
  const seg = editing !== null ? list[editing] : null;
  let tk = seg ? (typeof seg.t === 'string' && seg.t ? seg.t : null)
               : (list.some(s => s.t === 'night') ? 'nap' : 'night');
  const def = (sleepType(tk) || sleepType('night')).def;
  const bed0 = (seg && seg.bed) || def[0], wake0 = (seg && seg.wake) || def[1];
  const html =
    '<div class="row" style="gap:6px;margin-bottom:10px">' + SLEEP_TYPES.map(t =>
      '<button class="btn sm" id="sq_tp_' + t.k + '">' + t.ic + ' ' + t.label + '</button>').join('') + '</div>' +
    '<div class="form-grid tw-grid">' +
      '<div class="tw-cell">' + timeWheelHTML('sq_bed', bed0) + '<label>入睡</label></div>' +
      '<div class="tw-cell">' + timeWheelHTML('sq_wake', wake0) + '<label>起床</label></div>' +
    '</div>' +
    '<div class="row mt" style="align-items:center"><span class="tiny muted" style="margin-right:8px">质量：</span><div class="stars" id="sq_stars">' + QUALITY.map(q => '<button class="sqst on" data-q="' + q.n + '" title="' + q.n + ' 档">★</button>').join('') + '</div></div>' +
    '<div class="row mt" style="align-items:center"><span class="tiny muted">时长 <b id="sq_prev">--</b></span></div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>取消</button>' +
      (editing !== null ? '<button class="btn danger ghost" id="sq_del">删除该段</button>' : '') +
      '<button class="btn primary" id="sq_save">保存</button></div>';
  const dlg = showDialog(editing === null ? '记录睡眠' : '修改睡眠', html);
  const b = dlg.box;
  let q = (seg && num(seg.quality)) || 3;
  const sb = $('#sq_stars', b);
  function paint(){ $$('.sqst', sb).forEach(x => x.classList.toggle('on', num(x.dataset.q) <= q)); }
  paint();
  $$('.sqst', sb).forEach(x => x.addEventListener('click', () => { q = num(x.dataset.q); paint(); }));
  /* 时长实时预览：非夜间档算出超过 12 小时基本就是时段填反/跨夜手滑，当场提醒比事后看图强 */
  function prev(){ const m = sleepDur($('#sq_bed', b).value, $('#sq_wake', b).value, tk);
    $('#sq_prev', b).textContent = m === null ? '--'
      : round(m/60,1) + ' 小时' + (tk !== 'night' && m > 720 ? '（超过 12 小时，检查是否填反）' : ''); }
  function paintTp(){ SLEEP_TYPES.forEach(t => $('#sq_tp_' + t.k, b).classList.toggle('primary', t.k === tk)); }
  paintTp();
  SLEEP_TYPES.forEach(t => $('#sq_tp_' + t.k, b).addEventListener('click', () => {
    tk = t.k; paintTp(); prev();
    if(editing === null){ twSet(b, 'sq_bed', t.def[0]); twSet(b, 'sq_wake', t.def[1]); prev(); }
  }));
  timeWheelMount(b, 'sq_bed', bed0, prev); timeWheelMount(b, 'sq_wake', wake0, prev);   // 滚动停下即刷新时长预览
  prev();
  $('#sq_save', b).addEventListener('click', () => {
    const bed = $('#sq_bed', b).value, wake = $('#sq_wake', b).value;
    if(!bed || !wake){ toast('请填写入睡与起床时间', true); return; }
    if(!tk){ toast('请选择睡眠类型', true); return; }
    const mins = sleepDur(bed, wake, tk);
    const newSeg = { t: tk, bed, wake };
    if(mins) newSeg.mins = mins;        // 0 或算不出 → 不写键（"键可缺省"约定；显式 mins:0 只是垃圾数据）
    newSeg.quality = q;
    if(!putSleepSeg(d, editing, newSeg)){ toast('这段时间的记录刚被改动，请关闭重开', true); return; }
    save(); closeDialog(); after(); toast(editing === null ? '已记录' : '已更新');
  });
  const del = $('#sq_del', b);
  if(del) del.addEventListener('click', () => {
    dropSleepSeg(d, editing);
    save(); closeDialog(); after(); toast('已删除');
  });
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
}

function renderSleepChart(){
  const el = $('#st_sleep'); if(!el) return;
  const ds = lastNDates(30);
  const pts = ds.map(x => ({ x, y: sleepTotalMins(x) }));   // 全天各段总时长
  el.innerHTML = barChartSVG({ points: pts, color: 'var(--cat2)', target: SLEEP_GOAL_MINS, targetLabel:'10h', unit:'分钟', fmtY: v => (v/60).toFixed(1) + 'h' });
}
function renderWaterChart(){
  const el = $('#st_water'); if(!el) return;
  const ds = lastNDates(30);
  const pts = ds.map(x => ({ x, y: waterFor(x) }));
  el.innerHTML = barChartSVG({ points: pts, color: 'var(--cat1)', target: state.waterTarget, targetLabel: state.waterTarget + '杯', unit:'杯', fmtY: v => v + '' });
}

/* =====================================================
   目标
===================================================== */
/* =====================================================
   设置页（v4.8：原「目标 · 打卡」页与 ⚙️ 设置弹窗合并，排在历史页之后）
   卡片顺序：我的档案 → 基础资料 → 营养目标 → 每日打卡管理 → 数据管理
   （末卡 = 后台管理，仅 admin 渲染；普通账户看不到任何管理入口）
   （所有卡片之下还有一颗独立的「⎋ 退出登录」，2026-09-11 由「修改档案」弹窗移出）
   （我的档案 = 2026-09-11 顶栏移除后并入；原顶栏胶囊弹窗改为内嵌卡。
     深色/浅色切换当时独立成一张「🎨 外观」卡，同日收进档案卡省纵向空间 → 原外观卡已删。
     2026-09-11 同日再改：该卡的卡头行与「修改档案」按钮删除，只留「头像 + 昵称/账户」一行
     ——整行即修改入口（#pf_edit → openProfileDialog()），主题图标钮挂在本行右端）
===================================================== */
function renderSettings(){
  const p = state.profile;
  const genderLabel = p.gender === 'male' ? '男' : p.gender === 'female' ? '女' : '—';
  const pTile = (lab, val, unit) =>
    '<div class="tile" style="box-shadow:none;background:var(--surface-2);min-width:0;padding:11px 10px"><div class="lab">' + lab + '</div><div class="val" style="font-size:19px">' + val + (unit ? '<span class="unit">' + unit + '</span>' : '') + '</div></div>';
  // 营养目标卡（营养 + 热量倾向 + 活动量 + 饮水；热量倾向决定自动计算的档位）
  const T = target();
  const actLabel = (ACTIVITIES.find(a => String(a.v) === String(state.activity)) || {}).label || state.activity;
  /* 活动量标签 =「主档位（补充说明）」，卡面拆两行：主档位正常字号，括号里的补充说明换行小字（2026-09-12） */
  const actSplit = (function(){
    const s = String(actLabel == null ? '' : actLabel);
    const m = s.match(/^([^（(]*)[（(]([^）)]*)[）)]?\s*$/);
    return m ? { main: m[1].trim(), note: m[2].trim() } : { main: s, note: '' };
  })();
  const goalMode = GOAL_MODE[state.goal.mode];   /* 未知档位（旧数据）显示 — */
  const modeLabel = goalMode ? goalMode.label : '—';
  const html =
    profileCardHTML() +
    '<div class="card"><h3><span>🧍 基础资料</span><span class="grow"></span><button class="btn sm" id="pr_edit">修改资料</button></h3>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">' +
      pTile('性别', genderLabel) +
      pTile('出生年份', p.birthYear) +
      pTile('身高', p.height, 'cm') +
      pTile('体重', p.currentKg, 'kg') +
    '</div>' +
    '<div class="tiny muted mt">性别、出生年份、身高、体重用于估算每日营养目标（自动档）与 BMI；在「身体」页记录体重后会同步到这里。</div>' +
    '</div>' +
    '<div class="card"><h3><span>🥗 营养目标</span><span class="grow"></span><button class="btn sm" id="nut_edit">修改目标</button></h3>' +
    '<div style="margin:2px 0 12px"><span class="hero" style="font-size:34px;color:var(--brand-ink)">' + T.kcal + '<span class="unit">kcal</span></span></div>' +
    '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">' +
      '<div class="tile" style="box-shadow:none;background:var(--surface-2);min-width:0;padding:11px 10px"><div class="lab">蛋白</div><div class="val" style="font-size:19px">' + T.p + '<span class="unit">g</span></div></div>' +
      '<div class="tile" style="box-shadow:none;background:var(--surface-2);min-width:0;padding:11px 10px"><div class="lab">碳水</div><div class="val" style="font-size:19px">' + T.c + '<span class="unit">g</span></div></div>' +
      '<div class="tile" style="box-shadow:none;background:var(--surface-2);min-width:0;padding:11px 10px"><div class="lab">脂肪</div><div class="val" style="font-size:19px">' + T.f + '<span class="unit">g</span></div></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px">' +   /* 2026-09-12：与上方营养三格同口径——手机上正好两行各三格（auto-fit 140px 会在窄屏降成 2 列，排成 3/2/1 三行） */
      '<div class="tile" style="box-shadow:none;background:var(--surface-2);min-width:0;padding:11px 10px"><div class="lab">活动量</div><div class="val" style="font-size:19px;line-height:1.3;white-space:normal">' + esc(actSplit.main) +
        (actSplit.note ? '<div class="tiny muted" style="font-weight:400;margin-top:2px;line-height:1.3">' + esc(actSplit.note) + '</div>' : '') +
      '</div></div>' +
      '<div class="tile" style="box-shadow:none;background:var(--surface-2);min-width:0;padding:11px 10px"><div class="lab">热量倾向</div><div class="val" style="font-size:19px">' + esc(modeLabel) + '</div></div>' +
      '<div class="tile" style="box-shadow:none;background:var(--surface-2);min-width:0;padding:11px 10px"><div class="lab">每日饮水</div><div class="val" style="' + (state.waterTarget ? 'font-size:19px' : 'font-size:15px;line-height:1.35;white-space:normal') + '">' + (state.waterTarget ? state.waterTarget + '<span class="unit">杯</span>' : '未设置') + '</div></div>' +
    '</div>' +
    '<div class="tiny muted mt">自动目标 = BMR ' + Math.round(bmr()) + ' kcal × 活动系数 ' + state.activity +
      (function(){ const g = GOAL_MODE[state.goal.mode];   /* v4.4:文案直接查表,不再按 adj 符号反推 */
        if(!g) return '';
        if(!g.adj) return '（热量倾向：' + g.label + '，不增减）';
        return '，再按热量倾向「' + g.label + '」' + (g.adj > 0 ? '+' : '−') + Math.abs(g.adj) + ' kcal'; })() +
      (state.nutrition.auto ? '（自动计算中）' : '（当前为手动设定）') +
      '；饮水目标用于概览页「今日饮水」卡的达标判断，设为 0（不追踪）时概览页不再显示该卡。</div>' +
    '</div>' +
    habitSettingsCardHTML() +
    '<div class="card"><h3><span>💾 数据管理</span></h3>' +
      '<div class="row gap8" style="justify-content:center">' +   /* 两按钮等宽外扩、整组居中，避免小屏下偏左堆一角 */
        '<button class="btn ghost" id="st_foodlib" style="flex:1;max-width:240px">📚 食物库(' + state.foods.length + ')</button>' +
        '<button class="btn ghost" id="st_exlib" style="flex:1;max-width:240px">📚 动作库(' + state.exercises.length + ')</button>' +
      '</div>' +
      '<div class="tiny muted" style="margin:8px 0 12px">在这里管理个人食物库与动作库：「我的库」可增删，也可从管理员维护的系统库挑入。</div>' +
      '<div class="row gap8">' +
        '<button class="btn ghost" id="st_export">⬇ 导出备份</button>' +
        '<button class="btn ghost" id="st_import">⬆ 导入备份</button>' +
        '<button class="btn danger ghost" id="st_wipe">🗑 清空数据</button>' +
      '</div>' +
      '<div class="tiny" id="st_sync" style="margin-top:10px;color:var(--ink-3)"></div>' +
      /* 概览卡片拖动顺序的逃生口（只在已被改过时出现，没改过就不占地方） */
      (resolveHomeOrder(state.homeOrder).join(',') !== HOME_ORDER_DEFAULT.join(',')
        ? '<div class="row" style="margin-top:8px"><button class="btn sm ghost" id="st_homeorder">↺ 概览卡片顺序：恢复默认</button></div>' : '') +
      /* 2026-09-12 按要求删掉卡底那条「各设备登录同一账户…多设备说明」小字 */
      '<input type="file" id="st_file" accept=".json,application/json" style="display:none">' +
    '</div>' +
    adminCardHTML() +
    /* 退出登录：设置页最下方独立一颗（2026-09-11 由「修改档案」弹窗移出，与「修改」动作解耦） */
    '<div class="row" style="justify-content:center;margin:4px 0 8px">' +
      '<button class="btn danger ghost" id="pf_logout">⎋ 退出登录</button>' +
    '</div>';
  $('#view').innerHTML = html;
  bindThemeToggle();
  /* 修改档案的入口 = 档案卡上「头像 + 昵称/账户」那一整块（卡头按钮已删） */
  $('#pf_edit').addEventListener('click', openProfileDialog);
  $('#pf_logout').addEventListener('click', doLogout);
  $('#pr_edit').addEventListener('click', openProfileEditor);
  $('#nut_edit').addEventListener('click', openNutritionEditor);
  bindHabitSettings();
  /* v4.8：原 ⚙️ 设置弹窗的数据工具搬进本页卡片；v4.9 起「载入演示数据」入口移除，清空/导入成功后各自跳回概览 */
  /* v4.15：食物库/动作库由弹窗改为子页面（页面顶部带「返回」），返回时本页重渲染、按钮上的库计数自动刷新 */
  $('#st_foodlib').addEventListener('click', () => go('foodlib'));
  $('#st_exlib').addEventListener('click', () => go('exlib'));
  $('#st_export').addEventListener('click', exportData);
  $('#st_import').addEventListener('click', () => {
    if(!confirm('导入会用备份中的数据覆盖本账户当前数据，是否继续？建议先「导出」留底。\n（多人备份文件只取其中"当前成员"那一份；其他成员请各自登录后再导入）')) return;
    $('#st_file').click();
  });
  $('#st_file').addEventListener('change', e => { const f = e.target.files[0]; if(f) importData(f); e.target.value = ''; });
  $('#st_wipe').addEventListener('click', () => { if(confirm('真的要清空本账户全部数据吗？此操作不可恢复（会同步清空服务器上的本人数据，不影响其他账户）。')) wipeAll(); });
  const ho = $('#st_homeorder');
  if(ho) ho.addEventListener('click', () => { state.homeOrder = HOME_ORDER_DEFAULT.slice(); save(); renderSettings(); toast('已恢复概览卡片默认顺序'); });
  refreshSyncStatus();
}


/* ---------- 营养目标编辑（营养 + 热量倾向 + 活动量 + 饮水，设置页） ---------- */
function openNutritionEditor(){
  const n = state.nutrition;
  const html =
    '<div class="chkline" style="margin-bottom:12px"><input type="checkbox" id="ne_auto"' + (n.auto ? ' checked' : '') + '> <span>根据基础代谢、活动量与热量倾向自动计算</span></div>' +
    '<div class="form-grid">' +
      '<div class="span2"><label>热量倾向</label><select class="select" id="ne_mode">' +
        ['cut','maintain','bulk'].map(m => '<option value="' + m + '">' + GOAL_MODE[m].opt + '</option>').join('') + '</select></div>' +
      '<div class="span2"><label>日常活动量</label><select class="select" id="ne_act">' + ACTIVITIES.map(a => '<option value="' + a.v + '">' + a.label + '</option>').join('') + '</select></div>' +
      '<div class="span2"><label>每日饮水目标（杯）· 0 = 不追踪</label><input class="input" id="ne_water" type="number" min="0" max="30" value="' + state.waterTarget + '">' +
        '<div class="tiny muted" style="margin-top:4px">设为 0 时概览页不显示「今日饮水」卡片</div></div>' +
    '</div>' +
    '<div class="form-grid mt" id="neGrid">' +
      '<div><label>热量 kcal</label><input class="input" id="ne_kcal" type="number" value="' + (n.kcal || '') + '"></div>' +
      '<div><label>蛋白质 g</label><input class="input" id="ne_protein" type="number" value="' + (n.protein || '') + '"></div>' +
      '<div><label>碳水 g</label><input class="input" id="ne_carbs" type="number" value="' + (n.carbs || '') + '"></div>' +
      '<div><label>脂肪 g</label><input class="input" id="ne_fat" type="number" value="' + (n.fat || '') + '"></div>' +
    '</div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="ne_save">保存</button></div>';
  const dlg = showDialog('修改营养目标', html);
  const b = dlg.box;
  const hasV = v => v !== null && v !== undefined;
  $('#ne_act', b).value = String(state.activity);
  /* v4.4:mode 缺失/非法(旧版数据 goal 无 mode)按「保持」显示——与计算兜底 GOAL_MODE 缺省一致。
   * 旧版 select.value 落空:下拉空白/选中项与实际计算分叉,保存后还把 '' 永久写回 */
  $('#ne_mode', b).value = Object.keys(GOAL_MODE).includes(state.goal.mode) ? state.goal.mode : 'maintain';
  const c0 = calcNutrition();
  /* v4.4:?? 保留合法的 0 值(如手动档把碳水设为 0)——旧版 || 会在重开+保存时把 0 悄悄换成计算默认值 */
  $('#ne_kcal', b).value = hasV(n.kcal) ? n.kcal : c0.kcal;
  $('#ne_protein', b).value = hasV(n.protein) ? n.protein : c0.protein;
  $('#ne_carbs', b).value = hasV(n.carbs) ? n.carbs : c0.carbs;
  $('#ne_fat', b).value = hasV(n.fat) ? n.fat : c0.fat;
  const pickVals = () => ({ act: num($('#ne_act', b).value) || 1.2, mode: $('#ne_mode', b).value });
  const fillCalc = c => { $('#ne_kcal', b).value = c.kcal; $('#ne_protein', b).value = c.protein; $('#ne_carbs', b).value = c.carbs; $('#ne_fat', b).value = c.fat; };
  const setNut = on => {
    $$('#neGrid input', b).forEach(i => i.disabled = on);
    if(on){ const v = pickVals(); fillCalc(calcNutritionFor({ profile: state.profile, activity: v.act, goal: { mode: v.mode } })); }
  };
  $('#ne_auto', b).addEventListener('change', e => setNut(e.target.checked));
  $('#ne_mode', b).addEventListener('change', () => setNut($('#ne_auto', b).checked));
  $('#ne_act', b).addEventListener('change', () => setNut($('#ne_auto', b).checked));
  setNut(n.auto);
  $('#ne_save', b).addEventListener('click', () => {
    state.goal.mode = $('#ne_mode', b).value;
    state.activity = num($('#ne_act', b).value);
    /* v4.5:允许 0 = 不追踪饮水(旧版 `num() || 旧值` 会把 0 悄悄换回旧值,且下限锁 1) */
    const wRaw = $('#ne_water', b).value.trim();
    state.waterTarget = wRaw === '' ? (state.waterTarget || 0) : clamp(num(wRaw), 0, 40);
    state.nutrition = { auto:$('#ne_auto', b).checked, kcal:num($('#ne_kcal', b).value), protein:num($('#ne_protein', b).value), carbs:num($('#ne_carbs', b).value), fat:num($('#ne_fat', b).value) };
    syncNutrition(); save(); closeDialog(); renderView(); toast('已保存');
  });
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
}

/* ---------- 今日打卡卡（概览页：只负责点圆圈打卡） ---------- */
const HAB_COLORS = [['var(--brand)','绿'],['var(--cat1)','蓝'],['var(--cat2)','橙'],['var(--cat3)','青']];
function habColorOptions(sel){
  return HAB_COLORS.map(([v,l]) => '<option value="' + v + '"' + (v===sel?' selected':'') + '>' + l + '</option>').join('');
}
function habitCardHTML(){
  const t = today();
  const rows = state.habits.length ? state.habits.map(h => {
    const done = !!h.done[t];
    const strk = habitStreak(h, t);
    return '<div class="lrow"><span class="thumb" style="background:' + h.color + ';font-size:16px">' + esc(h.icon) + '</span>' +
      '<div class="grow"><div class="b">' + esc(h.name) + '</div>' +
      '<div class="sub">' + (strk > 0 ? '🔥 连续 ' + strk + ' 天' : '今天还没打卡') + '</div></div>' +
      '<button class="hab-dot ' + (done ? 'on' : '') + '" data-hab="' + h.id + '" data-day="' + t + '" style="' + (done ? 'background:' + h.color + ';border-color:' + h.color + '' : '') + '" title="点击打卡">✓</button></div>';
  }).join('') : '';
  const body = rows || '<div class="empty" style="padding:14px 4px"><div class="e-ic">📌</div>还没有习惯<br><button class="btn primary sm mt" data-go2="settings">去「设置」页添加</button></div>';

  return '<div class="card"><h3>📌 今日打卡</h3>' + body + '</div>';
}
function bindHabitEvents(){
  const v = $('#view');
  $$('[data-hab]', v).forEach(btn => btn.addEventListener('click', () => {
    const h = state.habits.find(x => x.id === btn.dataset.hab);
    const d = btn.dataset.day;
    if(h.done[d]) delete h.done[d]; else h.done[d] = true;
    save(); renderView();
  }));
}
/* ---------- 打卡设置卡（设置页：只管理习惯的添加 / 修改 / 删除，打卡在概览页进行） ---------- */
function habitSettingsCardHTML(){
  const t = today();
  const rows = state.habits.length ? state.habits.map(h => {
    const doneCnt = Object.keys(h.done || {}).filter(d => h.done[d]).length;
    const strk = habitStreak(h, t);
    return '<div class="lrow"><div class="thumb" style="background:' + h.color + ';font-size:16px">' + esc(h.icon) + '</div>' +
      '<div class="grow"><div class="b">' + esc(h.name) + '</div>' +
      '<div class="sub">累计 ' + doneCnt + ' 天' + (strk > 0 ? ' · 连续 ' + strk + ' 天' : '') + '</div></div>' +
      '<button class="iconbtn2" data-edithab="' + h.id + '" style="width:26px;height:26px;font-size:12px;color:var(--ink-3);flex:0 0 auto" title="修改习惯">✎</button>' +
      '<button class="iconbtn2" data-delhab="' + h.id + '" style="width:26px;height:26px;font-size:12px;color:var(--danger);flex:0 0 auto" title="删除习惯">🗑</button></div>';
  }).join('')
    : '<div class="empty" style="padding:14px 4px"><div class="e-ic">📌</div>还没有习惯，点右上角「添加习惯」创建第一个</div>';
  return '<div class="card"><h3><span>📌 每日打卡</span><span class="grow"></span><button class="btn sm" id="hab_add_btn">添加习惯</button></h3>' + rows +
    '<div class="tiny muted mt">✎ 修改 · 🗑 删除；每天在概览页「今日打卡」点圆圈打卡。</div></div>';
}
function bindHabitSettings(){
  const v = $('#view');
  $$('[data-delhab]', v).forEach(btn => btn.addEventListener('click', () => {
    const h = state.habits.find(x => x.id === btn.dataset.delhab);
    if(!h) return;
    if(!confirm('删除习惯「' + h.name + '」？该习惯的全部打卡记录会一并删除（服务器同步清除），不可恢复。')) return;
    state.habits = state.habits.filter(x => x.id !== h.id); save(); renderView(); toast('已删除');
  }));
  $$('[data-edithab]', v).forEach(btn => btn.addEventListener('click', () => {
    const h = state.habits.find(x => x.id === btn.dataset.edithab); if(h) openHabitEditor(h);
  }));
  $('#hab_add_btn', v).addEventListener('click', openHabitAdder);
}
/* ---------- 添加新习惯（设置页弹窗） ---------- */
function openHabitAdder(){
  const html =
    '<div class="form-grid">' +
      '<div class="span2"><label>习惯名</label><input class="input" id="ha_name" maxlength="20" placeholder="如：不吃零食"></div>' +
      '<div><label>图标</label><input class="input" id="ha_icon" maxlength="2" value="✅"></div>' +
      '<div><label>颜色</label><select class="select" id="ha_color">' + habColorOptions('var(--brand)') + '</select></div>' +
    '</div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="ha_save">添加</button></div>';
  const dlg = showDialog('添加习惯', html);
  const b = dlg.box;
  $('#ha_save', b).addEventListener('click', () => {
    const name = $('#ha_name', b).value.trim(); if(!name){ toast('请填写习惯名', true); return; }
    state.habits.push({ id:uid(), name, icon: $('#ha_icon', b).value || '✅', color: $('#ha_color', b).value, done:{} });
    save(); closeDialog(); renderView(); toast('已添加');
  });
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
}
/* ---------- 修改已有习惯（设置页） ---------- */
function openHabitEditor(h){
  const html =
    '<div class="form-grid">' +
      '<div class="span2"><label>习惯名</label><input class="input" id="he_name" maxlength="20" value="' + esc(h.name) + '"></div>' +
      '<div><label>图标</label><input class="input" id="he_icon" maxlength="2" value="' + esc(h.icon) + '"></div>' +
      '<div><label>颜色</label><select class="select" id="he_color">' + habColorOptions(h.color) + '</select></div>' +
    '</div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="he_save">保存</button></div>';
  const dlg = showDialog('修改习惯', html);
  const b = dlg.box;
  $('#he_save', b).addEventListener('click', () => {
    const name = $('#he_name', b).value.trim(); if(!name){ toast('请填写习惯名', true); return; }
    h.name = name; h.icon = $('#he_icon', b).value || '✅'; h.color = $('#he_color', b).value;
    save(); closeDialog(); renderView(); toast('已保存');
  });
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
}
/* =====================================================
   SVG 图表工具
===================================================== */
const CX = { brand:'var(--brand)', c1:'var(--cat1)', c2:'var(--cat2)', c3:'var(--cat3)', grid:'var(--chart-grid)', ax:'var(--chart-ax)', ink3:'var(--ink-3)' };
function chartRange(vals){
  let mn = Math.min(...vals), mx = Math.max(...vals);
  const span = (mx - mn) || 1;
  mn -= span * 0.18; mx += span * 0.12;
  return { mn, mx };
}
function niceTicks(mn, mx, count){
  const span = mx - mn; if(!(span > 0)) return [mx];
  const rough = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  step *= mag;
  const start = Math.ceil(mn / step) * step;
  const arr = [];
  for(let v = start; v <= mx + 1e-9; v += step) arr.push(round(v, 6));
  return arr;
}
const CHART_W = 760, CHART_H = 238, P_L = 52, P_R = 18, P_T = 14, P_B = 34;
const PLOT_W = CHART_W - P_L - P_R, PLOT_H = CHART_H - P_T - P_B;
function xAt(i, n){ return n === 1 ? P_L + PLOT_W/2 : P_L + i/(n-1) * PLOT_W; }
function yAt(v, mn, mx){ return P_T + (1 - (v - mn)/(mx - mn)) * PLOT_H; }
function axisY(mn, mx, tickFmt){
  let s = '';
  const ticks = niceTicks(mn, mx, 4);
  ticks.forEach(tk => {
    const yy = yAt(tk, mn, mx);
    s += '<line x1="' + P_L + '" y1="' + yy + '" x2="' + (CHART_W - P_R) + '" y2="' + yy + '" stroke="' + CX.grid + '" stroke-width="1"/>';
    s += '<text x="' + (P_L - 8) + '" y="' + (yy + 3.5) + '" text-anchor="end" font-size="11" fill="' + CX.ax + '">' + tickFmt(tk) + '</text>';
  });
  return s;
}
function xLabels(points, fmt){
  const n = points.length;
  const step = Math.max(1, Math.ceil(n / 6));
  let s = '';
  for(let i = 0; i < n; i += step){
    s += '<text x="' + xAt(i, n) + '" y="' + (CHART_H - 10) + '" text-anchor="middle" font-size="11" fill="' + CX.ax + '">' + esc(fmt(points[i].x)) + '</text>';
  }
  return s;
}

function lineChartSVG(o){
  const pts = o.points.filter(p => p.y !== null && p.y !== undefined && !isNaN(p.y));
  if(pts.length < 2){
    return '<div class="empty"><div class="e-ic">📈</div>数据不足，先积累一些记录吧</div>';
  }
  const ys = pts.map(p => p.y);
  let refY = null;
  if(o.ref && o.ref.y !== null && o.ref.y !== undefined){ ys.push(o.ref.y); refY = o.ref.y; }
  const { mn, mx } = chartRange(ys);
  const tf = o.fmtTick || (v => v >= 1000 ? (v/1000).toFixed(1) + 'k' : String(Math.round(v)));
  let s = '<svg viewBox="0 0 ' + CHART_W + ' ' + CHART_H + '" role="img" style="font-family:inherit">';
  s += axisY(mn, mx, tf);
  // x 轴
  s += '<line x1="' + P_L + '" y1="' + (CHART_H - P_B) + '" x2="' + (CHART_W - P_R) + '" y2="' + (CHART_H - P_B) + '" stroke="' + CX.ax + '" stroke-width="1"/>';
  // 参考线
  if(refY !== null){
    const yy = yAt(refY, mn, mx);
    s += '<line x1="' + P_L + '" y1="' + yy + '" x2="' + (CHART_W - P_R) + '" y2="' + yy + '" stroke="' + CX.ink3 + '" stroke-width="1.5" stroke-dasharray="5 4"/>';
    if(o.ref.label) s += '<text x="' + (CHART_W - P_R) + '" y="' + (yy - 5) + '" text-anchor="end" font-size="10.5" fill="' + CX.ink3 + '">' + esc(o.ref.label) + '</text>';
  }
  // 面积
  if(o.area){
    let d = 'M' + xAt(0, pts.length) + ' ' + yAt(pts[0].y, mn, mx);
    for(let i = 1; i < pts.length; i++) d += ' L' + xAt(i, pts.length) + ' ' + yAt(pts[i].y, mn, mx);
    d += ' L' + xAt(pts.length-1, pts.length) + ' ' + (CHART_H - P_B) + ' L' + xAt(0, pts.length) + ' ' + (CHART_H - P_B) + ' Z';
    s += '<path d="' + d + '" fill="' + o.color + '" opacity="0.12"/>';
  }
  // 折线
  let d = 'M' + xAt(0, pts.length) + ' ' + yAt(pts[0].y, mn, mx);
  for(let i = 1; i < pts.length; i++) d += ' L' + xAt(i, pts.length) + ' ' + yAt(pts[i].y, mn, mx);
  s += '<path d="' + d + '" fill="none" stroke="' + o.color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
  // 点
  pts.forEach((p, i) => {
    const px = xAt(i, pts.length), py = yAt(p.y, mn, mx);
    const label = (o.fmtVal || (v => String(Math.round(v))))(p.y);
    s += '<circle cx="' + px + '" cy="' + py + '" r="3" fill="' + o.color + '"><title>' + esc(p.x + ' · ' + label) + '</title></circle>';
    s += '<circle cx="' + px + '" cy="' + py + '" r="10" fill="transparent" style="pointer-events:all;cursor:crosshair"><title>' + esc(p.x + ' · ' + label) + '</title></circle>';
  });
  s += xLabels(pts, o.fmtX || (x => x));
  s += '</svg>';
  return s;
}

function barChartSVG(o){
  const pts = o.points.filter(p => p.y !== null && p.y !== undefined);
  if(!pts.length){ return '<div class="empty"><div class="e-ic">📊</div>暂无数据</div>'; }
  const maxV = Math.max(...pts.map(p => p.y), o.target || 0);
  const mx = maxV * 1.15 || 1;
  let s = '<svg viewBox="0 0 ' + CHART_W + ' ' + CHART_H + '" role="img">';
  s += axisY(0, mx, o.fmtTick || (v => v >= 1000 ? (v/1000).toFixed(1)+'k' : String(Math.round(v))));
  s += '<line x1="' + P_L + '" y1="' + (CHART_H - P_B) + '" x2="' + (CHART_W - P_R) + '" y2="' + (CHART_H - P_B) + '" stroke="' + CX.ax + '" stroke-width="1"/>';
  const n = pts.length;
  const step = Math.max(1, Math.ceil(n / 9));
  const bw = Math.min(22, PLOT_W / n * 0.62);
  pts.forEach((p, i) => {
    const cx = xAt(i, n);
    const h = (p.y / mx) * PLOT_H;
    const y0 = CHART_H - P_B;
    const barW = Math.min(bw, 20);
    s += '<rect x="' + (cx - barW/2) + '" y="' + (y0 - h) + '" width="' + barW + '" height="' + Math.max(h, p.y>0?2:0) + '" rx="3" fill="' + o.color + '">' +
      '<title>' + esc(p.tip || (p.x + ' · ' + (o.fmtVal || (v=>String(Math.round(v))))(p.y))) + '</title></rect>';
    if(i % step === 0) s += '<text x="' + cx + '" y="' + (CHART_H - 10) + '" text-anchor="middle" font-size="10.5" fill="' + CX.ax + '">' + esc((o.fmtX || (x=>x))(p.x, p)) + '</text>';   /* 第二参传整点，周图等需要 p.wk */
  });
  if(o.target){
    const yy = yAt(o.target, 0, mx);
    s += '<line x1="' + P_L + '" y1="' + yy + '" x2="' + (CHART_W - P_R) + '" y2="' + yy + '" stroke="' + CX.ink3 + '" stroke-width="1.5" stroke-dasharray="5 4"/>';
    if(o.targetLabel) s += '<text x="' + (CHART_W - P_R) + '" y="' + (yy - 5) + '" text-anchor="end" font-size="10.5" fill="' + CX.ink3 + '">' + esc(o.targetLabel) + '</text>';
  }
  s += '</svg>';
  return s;
}

function groupedBarSVG(o){
  // o.days: [date]; o.series: [{label,color,data:[]}]
  const n = o.days.length;
  if(!n){ return '<div class="empty"><div class="e-ic">📊</div>暂无数据</div>'; }
  const maxV = Math.max(1, ...o.series.flatMap(se => se.data));
  const mx = maxV * 1.15;
  let s = '<svg viewBox="0 0 ' + CHART_W + ' ' + CHART_H + '" role="img">';
  s += axisY(0, mx, o.fmtTick || (v => String(Math.round(v))));
  s += '<line x1="' + P_L + '" y1="' + (CHART_H - P_B) + '" x2="' + (CHART_W - P_R) + '" y2="' + (CHART_H - P_B) + '" stroke="' + CX.ax + '" stroke-width="1"/>';
  const m = o.series.length;
  const step = Math.max(1, Math.ceil(n / 9));
  const groupW = Math.min(46, PLOT_W / n * 0.8);
  const barW = groupW * 0.8 / m;
  o.days.forEach((d, i) => {
    const gx = xAt(i, n);
    o.series.forEach((se, j) => {
      const v = se.data[i] || 0;
      const h = (v / mx) * PLOT_H;
      const bx = gx - groupW/2 + j * barW + (barW * 0.1);
      s += '<rect x="' + bx + '" y="' + (CHART_H - P_B - h) + '" width="' + (barW*0.8) + '" height="' + Math.max(h, v>0?2:0) + '" rx="2.5" fill="' + se.color + '">' +
        '<title>' + esc(d + ' ' + se.label + ' ' + (o.fmtVal ? o.fmtVal(v) : String(Math.round(v)))) + '</title></rect>';
    });
    if(i % step === 0) s += '<text x="' + gx + '" y="' + (CHART_H - 10) + '" text-anchor="middle" font-size="10.5" fill="' + CX.ax + '">' + esc((o.fmtX || (x=>x))(d)) + '</text>';
  });
  s += '</svg>';
  return s;
}
function legendHTML(items){
  return '<div class="legend">' + items.map(it => '<span class="li"><span class="sw" style="background:' + it.color + '"></span>' + esc(it.label) + '</span>').join('') + '</div>';
}
function chartWrap(title, sub, id, controls){
  return '<div class="chart-card" style="margin-bottom:16px"><div class="cc-h"><div><div class="cc-t">' + esc(title) + '</div>' + (sub ? '<div class="cc-s">' + esc(sub) + '</div>' : '') + '</div>' + (controls||'') + '</div>' + (controls&&title===''?'': '') + '<div id="' + id + '"></div></div>';
}

/* =====================================================
   历史页（统计看板）
===================================================== */
function statSummary(){
  const d30 = lastNDates(30);
  // 平均摄入（有记录的日期）
  let kcalSum = 0, kcalCnt = 0;
  let waterSum = 0, waterCnt = 0, sleepSum = 0, sleepCnt = 0;
  d30.forEach(x => {
    const kc = dayTotals(x).kcal;
    if(kc > 0){ kcalSum += kc; kcalCnt++; }
    if(waterFor(x) > 0){ waterSum += waterFor(x); waterCnt++; }
    const mins = sleepTotalMins(x); if(mins > 0){ sleepSum += mins; sleepCnt++; }   // 全天各段总时长
  });
  const wk30 = state.workouts.filter(w => isDone(w) && w.date >= d30[0] && w.date <= today()).length;   /* 只算已完成的记录，未来的计划不进统计 */
  const wNow = latestVal('weight');
  const w30 = bodyVal('weight', d30[0]);
  let wDelta = null, wDeltaCls = '';
  if(wNow !== null && w30 !== null){ wDelta = wNow - w30; wDeltaCls = wDelta > 0 ? 'up' : (wDelta < 0 ? 'down' : ''); }
  // 近30天习惯完成率
  let done30 = 0, tot30 = 0;
  lastNDates(30).forEach(d => state.habits.forEach(h => { tot30++; if(h.done[d]) done30++; }));
  return {
    avgKcal: kcalCnt ? Math.round(kcalSum/kcalCnt) : null,
    wk30, wDelta, wDeltaCls,
    avgSleep: sleepCnt ? Math.round(sleepSum/sleepCnt/60*10)/10 : null,
    avgWater: waterCnt ? Math.round(waterSum/waterCnt*10)/10 : null,
    habitRate: tot30 ? Math.round(done30/tot30*100) : null,
  };
}
function renderStats(){
  const S = statSummary();
  const T = target();
  const tiles =
    tileHTML('近30天平均摄入', S.avgKcal === null ? '--' : fmtNum(S.avgKcal), 'kcal', '目标 ' + fmtNum(T.kcal), '') +
    tileHTML('运动次数(30天)', S.wk30, '次', '') +
    tileHTML('体重变化(30天)', wDeltaText(S), '', '') +
    tileHTML('平均睡眠(30天)', S.avgSleep === null ? '--' : S.avgSleep, 'h', '');
  const tiles2 =
    tileHTML('平均饮水(30天)', S.avgWater === null ? '--' : S.avgWater, '杯', '') +
    tileHTML('打卡完成率(30天)', S.habitRate === null ? '--' : S.habitRate + '%', '', '');

  // 图表容器
  const c1 = chartWrap('体重趋势', '近120条记录', 'st_weight', '');
  const c2 = chartWrap('每日热量 vs 目标', '近30天', 'st_cal', '');
  const c3 = chartWrap('宏量营养素摄入', '近14天 · kcal', 'st_macro', legendHTML([{label:'蛋白',color:CX.c1},{label:'碳水',color:CX.c2},{label:'脂肪',color:CX.c3}]));
  const c4 = chartWrap('每周运动容量', '近12周 · Σ重量×次数', 'st_vol', '');
  const c4b = chartWrap('每周运动时长', '近12周 · Σ分钟（当周有距离时显示在悬停提示里）', 'st_mins', '');
  const c5 = chartWrap('睡眠时长', '近30天 · 虚线为目标 10 小时', 'st_sleep', '<button class="btn sm ghost" data-slehis title="补记/修改历史睡眠记录">🕘 补记</button>');
  const c6 = chartWrap('每日饮水量', state.waterTarget ? '近30天 · 虚线为每日目标' : '近30天', 'st_water', '<button class="btn sm ghost" data-watshis title="补记/修改历史饮水记录">🕘 补记</button>');

  const html =
    '<div class="row">' + tiles + '</div>' +
    '<div class="row mt">' + tiles2 + '</div>' +
    '<div class="mt">' + c1 + '</div>' +
    '<div class="grid cols-2">' + c2 + '</div>' +
    '<div>' + c3 + '</div>' +
    '<div>' + c4 + '</div>' +
    '<div>' + c4b + '</div>' +
    '<div>' + c5 + '</div>' +
    '<div>' + c6 + '</div>';

  $('#view').innerHTML = html;

  // 睡眠/饮水历史补记入口（原在概览页「今日」卡上，移至历史页）
  const wh = $('#view [data-watshis]'); if(wh) wh.addEventListener('click', openWaterHistory);
  const sh = $('#view [data-slehis]'); if(sh) sh.addEventListener('click', openSleepHistory);

  // 体重图
  const wRecs = state.body.filter(r => r.weight !== undefined && r.weight !== null);
  const wPts = wRecs.slice(Math.max(0, wRecs.length - 120)).map(r => ({ x:r.date, y:r.weight }));
  $('#st_weight').innerHTML = lineChartSVG({
    points: wPts, color: CX.brand, area: true,
    fmtTick: v => v.toFixed(1), fmtVal: v => v.toFixed(1) + ' kg', fmtX: dateSlash,
  });

  // 热量图
  const d30 = lastNDates(30);
  const calPts = d30.map(d => ({ x:d, y: dayTotals(d).kcal }));
  $('#st_cal').innerHTML = lineChartSVG({
    points: calPts, color: CX.c2, area: true,
    ref: { y: T.kcal, label: '目标 ' + T.kcal },
    fmtTick: v => v >= 1000 ? (v/1000).toFixed(1) + 'k' : String(v),
    fmtVal: v => v + ' kcal', fmtX: dateSlash,
  });

  // 宏量营养素分组柱（kcal 贡献）
  const d14 = lastNDates(14);
  const gP = [], gC = [], gF = [];
  d14.forEach(d => { const t0 = dayTotals(d); gP.push(round(t0.p*4,0)); gC.push(round(t0.c*4,0)); gF.push(round(t0.f*9,0)); });
  $('#st_macro').innerHTML = groupedBarSVG({
    days: d14,
    series: [{label:'蛋白', color:CX.c1, data:gP},{label:'碳水', color:CX.c2, data:gC},{label:'脂肪', color:CX.c3, data:gF}],
    fmtTick: v => v >= 1000 ? (v/1000).toFixed(1)+'k' : String(v),
    fmtVal: v => v + ' kcal', fmtX: dateSlash,
  });

  // 每周训练容量
  const vol = weeklyVolumes(12);
  $('#st_vol').innerHTML = barChartSVG({
    points: vol, color: CX.c3,
    fmtTick: v => v >= 1000 ? (v/1000).toFixed(1)+'k' : String(v),
    fmtVal: v => v + ' kg', fmtX: (d, p) => p.wk,
  });

  // 每周运动时长（柱 = Σ分钟；计时段不进容量图，两张口径互不污染）
  const wmins = weeklyMinutes(12), wkms = weeklyDistances(12);
  wmins.forEach((p, i) => { const k = wkms[i] && wkms[i].y; if(k) p.tip = p.x + ' · ' + p.y + ' 分钟 · ' + k + ' km'; });
  $('#st_mins').innerHTML = barChartSVG({
    points: wmins, color: CX.c2,
    fmtVal: v => v + ' 分钟', fmtX: (d, p) => p.wk,
  });

  // 睡眠时长 & 每日饮水
  renderSleepChart();
  renderWaterChart();
}
function wDeltaText(S){
  if(S.wDelta === null) return '';
  return (S.wDelta > 0 ? '+' : '') + round(S.wDelta, 1) + ' kg';
}
function mondayOf(s){ return addDays(s, -((weekday(s)+6)%7)); }
function weeklySeries(weeks, fn, keep2){
  const out = [];
  const curMonday = mondayOf(today());
  for(let k = weeks - 1; k >= 0; k--){
    const ws = addDays(curMonday, -7*k);
    const we = addDays(ws, 7);
    let v = 0;
    state.workouts.forEach(w => { if(!isDone(w)) return; if(w.date >= ws && w.date < we) v += fn(w); });
    out.push({ x: ws, y: keep2 ? Math.round(v*100)/100 : Math.round(v), wk: 'W' + (weeks - k) });
  }
  return out;
}
function weeklyVolumes(weeks){ return weeklySeries(weeks, wkVolume); }
function weeklyMinutes(weeks){ return weeklySeries(weeks, wkMinutes); }
function weeklyDistances(weeks){ return weeklySeries(weeks, wkDistance, true); }

/* =====================================================
   启动
===================================================== */
/* =====================================================
   登录门(v4 鉴权)
===================================================== */
async function apiMe(){
  try {
    const r = await srvFetch('/me', { method: 'GET' }, 3000);
    if(r.status === 401){ me = null; return 'anon'; }
    if(!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    me = j;                                  /* {username, role, user:{id, name, …}} */
    localStorage.setItem(AUTH_KEY, j.username);
    localStorage.setItem(AUTH_ROLE_KEY, j.role);
    return 'authed';
  } catch(e){ return 'offline'; }
}
function showAuth(offlineNote){
  hideAuth();
  const el = document.createElement('div');
  el.id = 'authgate'; el.className = 'authgate';
  el.innerHTML =
    '<div class="auth-card">' +
      '<div class="auth-logo"><div class="logo">💪</div>健康管理</div>' +
      '<div class="auth-sub">登录你的账户 · 数据只属于你，其他账户互不可见</div>' +
      '<div class="auth-seg"><button data-m="login" class="active">登录</button><button data-m="reg">注册新账户</button></div>' +
      '<div class="field"><label>用户名</label><input class="input" id="ag_u" autocomplete="username" placeholder="字母/数字/下划线，2-32 位"></div>' +
      '<div class="field hidden" id="ag_namewrap"><label>昵称</label><input class="input" id="ag_n" placeholder="显示用的名字，如：小陈"></div>' +
      '<div class="field"><label>密码</label><input class="input" id="ag_p" type="password" autocomplete="current-password" placeholder="至少 6 位"></div>' +
      '<button class="btn primary block" id="ag_go">登录</button>' +
      '<div class="auth-err" id="ag_err"></div>' +
      (offlineNote ? '<div class="auth-note">' + esc(offlineNote) + '</div>' : '') +
    '</div>';
  document.body.appendChild(el);
  const setErr = m => { $('#ag_err', el).textContent = m || ''; };
  let mode = 'login';
  $$('.auth-seg button', el).forEach(btn => btn.addEventListener('click', () => {
    mode = btn.dataset.m;
    $$('.auth-seg button', el).forEach(x => x.classList.toggle('active', x === btn));
    $('#ag_namewrap', el).classList.toggle('hidden', mode !== 'reg');
    $('#ag_go', el).textContent = mode === 'reg' ? '注册并进入' : '登录';
    $('#ag_p', el).autocomplete = mode === 'reg' ? 'new-password' : 'current-password';
    setErr('');
  }));
  const submit = async () => {
    setErr('');
    const username = $('#ag_u', el).value.trim();
    const password = $('#ag_p', el).value;
    const name = $('#ag_n', el).value.trim();
    if(!username || !password){ setErr('请填写用户名与密码'); return; }
    let r, j = {};
    try {
      r = await fetch('/api/' + (mode === 'reg' ? 'register' : 'login'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'reg' ? { username, password, name } : { username, password }),
      });
      try { j = await r.json(); } catch(e){}
    } catch(e){ setErr('连不上服务器：请确认电脑上的服务窗口已开启'); return; }
    if(r.status === 401){ setErr(mode === 'reg' ? '注册失败：请检查填写内容' : '用户名或密码不正确'); return; }
    if(r.status === 409){ setErr('该用户名已被占用，换一个'); return; }
    if(!r.ok){ setErr((j && j.message) || '失败（HTTP ' + r.status + '）'); return; }
    me = { username: j.username, role: j.role, user: null };
    localStorage.setItem(AUTH_KEY, j.username);
    localStorage.setItem(AUTH_ROLE_KEY, j.role);
    hideAuth();
    await startMain();
  };
  $('#ag_go', el).addEventListener('click', submit);
  ['ag_u', 'ag_n', 'ag_p'].forEach(id => { const i = $('#' + id, el); if(i) i.addEventListener('keydown', e => { if(e.key === 'Enter') submit(); }); });
  $('#ag_u', el).focus();
}
function hideAuth(){ const el = document.getElementById('authgate'); if(el) el.remove(); }

/* 按需注入 js/dev.js（classic script）。只加载一次，结果缓存在 window.__devHooks。 */
let devLoading = null;
function loadDev(){
  if(window.__devHooks) return Promise.resolve(window.__devHooks);
  if(devLoading) return devLoading;
  devLoading = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'js/dev.js';
    s.onload = () => resolve(window.__devHooks || null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return devLoading;
}

async function startMain(offlineBoot){
  await load();
  rebuildNav();
  const qs = new URLSearchParams(location.search);
  const shotView = qs.get('shot');
  /* 调试钩子按需加载（v4.16）：只有 ?probe/?selftest/?ftest/?shot 才注入 js/dev.js，
   * 演示数据与自测代码都不在用户路径上。dev.js 是 classic script（与 app.js 同一全局作用域，
   * 才读写得到 USERS/state 这些顶层 let）。拉不到（离线/被删）就剥掉钩子按真实数据进入。 */
  const devUrl = qs.has('probe') || qs.has('selftest') || qs.has('ftest') || shotView !== null;
  if(devUrl){
    const dev = await loadDev();
    if(dev && dev.handle(qs, { offlineBoot: !!offlineBoot, shotView: shotView })) return;
    history.replaceState(null, '', location.pathname);
  }
  if(offlineBoot){ srv.online = false; toast('服务器离线：正显示本机缓存，恢复后自动补同步', true); }
  if(!USERS.onboarded){ showOnboard(); }
  go(readView());
}
async function init(){
  const st = await apiMe();
  if(st === 'authed'){ startMain(); return; }
  if(st === 'anon'){ showAuth(); return; }
  /* 服务器不可达：有上次登录的账户与缓存 → 离线模式；否则只能登录页提示 */
  const cached = localStorage.getItem(AUTH_KEY);
  if(cached){
    me = { username: cached, role: localStorage.getItem(AUTH_ROLE_KEY) || 'user', user: null };
    startMain(true);
  } else {
    showAuth('连不上服务器：请确认电脑上的服务窗口已开启，登录/注册需要服务器在线');
  }
}
bindPullToRefresh();   /* 脚本在 </body> 前、<main> 之后加载，元素已就位 */
init();
