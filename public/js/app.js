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
function metaGet(){ try { return JSON.parse(localStorage.getItem(metaKey())); } catch(e){ return null; } }
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
const NAV = [
  {id:'home',  label:'概览',    ic:'🏠'},
  {id:'diet',  label:'饮食',    ic:'🍽️'},
  {id:'train', label:'训练',    ic:'🏋️'},
  {id:'body',  label:'身体',    ic:'📏'},
  {id:'goals', label:'目标',ic:'🎯'},
  {id:'stats', label:'统计',    ic:'📊'},
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
const SEED_FOODS = [
  {name:'米饭', per100:{kcal:116, p:2.6, c:25.9, f:0.3}},
  {name:'鸡胸肉', per100:{kcal:118, p:22, c:0.6, f:3}},
  {name:'鸡蛋', per100:{kcal:143, p:12.6, c:0.9, f:9.5}},
  {name:'牛奶', per100:{kcal:65, p:3.3, c:4.9, f:3.6}},
  {name:'全麦面包', per100:{kcal:246, p:11, c:44, f:4}},
  {name:'燕麦片', per100:{kcal:367, p:13, c:61, f:7}},
  {name:'红薯', per100:{kcal:86, p:1.6, c:20, f:0.2}},
  {name:'香蕉', per100:{kcal:93, p:1.4, c:22, f:0.2}},
  {name:'苹果', per100:{kcal:53, p:0.4, c:13.7, f:0.2}},
  {name:'西兰花', per100:{kcal:34, p:2.8, c:4.3, f:0.4}},
  {name:'三文鱼', per100:{kcal:139, p:17.2, c:0, f:7.3}},
  {name:'瘦牛肉', per100:{kcal:125, p:20, c:0, f:4.6}},
  {name:'花生酱', per100:{kcal:600, p:25, c:20, f:50}},
  {name:'乳清蛋白粉', per100:{kcal:400, p:80, c:6, f:7}},
];
const SEED_EXERCISES = [
  {name:'杠铃卧推', muscle:'胸'}, {name:'上斜哑铃卧推', muscle:'胸'}, {name:'哑铃飞鸟', muscle:'胸'},
  {name:'引体向上', muscle:'背'}, {name:'杠铃划船', muscle:'背'}, {name:'高位下拉', muscle:'背'}, {name:'坐姿划船', muscle:'背'},
  {name:'杠铃深蹲', muscle:'腿'}, {name:'腿举', muscle:'腿'}, {name:'罗马尼亚硬拉', muscle:'腿'}, {name:'箭步蹲', muscle:'腿'},
  {name:'站姿推举', muscle:'肩'}, {name:'哑铃侧平举', muscle:'肩'},
  {name:'哑铃二头弯举', muscle:'手臂'}, {name:'绳索三头下压', muscle:'手臂'},
  {name:'平板支撑', muscle:'核心'}, {name:'悬垂举腿', muscle:'核心'},
  {name:'跑步机慢跑', muscle:'有氧'},
];
const MUSCLES = ['胸','背','腿','肩','手臂','核心','有氧','其他'];

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
const DATA_FIELDS = ['profile','goal','activity','waterTarget','nutrition','meals','plans','workouts','body','habits','sleep','water'];

function seedFoodArr(){ return SEED_FOODS.map((f,i)=>({id:'f'+i, name:f.name, per100:Object.assign({}, f.per100)})); }
function seedExArr(){ return SEED_EXERCISES.map((e,i)=>({id:'e'+i, name:e.name, muscle:e.muscle})); }
function freshShared(){ return { foods: seedFoodArr(), exercises: seedExArr() }; }
function defaultHabits(){ return [
  {id:'h_water', name:'饮水达标', icon:'💧', color:'var(--cat1)', done:{}},
  {id:'h_work',  name:'完成训练', icon:'🏋️', color:'var(--cat2)', done:{}},
  {id:'h_sleep', name:'睡满7小时',icon:'😴', color:'var(--cat3)', done:{}},
  {id:'h_stretch',name:'拉伸放松', icon:'🧘', color:'var(--brand)', done:{}},
]; }
function freshUserData(){
  return {
    profile:{ gender:'male', birthYear:1992, height:175, currentKg:72 },
    goal:{ mode:'cut', startKg:null, targetKg:66, targetDate:addDays(today(), 120), note:'' },
    activity:1.375,
    nutrition:{ auto:true, kcal:null, protein:null, carbs:null, fat:null },
    waterTarget:8,
    meals:{},
    plans:{},
    workouts:[],
    body:[],
    habits: defaultHabits(),
    sleep:{},
    water:{},
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
function ensureUserIntact(u){
  DATA_FIELDS.forEach(k => { if(u[k] === undefined) Object.assign(u, freshUserData()); });
  if(u.meals === undefined) u.meals = {};
  if(u.sleep === undefined) u.sleep = {};
  if(u.water === undefined) u.water = {};
  if(u.habits === undefined || !u.habits.length) u.habits = defaultHabits();
  if(!u.color) u.color = 'green';
  if(!u.avatar) u.avatar = '🙂';
  if(!u.name) u.name = '未命名';
}
function adoptRaw(raw){
  if(raw && raw.users && raw.shared){
    USERS = raw;
    USERS.shared.foods = (USERS.shared.foods && USERS.shared.foods.length) ? USERS.shared.foods : seedFoodArr();
    USERS.shared.exercises = (USERS.shared.exercises && USERS.shared.exercises.length) ? USERS.shared.exercises : seedExArr();
    Object.keys(USERS.users).forEach(id => ensureUserIntact(USERS.users[id]));
    if(!USERS.users[USERS.active]) USERS.active = Object.keys(USERS.users)[0] || null;
    return true;
  }
  if(raw && raw.profile){
    // —— 旧版单用户自动迁移：把老数据归入成员「我」，食物/动作库转共享库 ——
    USERS = { theme: raw.theme || 'light', onboarded: !!raw.onboarded, shared: freshShared(), users:{}, active:null };
    const u = newUser('我', '🙂', 'green');
    DATA_FIELDS.forEach(k => { if(raw[k] !== undefined) u[k] = raw[k]; });
    if(raw.foods && raw.foods.length) USERS.shared.foods = raw.foods;
    if(raw.exercises && raw.exercises.length) USERS.shared.exercises = raw.exercises;
    ensureUserIntact(u);
    USERS.users[u.id] = u; USERS.active = u.id;
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
   *   服务器 rev 未动 → 直接补推本机；rev 动了 → 弹窗人工裁决，绝不静默覆盖任何一边。 */
  const remote = await fetchState();
  if(remote){
    const meta = metaGet();
    if(remote.data && (!meta || !meta.dirty)){
      srv.rev = remote.rev;
      adoptRaw(remote.data);
      normalizeSelfTree();
      try { localStorage.setItem(storeKey(), JSON.stringify(USERS)); } catch(e){}  // 服务器数据回写本机缓存
      metaSet({ rev: remote.rev, dirty: false });
    } else {
      srv.rev = remote.rev;   // 服务器在线（含空库 rev=0 的首次上推场景）
      bootUsers();
      if(remote.data && meta && meta.dirty && meta.rev !== remote.rev){
        const useServer = confirm('检测到上次退出时有未同步到服务器的本机改动，而服务器上本账户又有更新的数据（其他设备写入）。\n\n【确定】用服务器数据刷新本机（本机未同步的改动会被放弃）\n【取消】用本机数据覆盖服务器（其他设备后写入的改动会丢失）');
        if(useServer){
          adoptRaw(remote.data);
          normalizeSelfTree();
          try { localStorage.setItem(storeKey(), JSON.stringify(USERS)); } catch(e){}
          metaSet({ rev: remote.rev, dirty: false });
          toast('已采用服务器数据');
        } else {
          metaSet({ rev: remote.rev, dirty: true });   /* 本机为准：下方 save() 会带着 rev 推送覆盖 */
          srv.blindNext = false;
          toast('将以本机数据覆盖服务器');
        }
      } else if(meta && meta.dirty){
        metaSet({ rev: remote.rev, dirty: true });     /* 服务器没动过：直接补推本机 */
      }
    }
  } else {
    bootUsers();   /* 完全离线：读本机缓存，dirty 状态原样保留，等下次在线裁决/补推 */
  }
  materialize(); applyTheme(); save();
}
function save(){
  if(state) persistActive();
  if(state && state.theme) USERS.theme = state.theme;
  try { localStorage.setItem(storeKey(), JSON.stringify(USERS)); }
  catch(e){ toast('保存失败：本地存储空间不足', true); }
  const meta = metaGet() || { rev: null, dirty: false };
  meta.dirty = true;   /* 有未推送改动；doPush 成功后清零 */
  metaSet(meta);
  queuePush();   // 落盘后 600ms 防抖推送服务器
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
const srv = { online: null, rev: null, lastSync: null, pushTimer: null, retryTimer: null, blindNext: false, fatal: false };

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
    srv.online = false;
    return null;
  }
}
/* 会话失效(401):停同步、清工作区、弹登录门(不 reload,留给同页重登) */
function authExpired(){
  if(srv.pushTimer){ clearTimeout(srv.pushTimer); srv.pushTimer = null; }
  if(srv.retryTimer){ clearTimeout(srv.retryTimer); srv.retryTimer = null; }
  srv.online = null; srv.rev = null; srv.blindNext = false; srv.lastSync = null;
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
async function doPush(){
  if(srv.fatal) return;
  if(srv.rev === null && !srv.blindNext){        /* 离线状态下发生首推：先向服务器取当前版本号 */
    const fresh = await fetchState();
    if(!fresh){ scheduleRetry(); return; }
    srv.rev = fresh.rev;
  }
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
  if(!r.ok){ srv.fatal = true; toast('服务器拒绝了同步（HTTP ' + r.status + '），本机改动仍保存在本地', true); refreshSyncStatus(); return; }
  const j = await r.json().catch(() => ({}));
  if(typeof j.rev === 'number'){
    srv.rev = j.rev;
    metaSet({ rev: j.rev, dirty: false });   /* 推送成功 = 本机与服务器对齐 */
  }
  srv.blindNext = false;
  srv.online = true;
  srv.lastSync = new Date();
  refreshSyncStatus();
}
async function handleConflict(){
  /* rev 落后 = 本账户的另一台设备先完成了同步。两种走向都明示，绝不静默丢数据 */
  const useServer = confirm('服务器上（本账户的其他设备）有更新的数据。\n\n【确定】用服务器数据刷新本机（本机未同步的改动会被放弃）\n【取消】用本机数据覆盖服务器（其他设备后写入的改动会丢失）');
  if(useServer){
    const fresh = await fetchState();
    if(fresh && fresh.data && adoptRaw(fresh.data)){
      srv.rev = fresh.rev;
      normalizeSelfTree();
      materialize(); applyTheme();
      try { localStorage.setItem(storeKey(), JSON.stringify(USERS)); } catch(e){}
      metaSet({ rev: fresh.rev, dirty: false });   /* 采用服务器 = 已对齐 */
      go(curView);
      toast('已更新为服务器最新数据');
    } else if(fresh){
      srv.rev = fresh.rev;
    }
  } else {
    srv.blindNext = true;                        /* 下一次推送不带 rev，盲写覆盖 */
    queuePush();
  }
  refreshSyncStatus();
}
function scheduleRetry(){
  if(srv.retryTimer) return;
  srv.retryTimer = setTimeout(() => { srv.retryTimer = null; queuePush(); }, 30000);
}
function syncStatusText(){
  if(srv.fatal) return '🔴 同步被服务器拒绝（本机改动已存本地），重启应用可重试';
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
  let adj = 0;
  if(u.goal.mode === 'cut') adj = -400;
  else if(u.goal.mode === 'bulk') adj = 300;
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
function target(){ syncNutrition(); return { kcal:state.nutrition.kcal||2000, p:state.nutrition.protein||120, c:state.nutrition.carbs||200, f:state.nutrition.fat||55 }; }

/* ---------- 饮食数据辅助 ---------- */
function mkFood(id){ return state.foods.find(f => f.id === id); }
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
function dayCount(date){ return SLOTS.reduce((n,s)=> n + dayMeals(date)[s.id].length, 0); }

/* ---------- 训练数据辅助 ---------- */
function exName(exId){ const e = state.exercises.find(x => x.id === exId); return e ? e.name : (exId||'动作'); }
function planForDate(date){ return state.plans[String(weekday(date))] || null; }
function planLabel(dow){ return '周' + DAY_CN[dow]; }
function exHistory(exId){
  // 返回该动作的所有历史记录条目（不含某次之前的比较在此单独做）
  const out = [];
  state.workouts.forEach(w => w.items.forEach(it => { if(it.exId === exId) out.push({date:w.date, sets:it.sets}); }));
  return out;
}
function bestOfSets(sets){ let bestW=0, best1rm=0, bestReps=0, bestWReps=0;
  sets.forEach(s=>{ if(!s.weight) return;
    if(s.weight > bestW){ bestW=s.weight; bestWReps=s.reps||0; }
    const e1 = s.weight*(1+(s.reps||0)/30);
    if(e1 > best1rm) best1rm = e1;
  });
  return { weight:bestW, reps:bestWReps, rm1:round(best1rm,1) };
}
function isPR(exId, date, sets){
  // 判断本次是否刷新了该动作历史最大重量/估1RM（不算本次所在训练本身）
  const cur = bestOfSets(sets);
  let histBestW=0, histBest1rm=0;
  state.workouts.forEach(w => {
    if(w.date === date) return;
    w.items.forEach(it => { if(it.exId !== exId) return;
      const b = bestOfSets(it.sets); if(b.weight>histBestW) histBestW=b.weight; if(b.rm1>histBest1rm) histBest1rm=b.rm1;
    });
  });
  return { wPR: cur.weight > 0 && cur.weight > histBestW, rPR: cur.rm1 > 0 && cur.rm1 > histBest1rm };
}
function wkVolume(w){ let v=0; w.items.forEach(it => it.sets.forEach(s=> v += s.weight*s.reps)); return v; }

/* ---------- 身体数据辅助 ---------- */
function upsertBody(rec){
  const patch = {};
  ['weight','chest','waist','hip','arm','thigh','bf'].forEach(k => { if(rec[k] !== undefined && rec[k] !== '') patch[k] = num(rec[k]); });
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

/* ---------- 睡眠饮水辅助 ---------- */
function sleepFor(date){ return state.sleep[date] || null; }
function waterFor(date){ return state.water[date] || 0; }

/* ---------- 习惯辅助 ---------- */
function habitStreak(h, until){
  let d = until;
  if(!h.done[d]) d = addDays(d, -1);
  let n = 0;
  while(h.done[d]){ n++; d = addDays(d, -1); }
  return n;
}

/* ---------- 演示数据 ---------- */
function demoData(){
  USERS.onboarded = true;
  const t = today();
  if(!USERS.shared.foods || !USERS.shared.foods.length) USERS.shared.foods = seedFoodArr();
  if(!USERS.shared.exercises || !USERS.shared.exercises.length) USERS.shared.exercises = seedExArr();
  const foods = USERS.shared.foods, ex = USERS.shared.exercises;
  // 重置当前账户数据（保留名字/头像/颜色），灌入丰富演示数据
  const u = activeUser();
  Object.assign(u, freshUserData());
  seedRichMember(u, t, foods, ex);
  materialize();
  USERS.theme = state.theme;
  save(); go('home');
  toast('已载入演示数据');
}
function seedRichMember(u, t, foods, ex){
  const p = u.profile;
  p.currentKg = 71.2; p.height = 175; p.birthYear = 1992;
  u.goal = { mode:'cut', startKg:71.2, targetKg:66, targetDate:addDays(t, 100), note:'为夏天做准备，每周约0.4kg' };
  u.activity = 1.375; u.waterTarget = 8;
  u.nutrition = calcNutritionFor(u);
  // 体重/围度：从 ~120 天前缓慢下降，围度每周一次
  let prev = 78.6;
  for(let i = 120; i >= 0; i -= 3){
    prev = round(prev + (Math.random() - 0.52) * 0.5, 1);
    prev = Math.min(79.4, Math.max(69.5, prev));
    u.body.push({ date: addDays(t, -i), weight: prev });
  }
  let waist = 88, chest = 100;
  for(let i = 119; i >= 0; i -= 7){
    waist = round(waist - (Math.random()*0.6 + 0.1), 1); waist = Math.max(80, waist);
    chest = round(chest + (Math.random()*0.3 - 0.05), 1); chest = Math.min(103, chest);
    u.body.push({ date: addDays(t, -i), waist, chest });
  }
  const lb1 = u.body[u.body.length-1];
  upsertOn(lb1, { weight:71.2, chest:round(chest,1), waist:round(waist,1), hip:round(waist*1.08,1), arm:33, thigh:56 });
  // 饮食：近 14 天
  const grams = { 米饭:180, 鸡胸肉:150, 鸡蛋:150, 牛奶:250, 全麦面包:120, 燕麦片:60, 红薯:200, 香蕉:100, 苹果:150, 西兰花:150, 三文鱼:120, 瘦牛肉:150, 花生酱:20, 乳清蛋白粉:30 };
  for(let i = 13; i >= 0; i--){
    const d = addDays(t, -i);
    u.meals[d] = { breakfast:[], lunch:[], dinner:[], snack:[] };
    const plan = [
      {slot:'breakfast', fs:['燕麦片','牛奶','香蕉','鸡蛋']},
      {slot:'lunch', fs:['米饭','鸡胸肉','西兰花','鸡蛋']},
      {slot:'dinner', fs:['红薯','三文鱼','西兰花']},
    ];
    plan.forEach(gp => {
      const cnt = 2 + Math.floor(Math.random()*2);
      for(let k=0; k<cnt; k++){
        const nm = gp.fs[Math.floor(Math.random()*gp.fs.length)];
        const fo = foods.find(x => x.name === nm);
        if(!fo) continue;
        u.meals[d][gp.slot].push(mealItem(fo, (grams[nm] || 100) * (0.7 + Math.random()*0.7)));
      }
    });
  }
  // 训练计划：周一推 / 周三拉 / 周五腿
  const pushPlan = [['杠铃卧推',4,8,70],['哑铃飞鸟',3,12,12],['坐姿划船',3,10,45]];
  const pullPlan = [['引体向上',4,8,0],['杠铃划船',4,10,60],['哑铃二头弯举',3,12,14]];
  const legPlan  = [['杠铃深蹲',4,8,90],['腿举',3,12,140],['罗马尼亚硬拉',3,10,80]];
  const toItems = list => list.map(([nm,sets,reps,weight]) => {
    const e = ex.find(x => x.name === nm);
    return { id:uid(), exId:e.id, exName:e.name, muscle:e.muscle, sets, reps, weight };
  });
  u.plans['1'] = { id:uid(), name:'推日', items:toItems(pushPlan) };
  u.plans['3'] = { id:uid(), name:'拉日', items:toItems(pullPlan) };
  u.plans['5'] = { id:uid(), name:'腿日', items:toItems(legPlan) };
  // 训练日志：近 10 周 每周一三五，重量渐增
  const cycles = [
    {name:'推日 · 胸部', items:[['杠铃卧推',70,60],['哑铃飞鸟',12,10],['坐姿划船',45,50]]},
    {name:'拉日 · 背部', items:[['引体向上',0,8],['杠铃划船',60,55],['哑铃二头弯举',14,12]]},
    {name:'腿日 · 下肢', items:[['杠铃深蹲',90,80],['腿举',140,130],['罗马尼亚硬拉',80,75]]},
  ];
  let cursor = addDays(t, -69);
  while(cursor <= t){
    if([1,3,5].indexOf(weekday(cursor)) >= 0){
      const ci = [1,3,5].indexOf(weekday(cursor));
      const items = cycles[ci].items.map(([nm, baseW, baseRm]) => {
        const e = ex.find(x => x.name === nm);
        const prog = Math.floor((parseISO(t) - parseISO(cursor)) / (1000*60*60*24*14));
        const w = Math.max(0, Math.round(baseW + prog * 2 + Math.random()*2));
        const reps = baseRm + Math.floor(Math.random()*3);
        const sets = [];
        for(let i2=0;i2<3;i2++){ sets.push({ reps: reps + Math.floor(Math.random()*2)-1, weight: w }); }
        return { id:uid(), exId:e.id, exName:e.name, muscle:e.muscle, sets };
      });
      u.workouts.push({ id:uid(), date:cursor, name:cycles[ci].name, items, note:'' });
    }
    cursor = addDays(cursor, 1);
  }
  // 睡眠 30 天 + 饮水 14 天 + 习惯
  for(let i = 29; i >= 0; i--){
    const d = addDays(t, -i);
    const mins = Math.round(390 + Math.random()*110);
    u.sleep[d] = { bed:'23:'+String(Math.floor(Math.random()*3)).padStart(2,'0'), wake:'07:'+String(Math.floor(Math.random()*5)).padStart(2,'0'), mins, quality: Math.random()<0.6 ? 4 : (Math.random()<0.5?3:5) };
  }
  for(let i = 13; i >= 0; i--){ u.water[addDays(t, -i)] = Math.round(4 + Math.random()*6); }
  u.habits.forEach((h, hi) => {
    for(let i = 0; i < 30; i++){
      const d = addDays(t, -i);
      if(hi === 1){ if([1,3,5].indexOf(weekday(d)) >= 0) h.done[d] = true; }
      else if(Math.random() < 0.82) h.done[d] = true;
    }
  });
  u.body.sort((a,b) => a.date < b.date ? -1 : 1);
  u.workouts.sort((a,b) => a.date < b.date ? -1 : 1);
}
function upsertOn(existing, patch){
  Object.keys(patch).forEach(k => { if(patch[k] !== undefined) existing[k] = patch[k]; });
}

/* ---------- 主题 ---------- */
function applyTheme(){
  document.documentElement.setAttribute('data-theme', state.theme || 'light');
  const m = $('#themeToggle'); if(m) m.textContent = (state.theme==='dark') ? '☀️' : '🌙';
  const mc = $('#metaTheme');
}
function toggleTheme(){ state.theme = state.theme === 'dark' ? 'light' : 'dark'; save(); applyTheme(); }

/* ---------- Toast ---------- */
function toast(msg, isErr){
  const box = $('#toasts'); const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg; box.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .3s'; }, 2200);
  setTimeout(()=> el.remove(), 2600);
}

/* ---------- 弹窗 ---------- */
let curDialog = null;
function showDialog(title, html, opts){
  opts = opts || {};
  const ov = document.createElement('div'); ov.className = 'overlay';
  const d = document.createElement('div'); d.className = 'dialog';
  if(opts.size === 'lg') d.style.maxWidth = '880px';
  d.innerHTML = '<div class="d-h"><div class="d-t">' + esc(title) + '</div><button class="d-x" type="button">✕</button></div><div class="d-b"></div>';
  const box = d.querySelector('.d-b');
  box.insertAdjacentHTML('beforeend', html);
  ov.appendChild(d);
  const close = () => { ov.remove(); curDialog = null; document.removeEventListener('keydown', esk); };
  const esk = e => { if(e.key === 'Escape') close(); };
  document.addEventListener('keydown', esk);
  ov.addEventListener('mousedown', e => { if(e.target === ov) close(); });
  d.querySelector('.d-x').addEventListener('click', close);
  document.body.appendChild(ov);
  curDialog = { close, box };
  if(opts.onOpen) opts.onOpen(box, close);
  return curDialog;
}
function closeDialog(){ if(curDialog) curDialog.close(); }

/* ---------- 导航渲染 ---------- */
let curView = 'home';
function rebuildNav(){
  const group1 = ['home'];
  const group2 = ['diet','train','body'];
  const group3 = ['goals','stats'];
  const render = ids => ids.map(id => {
    const n = NAV.find(x=>x.id===id);
    return '<div class="navbtn ' + (curView===id?'active':'') + '" data-go="' + id + '"><span class="ic">' + n.ic + '</span>' + esc(n.label) + '</div>';
  }).join('');
  $('#sidebar').innerHTML =
    '<div class="brand"><div class="logo">💪</div><div>健康管理<small>我的健身日记</small></div></div>' +
    '<div class="navgroup">主页</div>' + render(group1) +
    '<div class="navgroup">记录</div>' + render(group2) +
    '<div class="navgroup">计划 · 分析</div>' + render(group3) +
    '<div style="flex:1"></div>' +
    '<div class="navbtn" data-themeclick><span class="ic">' + (state.theme==='dark'?'🌙':'☀️') + '</span>外观</div>';
  $('#tabbar').innerHTML = NAV.map(n =>
    '<button class="tabbtn ' + (curView===n.id?'active':'') + '" data-go="' + n.id + '"><span class="ti">' + n.ic + '</span>' + esc(n.label) + '</button>').join('');
  $$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  const tc = $('#sidebar [data-themeclick]'); if(tc) tc.addEventListener('click', toggleTheme);
}
function go(v){
  curView = v;
  rebuildNav(); renderView();
  window.scrollTo({top:0, behavior:'smooth'});
}
function renderView(){
  const map = { home:renderHome, diet:renderDiet, train:renderTrain, body:renderBody, goals:renderGoals, stats:renderStats };
  const topbar = $('#topbar');
  const titles = { home:'概览', diet:'饮食记录', train:'训练', body:'身体数据', goals:'目标 · 打卡', stats:'数据统计' };
  const au = activeUser();
  topbar.innerHTML = '<div class="page-head"><h1>' + titles[curView] + '</h1></div>' +
    '<div class="tools">' +
      '<button class="userpill" id="userBtn" title="我的档案 / 退出登录">' +
        '<span class="av avatar-ring" style="--ring:' + userColorHex(au.color) + '">' + esc(au.avatar || '🙂') + '</span>' +
        '<span class="upn">' + esc(au.name) + '</span>' +
      '</button>' +
      '<button class="iconbtn" id="themeToggle" title="切换深色/浅色">' + (state.theme==='dark' ? '☀️' : '🌙') + '</button>' +
      '<button class="iconbtn" id="settingsBtn" title="设置">⚙️</button>' +
    '</div>';
  $('#userBtn').onclick = openProfile;
  $('#themeToggle').onclick = toggleTheme;
  $('#settingsBtn').onclick = openSettings;
  (map[curView])();
}

/* =====================================================
   首次引导
===================================================== */
function showOnboard(){
  const html =
    '<div class="empty" style="padding:6px 4px 2px"><div class="e-ic">👋</div></div>' +
    '<p style="margin:2px 0 14px;color:var(--ink-2)">欢迎使用健康管理！简单填几项基础信息，就能开始估算你的每日营养目标。也可以先载入<b>演示数据</b>看看整个工具的效果。</p>' +
    '<div class="form-grid">' +
      '<div><label>性别</label><select class="select" id="ob_gender"><option value="male">男</option><option value="female">女</option></select></div>' +
      '<div><label>出生年份</label><input class="input" id="ob_year" type="number" min="1930" max="2020" value="1992"></div>' +
      '<div><label>身高 cm</label><input class="input" id="ob_height" type="number" min="130" max="230" value="175"></div>' +
      '<div><label>当前体重 kg</label><input class="input" id="ob_weight" type="number" min="30" max="300" value="72"></div>' +
      '<div class="span2"><label>主要目标</label><select class="select" id="ob_mode">' +
        '<option value="cut">减脂（热量赤字，每周约0.4-0.5kg）</option>' +
        '<option value="maintain">保持 / 增肌减脂缓慢进行</option>' +
        '<option value="bulk">增肌（热量盈余）</option></select></div>' +
      '<div class="span2"><label>日常活动量</label><select class="select" id="ob_act">' + ACTIVITIES.map(a => '<option value="' + a.v + '">' + a.label + '</option>').join('') + '</select></div>' +
    '</div>' +
    '<div class="d-f" style="position:static;justify-content:space-between;margin-top:18px">' +
      '<button class="btn" id="ob_demo">🚀 先载入演示数据体验</button>' +
      '<span class="row gap8"><button class="btn ghost" id="ob_skip">直接开始</button></span>' +
    '</div>';
  const dlg = showDialog('开始使用', html, {size:'lg'});
  const b = dlg.box;
  $('#ob_mode', b).value = state.goal.mode;
  $('#ob_act', b).value = String(state.activity);
  const collect = () => {
    state.profile = {
      gender: $('#ob_gender', b).value,
      birthYear: num($('#ob_year', b).value) || 1992,
      height: num($('#ob_height', b).value) || 175,
      currentKg: num($('#ob_weight', b).value) || 72,
    };
    state.activity = num($('#ob_act', b).value);
    state.goal.mode = $('#ob_mode', b).value;
    if(state.goal.startKg === null) state.goal.startKg = state.profile.currentKg;
    syncNutrition(); save();
  };
  $('#ob_demo', b).addEventListener('click', () => { collect(); closeDialog(); demoData(); });
  $('#ob_skip', b).addEventListener('click', () => { collect(); USERS.onboarded = true; save(); closeDialog(); go('home'); });
}

/* =====================================================
   设置
===================================================== */
function openSettings(){
  const html =
    '<h4 style="margin:2px 0 10px;font-size:13px;color:var(--ink-3)">基础资料</h4>' +
    '<div class="form-grid">' +
      '<div><label>性别</label><select class="select" id="st_gender"><option value="male">男</option><option value="female">女</option></select></div>' +
      '<div><label>出生年份</label><input class="input" id="st_year" type="number" min="1930" max="2020" value="' + state.profile.birthYear + '"></div>' +
      '<div><label>身高 cm</label><input class="input" id="st_height" type="number" min="130" max="230" value="' + state.profile.height + '"></div>' +
      '<div><label>当前体重 kg</label><input class="input" id="st_weight" type="number" min="30" max="300" value="' + state.profile.currentKg + '"></div>' +
    '</div>' +
    '<div class="tiny" style="margin:10px 0 6px;color:var(--ink-3)">活动量、饮水与营养目标，请在「目标」页的「每日目标」卡片中设置。</div>' +
    '<div class="d-f"><button class="btn ghost" id="st_demo">🚀 演示数据</button><button class="btn ghost" id="st_export">⬇ 导出</button><button class="btn ghost" id="st_import">⬆ 导入</button><button class="btn danger ghost" id="st_wipe">🗑 清空</button><button class="btn primary" id="st_save">保存</button></div>' +
    '<div class="tiny" id="st_sync" style="margin-top:10px;color:var(--ink-3)"></div>' +
    '<div class="tiny" style="margin-top:4px;color:var(--ink-3)">各设备登录同一账户，读写的就是同一份服务器数据，无需手动同步；不同账户彼此隔离。本机存储仅作当前账户的离线缓存。历史备份可在上方「导出/导入」搬运。</div>' +
    '<input type="file" id="st_file" accept=".json,application/json" style="display:none">';
  const dlg = showDialog('设置', html, {size:'lg'});
  const b = dlg.box;
  $('#st_gender', b).value = state.profile.gender;
  $('#st_save', b).addEventListener('click', () => {
    state.profile = { gender:$('#st_gender', b).value, birthYear:num($('#st_year', b).value)||1992, height:num($('#st_height', b).value)||175, currentKg:num($('#st_weight', b).value)||state.profile.currentKg };
    if(state.goal.startKg === null) state.goal.startKg = state.profile.currentKg;
    syncNutrition(); save(); closeDialog(); renderView(); toast('已保存');
  });
  $('#st_export', b).addEventListener('click', () => exportData());
  $('#st_import', b).addEventListener('click', () => {
    if(!confirm('导入会用备份中的数据覆盖本账户当前数据，是否继续？建议先「导出」留底。\n（多人备份文件只取其中"当前成员"那一份；其他成员请各自登录后再导入）')) return;
    $('#st_file', b).click();
  });
  $('#st_file', b).addEventListener('change', e => { const f = e.target.files[0]; if(f) importData(f); e.target.value = ''; });
  $('#st_demo', b).addEventListener('click', () => { if(confirm('载入演示数据会覆盖本账户当前数据，确定？')) { demoData(); closeDialog(); } });
  $('#st_wipe', b).addEventListener('click', () => { if(confirm('真的要清空本账户全部数据吗？此操作不可恢复（会同步清空服务器上的本人数据，不影响其他账户）。')) wipeAll(); });
  refreshSyncStatus();
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
    toast('导入成功：已作为本账户数据');
  };
  rd.onerror = () => toast('读取文件失败', true);
  rd.readAsText(file);
}

/* =====================================================
   我的档案（v4：一账户一档案，成员切换/增删已退役）
===================================================== */
function userMetaHTML(u){
  const wc = (u.workouts || []).length;
  const bd = (u.body || []).filter(b => b.weight !== undefined && b.weight !== null);
  const last = bd.length ? bd[bd.length-1].weight : null;
  return (last !== null ? '体重 ' + last + 'kg · ' : '暂无体重 · ') + '训练 ' + wc + ' 次 · 身体记录 ' + bd.length + ' 条';
}
function colorOpts(sel){
  const labels = {green:'绿', blue:'蓝', orange:'橙', violet:'紫', teal:'青', pink:'粉'};
  return USER_COLORS.map(c => '<option value="' + c.id + '"' + (c.id === sel ? ' selected' : '') + '>' + (labels[c.id] || c.id) + '</option>').join('');
}
function openProfile(){
  const u = activeUser();
  const isAdmin = !!(me && me.role === 'admin');
  const html =
    '<div class="lrow" style="border:0;padding-top:0">' +
      '<span class="av big avatar-ring" style="--ring:' + userColorHex(u.color) + '">' + esc(u.avatar || '🙂') + '</span>' +
      '<div class="grow"><div class="b">' + esc(u.name) + (isAdmin ? ' <span class="chip" style="background:var(--brand-soft);color:var(--brand-ink);border-color:transparent">管理员</span>' : '') + '</div>' +
      '<div class="sub">登录账户：' + esc(me ? me.username : '（离线）') + '</div></div>' +
      '<div class="tiny muted">' + esc(userMetaHTML(u)) + '</div>' +
    '</div>' +
    '<div class="form-grid" style="margin-top:6px">' +
      '<div><label>头像（表情）</label><input class="input" id="pf_av" maxlength="2" value="' + esc(u.avatar || '🙂') + '"></div>' +
      '<div><label>昵称</label><input class="input" id="pf_name" value="' + esc(u.name) + '"></div>' +
      '<div class="span2"><label>标识色</label><select class="select" id="pf_color">' + colorOpts(u.color) + '</select></div>' +
    '</div>' +
    '<div class="d-f" style="justify-content:space-between">' +
      '<span class="row gap8">' +
        '<button class="btn ghost" id="pf_logout">⎋ 退出登录</button>' +
      '</span>' +
      '<button class="btn primary" id="pf_save">保存</button>' +
    '</div>' +
    (isAdmin ? '<a class="btn block" style="margin-top:12px;text-decoration:none;justify-content:center" href="/admin" target="_blank" rel="noopener">🛠 进入后台管理（系统库 · 用户权限）→</a>' : '');
  const dlg = showDialog('我的档案', html);
  const b = dlg.box;
  $('#pf_save', b).addEventListener('click', () => {
    const name = $('#pf_name', b).value.trim(); if(!name){ toast('昵称不能为空', true); return; }
    u.name = name; u.avatar = $('#pf_av', b).value.trim() || '🙂'; u.color = $('#pf_color', b).value;
    save(); closeDialog(); go(curView); toast('已保存');
  });
  $('#pf_logout', b).addEventListener('click', doLogout);
}
async function doLogout(){
  try { await srvFetch('/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 4000); } catch(e){}
  srv.fatal = true;
  if(srv.pushTimer){ clearTimeout(srv.pushTimer); srv.pushTimer = null; }
  me = null;
  localStorage.removeItem(AUTH_KEY); localStorage.removeItem(AUTH_ROLE_KEY);
  location.reload();
}

/* =====================================================
   概览首页
===================================================== */
function tileHTML(lab, val, unit, delta, deltaCls, icon){
  return '<div class="tile"><div class="lab"><span>' + esc(lab) + '</span></div><div class="val">' + val + (unit ? '<span class="unit">' + unit + '</span>' : '') + '</div>' +
    (delta ? '<div class="delta ' + (deltaCls||'') + '">' + delta + '</div>' : '') + '</div>';
}

function renderHome(){
  const t = today();
  const T = target();
  const eat = dayTotals(t);
  const wk = weekday(t);
  const nowH = new Date().getHours();
  const greet = nowH < 5 ? '夜深了' : nowH < 11 ? '早上好' : nowH < 14 ? '中午好' : nowH < 18 ? '下午好' : '晚上好';
  const w = latestVal('weight');
  const calPct = Math.round(eat.kcal / T.kcal * 100);
  const habToday = state.habits.filter(h => h.done[t]).length;
  const plan = planForDate(t);
  const doneEx = state.workouts.some(x => x.date === t);

  let planHTML = '';
  if(plan){
    const exs = plan.items.map((it,i) =>
      '<div class="lrow"><div class="thumb" style="background:var(--surface-3)">' + (i+1) + '</div><div class="grow"><div class="b">' + esc(it.exName) + '</div><div class="sub">' + esc(it.muscle || '') + '</div></div>' +
      '<div class="tiny" style="white-space:nowrap">' + it.sets + '×' + it.reps + '　' + (it.weight? it.weight + 'kg':'自重') + '</div></div>').join('');
    planHTML =
      '<div class="card"><h3><span>📋 今日计划 · ' + esc(plan.name || '') + '</span><span class="grow"></span>' +
      '<button class="btn primary sm" data-quick="train">记录本次训练</button></h3>' + exs + '</div>';
  } else {
    planHTML = '<div class="card"><h3>📋 今日计划</h3><div class="empty"><div class="e-ic">🛋️</div>今天没有安排训练<br><button class="btn sm mt" data-quick="train">去训练页安排计划</button></div></div>';
  }

  const html =
    '<div class="muted">' + esc(greet) + '，<b>' + esc(activeUser().name) + '</b> · ' + dateCNW(t) + '</div>' +
    '<div class="row mt">' +
      tileHTML('今日热量', fmtNum(eat.kcal), '/ ' + fmtNum(T.kcal) + ' kcal', '', '') +
      tileHTML('体重', w ? w.toFixed(1) : '--', 'kg', '', '') +
      tileHTML('训练', doneEx ? '✓ 已完成' : (plan ? '待完成' : '休息日'), '', '') +
      tileHTML('打卡', habToday + '/' + state.habits.length, '', '', '') +
    '</div>' +
    '<div class="card" style="margin-top:14px"><h3>🍽️ 今日饮食</h3>' +
      (eat.kcal === 0 ? '<div class="empty"><div class="e-ic">🍽️</div>还没有记录今天的饮食<button class="btn primary sm mt" data-go2="diet">去记录</button></div>'
        : '<div class="small">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:5px"><span class="muted">已摄入 vs 目标 <span class="tiny" style="font-weight:400;color:' + (calPct>100?'var(--ink-2)':'var(--cat3)') + '">' + (calPct>100 ? '已超 ' + (calPct-100) + '%' : '还差 ' + (100-calPct) + '%') + '</span></span><b>' + fmtNum(eat.kcal) + ' / ' + fmtNum(T.kcal) + ' kcal</b></div>' +
          '<div class="meter"><i style="width:' + clamp(calPct,0,100) + '%" class="' + (calPct>100?'over':'') + '"></i></div>' +
          '</div>') +
      (eat.kcal ? '<div class="row gap8" style="margin-top:10px">' +
        '<span class="chip b1">蛋白 ' + eat.p + 'g / ' + T.p + 'g</span>' +
        '<span class="chip b2">碳水 ' + eat.c + 'g / ' + T.c + 'g</span>' +
        '<span class="chip b3">脂肪 ' + eat.f + 'g / ' + T.f + 'g</span>' +
      '</div>' : '') +
    '</div>' +
    planHTML +
    lifeTodayHTML() +
    habitCardHTML();

  $('#view').innerHTML = html;
  bindHabitEvents();
  bindLifeToday($('#view'));
  const q = $('#view [data-quick="train"]');
  if(q) q.addEventListener('click', startTodayWorkout);
  const g = $('#view [data-go2="diet"]');
  if(g) g.addEventListener('click', () => go('diet'));
}

function goalSummaryHTML(){
  const g = state.goal;
  const cur = latestVal('weight') || state.profile.currentKg;
  if(!g.targetKg || !g.startKg) return '<div class="tiny muted">还没有设定体重目标，去「目标」页设置。</div>';
  const start = g.startKg, target = g.targetKg;
  const total = Math.abs(target - start), done = Math.abs(start - cur);
  const pct = total ? clamp(Math.round(done/total*100), 0, 100) : 0;
  const modeLabel = {cut:'减脂', bulk:'增肌', maintain:'保持'}[g.mode] || '';
  return '<div class="small">目标体重 <b>' + target + 'kg</b>（' + modeLabel + '）</div>' +
    '<div class="meter" style="margin-top:7px"><i style="width:' + pct + '%"></i></div>' +
    '<div style="display:flex;justify-content:space-between;margin-top:5px" class="tiny muted"><span>' + start + 'kg 起点</span><span class="b" style="color:var(--brand-ink)">' + cur + 'kg</span><span>' + target + 'kg 目标</span></div>' +
    (g.targetDate ? '<div class="tiny muted" style="margin-top:4px">目标日期 ' + dateCN(g.targetDate) + '</div>' : '');
}

/* =====================================================
   饮食模块
===================================================== */
let dietDate = today();

function macroPill(t){
  return '<span class="chip b1">P ' + t.p + '</span><span class="chip b2">C ' + t.c + '</span><span class="chip b3">F ' + t.f + '</span>';
}
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
      '<button class="btn sm" data-addslot="' + s.id + '">＋ 添加</button></h3>' + list + '</div>';
  }).join('');

  const html =
    '<div class="card"><div class="row" style="justify-content:space-between;align-items:center">' +
      '<div class="daynav"><button class="iconbtn2" data-day="-1">‹</button>' +
        '<div class="lbl">' + dateCN(d) + '<small>' + (d===today() ? '今天' : '周' + DAY_CN[weekday(d)]) + '</small></div>' +
        '<button class="iconbtn2" data-day="1">›</button>' +
        (d !== today() ? '<button class="btn sm" data-day="today">回到今天</button>' : '') +
      '</div>' +
      '<button class="btn sm ghost" data-lib="1">📚 食物库(' + state.foods.length + ')</button>' +
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
  $$('[data-edit]', v).forEach(b => b.addEventListener('click', () => { const it = findMealItem(dietDate, b.dataset.edit); if(it) addMealDialog(dietDate, slotOfItem(dietDate, it.id), it.id); }));
  $$('[data-del]', v).forEach(b => b.addEventListener('click', () => delMealItem(dietDate, b.dataset.del)));
  const lb = $('#view [data-lib="1"]'); if(lb) lb.addEventListener('click', openFoodLib);
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

/* 添加/编辑一条食物记录 */
function addMealDialog(date, slot, itemId){
  const editing = !!itemId;
  let item = null;
  if(editing){ item = findMealItem(date, itemId); }
  const libOpts = state.foods.map(f => '<option value="' + f.id + '"' + (item && item.name===f.name ? ' selected':'') + '>' + esc(f.name) + '（每100g ' + Math.round(f.per100.kcal) + 'kcal）</option>').join('');
  const html =
    '<div class="row gap8" style="margin-bottom:10px">' +
      '<span class="chip">' + dateCNW(date) + '</span><span class="chip slot" style="background:' + slotColor(slot) + '22;border-color:transparent">' + SLOTS.find(s=>s.id===slot).ic + ' ' + SLOTS.find(s=>s.id===slot).label + '</span>' +
    '</div>' +
    '<div class="field"><label>从食物库选择（可留空后手动填）</label><select class="select" id="mi_sel"><option value="">— 手动输入 —</option>' + libOpts + '</select></div>' +
    '<div class="form-grid">' +
      '<div class="span2"><label>食物名称</label><input class="input" id="mi_name" value="' + (item?esc(item.name):'') + '" placeholder="如：鸡胸肉"></div>' +
      '<div><label>每100g热量</label><input class="input" id="mi_kcal" type="number" min="0" value="' + (item?item.per100.kcal:'') + '"></div>' +
      '<div><label>每100g蛋白 g</label><input class="input" id="mi_p" type="number" min="0" step="0.1" value="' + (item?item.per100.p:'') + '"></div>' +
      '<div><label>每100g碳水 g</label><input class="input" id="mi_c" type="number" min="0" step="0.1" value="' + (item?item.per100.c:'') + '"></div>' +
      '<div><label>每100g脂肪 g</label><input class="input" id="mi_f" type="number" min="0" step="0.1" value="' + (item?item.per100.f:'') + '"></div>' +
      '<div class="span2"><label>实际吃了多少（克）</label><input class="input" id="mi_g" type="number" min="1" value="' + (item?item.g:'100') + '">' +
      '<div class="tiny muted" id="mi_prev" style="margin-top:6px"></div></div>' +
    '</div>' +
    '<label class="chkline" style="margin-top:2px"><input type="checkbox" id="mi_savefood"> 同时保存到我的食物库</label>' +
    '<div class="d-f"><button class="btn danger ghost" id="mi_del" style="' + (editing?'':'display:none') + '">删除</button><button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="mi_save">保存</button></div>';
  const dlg = showDialog(editing ? '修改记录' : '记录饮食', html);
  const b = dlg.box;
  function readFood(){ return { name:$('#mi_name', b).value.trim(), kcal:num($('#mi_kcal', b).value), p:num($('#mi_p', b).value), c:num($('#mi_c', b).value), f:num($('#mi_f', b).value) }; }
  function prevHTML(f, g){ const k = f.kcal*g/100, p=f.p*g/100, c=f.c*g/100, fa=f.f*g/100; return '合计：<b>' + Math.round(k) + ' kcal</b> · 蛋白 ' + round(p,1) + 'g · 碳水 ' + round(c,1) + 'g · 脂肪 ' + round(fa,1) + 'g'; }
  function refresh(){ const f = readFood(); const g = num($('#mi_g', b).value) || 0; $('#mi_prev', b).innerHTML = prevHTML(f, g); }
  $('#mi_sel', b).addEventListener('change', e => {
    const fo = mkFood(e.target.value); if(!fo) return;
    $('#mi_name', b).value = fo.name;
    $('#mi_kcal', b).value = fo.per100.kcal;
    $('#mi_p', b).value = fo.per100.p; $('#mi_c', b).value = fo.per100.c; $('#mi_f', b).value = fo.per100.f;
    refresh();
  });
  $$('input', b).forEach(i => i.addEventListener('input', refresh));
  refresh();
  $('#mi_save', b).addEventListener('click', () => {
    const f = readFood();
    if(!f.name){ toast('请填写食物名称', true); return; }
    const g = num($('#mi_g', b).value); if(!g){ toast('请填写克数', true); return; }
    const per100 = { kcal:f.kcal, p:f.p, c:f.c, f:f.f };
    if($('#mi_savefood', b).checked && !state.foods.some(x => x.name === f.name)){
      const nf = { id:uid(), name:f.name, per100 };
      state.foods.push(nf); toast('已加入食物库');
    }
    if(editing){
      Object.assign(item, { name:f.name, per100, g });
    } else {
      addMealItem(date, slot, { id:uid(), name:f.name, per100, g });
    }
    save(); closeDialog(); renderDiet();
  });
  const md = $('#mi_del', b); if(md) md.addEventListener('click', () => { delMealItem(date, itemId); closeDialog(); });
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
}

/* =====================================================
   系统共享库（v4：管理员维护，普通用户只读；个人库可从中挑入）
===================================================== */
let SYS_LIB = null;
async function fetchSysLib(force){
  if(SYS_LIB && !force) return SYS_LIB;
  try {
    const r = await srvFetch('/system/library', { method: 'GET' }, 4000);
    if(r.status === 401){ authExpired(); return null; }
    if(!r.ok) throw new Error('HTTP ' + r.status);
    SYS_LIB = await r.json();
    return SYS_LIB;
  } catch(e){ return null; }
}
function importFoodFromSys(fo){
  if(!fo || !fo.name) return false;
  if(USERS.shared.foods.some(x => x.name === fo.name)){ toast('我的库已有「' + fo.name + '」', true); return false; }
  const nf = { id: uid(), name: fo.name };
  if(fo.per100) nf.per100 = Object.assign({}, fo.per100);
  USERS.shared.foods.push(nf); save();
  return true;
}
function importExerciseFromSys(e){
  if(!e || !e.name) return false;
  if(USERS.shared.exercises.some(x => x.name === e.name)){ toast('我的库已有「' + e.name + '」', true); return false; }
  const ne = { id: uid(), name: e.name };
  if(e.muscle) ne.muscle = e.muscle;
  USERS.shared.exercises.push(ne); save();
  return true;
}
function foodRowHTML(f, dataAttr){
  const sub = f.per100 ? ('每100g：' + Math.round(f.per100.kcal||0) + ' kcal · P' + (f.per100.p||0) + ' C' + (f.per100.c||0) + ' F' + (f.per100.f||0)) : '无营养表';
  return '<div class="lrow" ' + dataAttr + '><div class="grow"><div class="b">' + esc(f.name) + '</div><div class="sub">' + esc(sub) + '</div></div>';
}

/* 食物库管理：我的库（可增删）| 系统库（只读 + 挑入我的库） */
function openFoodLib(){
  const dlg = showDialog('食物库',
    '<div class="row" style="margin-bottom:10px"><div class="seg" id="fl_seg"></div></div>' +
    '<div id="fl_body"><div class="tiny muted">载入中…</div></div>');
  const b = dlg.box;
  let tab = 'mine';
  function paintSeg(){
    $('#fl_seg', b).innerHTML =
      '<button data-ft="mine" class="' + (tab==='mine'?'active':'') + '">我的库（' + state.foods.length + '）</button>' +
      '<button data-ft="sys" class="' + (tab==='sys'?'active':'') + '">系统库</button>';
    $$('#fl_seg [data-ft]', b).forEach(btn => btn.addEventListener('click', () => { tab = btn.dataset.ft; paintSeg(); render(); }));
  }
  function renderMine(){
    const list = state.foods.map(f =>
      foodRowHTML(f, 'data-id="' + f.id + '"') +
        '<button class="btn sm ghost" data-add="' + f.id + '">＋记录</button>' +
        '<button class="iconbtn2" data-delf="' + f.id + '" style="color:var(--danger)">🗑</button></div>').join('');
    $('#fl_body', b).innerHTML =
      '<div class="field" style="display:flex;gap:8px"><input class="input" id="nf_name" placeholder="新食物名" style="flex:1.2"><input class="input" id="nf_kcal" type="number" placeholder="kcal/100g" style="width:96px"></div>' +
      '<div class="field" style="display:flex;gap:8px"><input class="input" id="nf_p" type="number" placeholder="蛋白" style="flex:1"><input class="input" id="nf_c" type="number" placeholder="碳水" style="flex:1"><input class="input" id="nf_f" type="number" placeholder="脂肪" style="flex:1"><button class="btn primary" id="nf_add">添加</button></div>' +
      '<div class="tiny muted" style="margin-bottom:8px">点 ＋记录 可直接把它记到当日加餐；「系统库」分页可挑选管理员维护的公共食物。</div>' + (list || '<div class="empty" style="padding:14px"><div class="e-ic" style="font-size:24px">📚</div>我的食物库是空的，去「系统库」挑一些吧</div>');
    $('#nf_add', b).addEventListener('click', () => {
      const name = $('#nf_name', b).value.trim(); if(!name){ toast('请填名称', true); return; }
      if(state.foods.some(x => x.name === name)){ toast('该食物已存在', true); return; }
      state.foods.push({ id:uid(), name, per100:{ kcal:num($('#nf_kcal', b).value), p:num($('#nf_p', b).value), c:num($('#nf_c', b).value), f:num($('#nf_f', b).value) } });
      save(); paintSeg(); renderMine();
    });
    $$('[data-delf]', b).forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.delf;
      USERS.shared.foods = USERS.shared.foods.filter(f => f.id !== id);
      state.foods = USERS.shared.foods;
      save(); paintSeg(); renderMine();
    }));
    $$('[data-add]', b).forEach(btn => btn.addEventListener('click', () => {
      const fo = mkFood(btn.dataset.add); if(!fo) return;
      addMealItem(dietDate, 'snack', mealItem(fo, 100)); save();
      closeDialog(); renderDiet(); toast('已记到' + dateCN(dietDate) + '加餐，可去修改克数');
    }));
  }
  async function renderSys(){
    $('#fl_body', b).innerHTML = '<div class="tiny muted">载入系统库…</div>';
    const sys = await fetchSysLib();
    if(tab !== 'sys') return;   /* 载入期间用户切回了我的库 */
    if(!sys){ $('#fl_body', b).innerHTML = '<div class="empty" style="padding:14px"><div class="e-ic" style="font-size:24px">🔌</div>服务器离线，暂时看不到系统库</div>'; return; }
    $('#fl_body', b).innerHTML =
      '<div class="tiny muted" style="margin-bottom:8px">系统共享库由管理员在后台维护，只读。点「＋我的库」把它挑进自己的食物库。</div>' +
      (sys.foods.map((f, i) =>
        foodRowHTML(f, 'data-sysf="' + i + '"') +
        '<button class="btn sm ghost" data-impf="' + i + '">＋我的库</button></div>').join('')
        || '<div class="empty" style="padding:14px"><div class="e-ic" style="font-size:24px">🗂</div>系统库暂无食物</div>');
    $$('[data-impf]', b).forEach(btn => btn.addEventListener('click', () => {
      if(importFoodFromSys(sys.foods[num(btn.dataset.impf)])){ btn.outerHTML = '<span class="chip b3" style="padding:2px 9px;font-size:12px">已在我的库</span>'; paintSeg(); }
    }));
  }
  function render(){ if(tab === 'mine') renderMine(); else renderSys(); }
  paintSeg(); renderMine();
}

/* =====================================================
   训练模块
===================================================== */
let trainTab = 'plan';
function segBar(sel, items){
  return '<div class="seg">' + items.map(it => '<button data-seg="' + it.id + '" class="' + (sel===it.id?'active':'') + '">' + it.label + '</button>').join('') + '</div>';
}

function renderTrain(){
  $('#view').innerHTML =
    '<div class="row" style="align-items:center;justify-content:space-between;margin-bottom:14px">' +
      segBar(trainTab, [
        {id:'plan', label:'🗓 我的计划'},
        {id:'log', label:'📒 训练日志'},
        {id:'lib', label:'📚 动作库'},
      ]) +
      (trainTab === 'log' ? '<button class="btn primary" id="tr_add">＋ 记录训练</button>' : '') +
      (trainTab === 'plan' ? '<button class="btn primary" id="tr_planadd">＋ 新建计划</button>' : '') +
    '</div><div id="tabBody"></div>';
  const v = $('#view');
  $$('[data-seg]', v).forEach(b => b.addEventListener('click', () => { trainTab = b.dataset.seg; renderTrain(); }));
  const add = $('#tr_add', v); if(add) add.addEventListener('click', () => openWorkoutDlg(today(), planForDate(today()) ? String(weekday(today())) : null));
  const pa = $('#tr_planadd', v); if(pa) pa.addEventListener('click', () => openPlanEditor(null));
  fillTrainTab();
}
function fillTrainTab(){
  const body = $('#tabBody');
  if(trainTab === 'plan') renderPlans(body);
  else if(trainTab === 'log') renderWorkoutList(body);
  else renderExLib(body);
}

/* ---------- 周训练计划 ---------- */
function renderPlans(body){
  const order = [1,2,3,4,5,6,0];
  const cells = order.map(dow => {
    const p = state.plans[dow];
    const items = p ? p.items.map(it =>
      '<div class="lrow" style="padding:7px 2px"><div class="grow small">' + esc(it.exName) + (it.weight ? '' : ' · 自重') + '</div><div class="tiny">' + it.sets + '×' + it.reps + (it.weight?' @'+it.weight+'kg':'') + '</div></div>').join('') : '';
    return '<div class="card" style="margin-bottom:0;padding:12px;display:flex;flex-direction:column">' +
      '<h3 style="margin-bottom:8px;justify-content:space-between"><span>周' + DAY_CN[dow] + '</span>' +
      (p ? '<button class="iconbtn2" data-planedit="' + dow + '" title="编辑" style="width:28px;height:28px;font-size:13px">✏️</button>' : '') + '</h3>' +
      (p
        ? '<div style="flex:1">' + items + '</div><div class="tiny muted" style="padding-top:6px;border-top:1px dashed var(--line)">' + esc(p.name||'训练') + ' · 共' + p.items.length + '个动作</div>'
        : '<div style="flex:1;display:flex;flex-direction:column;justify-content:center"><div class="tiny muted" style="text-align:center;padding:14px 0">无计划</div></div>' +
          '<button class="btn sm block" data-planedit="' + dow + '">＋ 安排</button>') +
      '</div>';
  }).join('');
  body.innerHTML = '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">' + cells + '</div>';
  $$('[data-planedit]', body).forEach(b => b.addEventListener('click', () => openPlanEditor(b.dataset.planedit)));
}

function openPlanEditor(dow){
  const editing = dow !== null && dow !== undefined && state.plans[dow];
  dow = dow === null || dow === undefined ? null : String(dow);
  const existing = editing ? state.plans[dow] : null;
  const model = existing ? existing.items.map(it => ({ exId:it.exId, exName:it.exName, muscle:it.muscle, sets:it.sets, reps:it.reps, weight:it.weight })) : [{ exId:'', exName:'', muscle:'', sets:3, reps:10, weight:50 }];
  let name = existing ? existing.name : '';
  function exOpts(selId){
    const groups = {};
    state.exercises.forEach(e => { (groups[e.muscle] = groups[e.muscle]||[]).push(e); });
    let h = '';
    Object.keys(groups).forEach(m => {
      h += '<optgroup label="' + esc(m) + '">' + groups[m].map(e => '<option value="' + e.id + '"' + (selId===e.id?' selected':'') + '>' + esc(e.name) + '</option>').join('') + '</optgroup>';
    });
    return h;
  }
  function rowHTML(m, i){
    return '<div class="grid" style="grid-template-columns:2fr 60px 60px 70px 34px;gap:6px;align-items:center;margin-bottom:6px" data-row="' + i + '">' +
      '<select class="select pi_ex" data-i="' + i + '"><option value="">— 选择动作 —</option>' + exOpts(m.exId) + '</select>' +
      '<input class="input pi_sets" data-i="' + i + '" type="number" min="1" value="' + m.sets + '" title="组数">' +
      '<input class="input pi_reps" data-i="' + i + '" type="number" min="1" value="' + m.reps + '" title="次数">' +
      '<input class="input pi_w" data-i="' + i + '" type="number" min="0" step="0.5" value="' + (m.weight||'') + '" placeholder="kg" title="重量，自重留空">' +
      '<button class="iconbtn2 pi_del" data-i="' + i + '" style="width:30px;height:30px;color:var(--danger)">×</button></div>';
  }
  function buildRows(){ return model.map(rowHTML).join(''); }
  const html =
    '<div class="row gap8" style="margin-bottom:10px"><span class="chip">周' + DAY_CN[dow] + '安排</span>' +
    '<input class="input" id="pl_name" placeholder="计划名（如：推日）" value="' + esc(name) + '" style="max-width:200px"></div>' +
    '<div id="pl_rows">' + buildRows() + '</div>' +
    '<button class="btn sm" id="pl_addrow" style="margin-top:4px">＋ 添加动作</button>' +
    '<div class="tiny muted" style="margin-top:8px">重量可留空表示自重/无重量训练。</div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>取消</button>' + (editing ? '<button class="btn danger ghost" id="pl_delplan">删除本日计划</button>' : '') + '<button class="btn primary" id="pl_save">保存</button></div>';
  const dlg = showDialog((editing ? '编辑' : '安排') + ' 周' + DAY_CN[dow] + ' 训练', html);
  const b = dlg.box;
  function rereadRows(){ const r = $('#pl_rows', b); if(!r) return; r.innerHTML = buildRows(); bindRows(); }
  function bindRows(){
    const r = $('#pl_rows', b);
    $$('.pi_ex', r).forEach(s => s.addEventListener('change', e => { const i = num(e.target.dataset.i); const ex = state.exercises.find(x=>x.id===e.target.value); model[i].exId = e.target.value; model[i].exName = ex ? ex.name : ''; model[i].muscle = ex ? ex.muscle : ''; }));
    $$('.pi_sets', r).forEach(i => i.addEventListener('input', e => model[num(e.target.dataset.i)].sets = num(e.target.value)));
    $$('.pi_reps', r).forEach(i => i.addEventListener('input', e => model[num(e.target.dataset.i)].reps = num(e.target.value)));
    $$('.pi_w', r).forEach(i => i.addEventListener('input', e => model[num(e.target.dataset.i)].weight = num(e.target.value)));
    $$('.pi_del', r).forEach(btn => btn.addEventListener('click', e => { model.splice(num(e.target.dataset.i),1); rereadRows(); }));
  }
  bindRows();
  $('#pl_addrow', b).addEventListener('click', () => { model.push({ exId:'', exName:'', muscle:'', sets:3, reps:10, weight:50 }); rereadRows(); });
  $('#pl_save', b).addEventListener('click', () => {
    const valid = model.filter(m => m.exId);
    if(!valid.length){ toast('请至少选择一个动作', true); return; }
    const pname = $('#pl_name', b).value.trim();
    if(editing && state.plans[dow]) {
      state.plans[dow].name = pname || state.plans[dow].name;
      state.plans[dow].items = valid.map(m => Object.assign({ id:uid() }, m));
    } else {
      state.plans[dow] = { id:uid(), name: pname || ('周' + DAY_CN[dow] + '训练'), items: valid.map(m => Object.assign({ id:uid() }, m)) };
    }
    save(); closeDialog(); renderTrain(); toast('已保存计划');
  });
  if(editing){ $('#pl_delplan', b).addEventListener('click', () => { delete state.plans[dow]; save(); closeDialog(); renderTrain(); toast('已删除'); }); }
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
}

/* ---------- 训练日志 ---------- */
function renderWorkoutList(body){
  const list = [...state.workouts].sort((a,b) => a.date < b.date ? 1 : -1);
  if(!list.length){
    body.innerHTML = '<div class="card"><div class="empty"><div class="e-ic">🏋️</div>还没有训练记录<br><span class="tiny">先到「我的计划」安排一周，然后在训练日点「记录训练」</span></div></div>';
    return;
  }
  const cards = list.map(w => {
    const vol = wkVolume(w);
    const items = w.items.map(it => {
      const pr = isPR(it.exId, w.date, it.sets);
      const setTxt = it.sets.map(s => (s.weight ? round(s.weight,1) : '自重') + '×' + s.reps).join(' · ');
      return '<div class="lrow" style="padding:8px 2px;align-items:flex-start">' +
        '<div style="min-width:18px;text-align:center">' + (it.muscle ? esc(it.muscle.slice(0,1)) : '') + '</div>' +
        '<div class="grow"><div class="b small">' + esc(it.exName) + (pr.rPR ? ' <span class="chip b3" style="padding:0 6px;font-size:10px">PR 刷新</span>' : '') + '</div>' +
        '<div class="sub">' + esc(setTxt) + '</div></div>' +
        (pr.wPR ? '<span style="color:var(--cat3)" title="最大重量纪录">🏆</span>' : '') +
      '</div>';
    }).join('');
    return '<div class="card" data-wk="' + w.id + '">' +
      '<h3><span>' + dateCNW(w.date) + '</span><span class="hint">' + esc(w.name||'训练') + '</span><span class="grow"></span>' +
      '<span class="hint">容量 ' + Math.round(vol) + ' kg</span>' +
      '<button class="iconbtn2" data-wkedit="' + w.id + '" style="width:30px;height:30px;font-size:13px">✏️</button>' +
      '<button class="iconbtn2" data-wkdel="' + w.id + '" style="width:30px;height:30px;font-size:13px;color:var(--danger)">🗑</button>' +
      '</h3>' + items + '</div>';
  }).join('');
  body.innerHTML = cards;
  $$('[data-wkedit]', body).forEach(b => b.addEventListener('click', () => openWorkoutDlg(null, null, b.dataset.wkedit)));
  $$('[data-wkdel]', body).forEach(b => b.addEventListener('click', () => {
    if(confirm('删除这次训练记录？')){ state.workouts = state.workouts.filter(x => x.id !== b.dataset.wkdel); save(); renderTrain(); toast('已删除'); }
  }));
}

function startTodayWorkout(){
  const p = planForDate(today());
  openWorkoutDlg(today(), p ? String(weekday(today())) : null);
}

function openWorkoutDlg(date, planKey, editId){
  const editing = !!editId;
  let w = editing ? state.workouts.find(x => x.id === editId) : null;
  if(!date) date = w ? w.date : today();
  const model = { name: w ? w.name : '', note: w ? (w.note||'') : '', items: w ? w.items.map(it => ({ exId:it.exId, exName:it.exName, muscle:it.muscle, sets: it.sets.map(s => ({ reps:s.reps, weight:s.weight })) })) : [] };
  function importPlan(pk){
    const p = state.plans[pk]; if(!p) return;
    p.items.forEach(it => {
      model.items.push({ exId:it.exId, exName:it.exName, muscle:it.muscle, sets: Array.from({length:it.sets}, () => ({ reps: it.reps, weight: it.weight })) });
    });
  }
  if(planKey) importPlan(planKey);
  const planOpts = [1,2,3,4,5,6,0].filter(d => state.plans[d]).map(d => '<option value="' + d + '">周' + DAY_CN[d] + ' · ' + esc(state.plans[d].name||'') + '</option>').join('');
  function exOpts(){
    const groups = {}; state.exercises.forEach(e => { (groups[e.muscle] = groups[e.muscle]||[]).push(e); });
    let h = '';
    Object.keys(groups).forEach(m => { h += '<optgroup label="' + esc(m) + '">' + groups[m].map(e => '<option value="' + e.id + '">' + esc(e.name) + '</option>').join('') + '</optgroup>'; });
    return h;
  }
  function itemRow(it, i){
    const setInputs = it.sets.map((s, j) =>
      '<span style="display:inline-flex;gap:4px;align-items:center;margin:2px 4px 2px 0;padding:3px 7px;background:var(--surface-3);border-radius:8px">' +
      '<input class="ws_r" data-i="' + i + '" data-j="' + j + '" type="number" min="1" value="' + s.reps + '" style="width:44px;background:transparent;border:0;text-align:center" title="次数">' +
      '<span class="muted">×</span>' +
      '<input class="ws_w" data-i="' + i + '" data-j="' + j + '" type="number" min="0" step="0.5" value="' + (s.weight || '') + '" placeholder="自重" style="width:52px;background:transparent;border:0;text-align:center" title="kg，自重留空">' +
      '</span>');
    return '<div class="lrow" style="align-items:flex-start" data-witem="' + i + '">' +
      '<div class="grow" style="padding-top:4px"><div class="b small">' + esc(it.exName || '未命名动作') + ' <span class="tiny muted">' + (it.muscle||'') + '</span></div>' +
      '<div class="sub" style="margin-top:4px">' + setInputs.join('') +
      '<button class="btn sm ghost" data-addset="' + i + '" style="padding:3px 8px;font-size:12px">＋组</button></div></div>' +
      '<button class="iconbtn2" data-removeitem="' + i + '" style="color:var(--danger);width:30px;height:30px;font-size:14px">✕</button></div>';
  }
  function rowsHTML(){ return model.items.map(itemRow).join(''); }
  const html =
    '<div class="row gap10" style="margin-bottom:10px;align-items:center;flex-wrap:wrap">' +
      '<input class="input" type="date" id="wl_date" value="' + date + '" style="max-width:170px">' +
      '<input class="input" id="wl_name" placeholder="训练名（可选）" value="' + esc(model.name) + '" style="max-width:200px">' +
    '</div>' +
    (planOpts ? '<div class="row gap8" style="margin-bottom:10px;align-items:center"><span class="tiny muted">从周计划导入：</span>' +
      '<select class="select" id="wl_plan" style="max-width:200px"><option value="">选择…</option>' + planOpts + '</select></div>' : '') +
    '<div id="wl_rows">' + rowsHTML() + '</div>' +
    '<div class="row gap8"><button class="btn sm" id="wl_addex">＋ 添加动作</button>' +
    '<button class="btn sm ghost" id="wl_addbody">＋ 自重/徒手动作</button></div>' +
    '<div class="tiny muted" style="margin:6px 0">动作名称可自定义，保存时自动加入动作库。次数留 0 的组会被忽略。</div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="wl_save">保存训练</button></div>';
  const dlg = showDialog(editing ? '修改训练记录' : '记录训练', html, {size:'lg'});
  const b = dlg.box;
  const rowsBox = $('#wl_rows', b);
  function readRowInto(i){
    const it = model.items[i]; if(!it) return;
    // 数值已实时写回；此处仅清理空组
    it.sets = it.sets.filter(s => (s.weight && s.weight > 0) || (s.reps && s.reps > 0));
    if(!it.sets.length) it.sets = [{reps:0, weight:0}];
  }
  function rerender(){ rowsBox.innerHTML = rowsHTML(); bindWL(); }
  function bindWL(){
    $$('.ws_r', rowsBox).forEach(inp => inp.addEventListener('input', () => { const it = model.items[num(inp.dataset.i)]; const s = it.sets[num(inp.dataset.j)]; if(s){ s.reps = num(inp.value); readRowInto(num(inp.dataset.i)); } }));
    $$('.ws_w', rowsBox).forEach(inp => inp.addEventListener('input', () => { const it = model.items[num(inp.dataset.i)]; const s = it.sets[num(inp.dataset.j)]; if(s){ s.weight = num(inp.value); readRowInto(num(inp.dataset.i)); } }));
    $$('[data-addset]', rowsBox).forEach(btn => btn.addEventListener('click', () => { model.items[num(btn.dataset.addset)].sets.push({reps:0, weight:0}); rerender(); }));
    $$('[data-removeitem]', rowsBox).forEach(btn => btn.addEventListener('click', () => { model.items.splice(num(btn.dataset.removeitem),1); rerender(); }));
  }
  bindWL();
  const planSel = $('#wl_plan', b); if(planSel) planSel.addEventListener('change', () => { if(planSel.value !== ''){ importPlan(planSel.value); planSel.value=''; rerender(); } });
  $('#wl_addex', b).addEventListener('click', () => openExercisePicker(m => {
    model.items.push({ exId:m.id, exName:m.name, muscle:m.muscle, sets:[{reps:8, weight: m.muscle==='有氧' ? 0 : 40 }] });
    rerender();
  }));
  $('#wl_addbody', b).addEventListener('click', () => {
    model.items.push({ exId:'', exName:'徒手动作（自定义名称）', muscle:'', sets:[{reps:10, weight:0}] });
    rerender();
  });
  // 名称双击可改：直接内联输入麻烦，这里用 dataset 简单替代——点击动作名弹 prompt 修改名称
  rowsBox.addEventListener('dblclick', e => { const r = e.target.closest('[data-witem]'); if(!r) return; const i = num(r.dataset.witem); const nn = prompt('动作名称', model.items[i].exName); if(nn && nn.trim()){ model.items[i].exName = nn.trim(); model.items[i].exId=''; model.items[i].muscle=''; rerender(); } });
  $('#wl_save', b).addEventListener('click', () => {
    // 收拢模型
    model.items = model.items.map(it => {
      it.sets = it.sets.filter(s => s.reps && s.reps > 0 && (s.weight || it.muscle === '有氧' || true));
      it.sets = it.sets.filter(s => s.reps > 0);
      return it;
    }).filter(it => it.sets.length && it.exName);
    if(!model.items.length){ toast('请至少完成一组动作', true); return; }
    const d = $('#wl_date', b).value || date;
    const nm = $('#wl_name', b).value.trim();
    // 未匹配库中动作的新名称加入库
    model.items.forEach(it => {
      if(!it.exId){
        const ex = state.exercises.find(e => e.name === it.exName);
        if(ex){ it.exId = ex.id; it.muscle = ex.muscle; }
        else { const nid = uid(); state.exercises.push({ id:nid, name:it.exName, muscle:it.muscle || '其他' }); it.exId = nid; it.muscle = it.muscle || '其他'; }
      }
    });
    if(editing){
      w.name = nm; w.date = d; w.items = model.items.map(it => ({ id:uid(), exId:it.exId, exName:it.exName, muscle:it.muscle, sets: it.sets.map(s=>({reps:s.reps, weight:s.weight})) }));
    } else {
      state.workouts.push({ id:uid(), date:d, name:nm, items: model.items.map(it => ({ id:uid(), exId:it.exId, exName:it.exName, muscle:it.muscle, sets: it.sets.map(s=>({reps:s.reps, weight:s.weight})) })) });
    }
    save(); closeDialog(); renderTrain(); toast('训练已保存 💪');
  });
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
}

/* 动作选择器 */
function openExercisePicker(cb){
  const groups = {}; state.exercises.forEach(e => { (groups[e.muscle] = groups[e.muscle]||[]).push(e); });
  let h = '';
  Object.keys(groups).forEach(m => { h += '<div class="lrow" style="border:0;font-size:12px;color:var(--ink-3)">' + esc(m) + '</div>' + groups[m].map(e => '<div class="lrow" style="cursor:pointer" data-pick="' + e.id + '"><div class="grow">' + esc(e.name) + '</div><span class="tiny muted">选</span></div>').join(''); });
  const dlg = showDialog('选择动作（双击动作名可改）', h, {size:'lg'});
  $$('[data-pick]', dlg.box).forEach(el => el.addEventListener('click', () => {
    const e = state.exercises.find(x => x.id === el.dataset.pick); closeDialog(); cb(e);
  }));
}

/* ---------- 动作库（我的库 | 系统库） ---------- */
let exLibTab = 'mine';
function renderExLib(body){
  body.innerHTML =
    '<div class="seg" style="margin-bottom:12px" id="xl_seg">' +
      '<button data-xlt="mine" class="' + (exLibTab==='mine'?'active':'') + '">我的动作库</button>' +
      '<button data-xlt="sys" class="' + (exLibTab==='sys'?'active':'') + '">系统动作库</button>' +
    '</div><div id="xl_body"></div>';
  $$('[data-xlt]', body).forEach(btn => btn.addEventListener('click', () => { exLibTab = btn.dataset.xlt; renderExLib(body); }));
  const sub = $('#xl_body', body);
  if(exLibTab === 'mine') renderExLibMine(sub);
  else renderExLibSys(sub);
}
function renderExLibMine(body){
  const groups = {};
  state.exercises.forEach(e => { (groups[e.muscle] = groups[e.muscle]||[]).push(e); });
  let h = '';
  MUSCLES.forEach(m => {
    if(!groups[m]) return;
    h += '<div class="col"><div class="tiny muted" style="font-weight:700;margin:4px 2px 6px">' + esc(m) + '</div>' +
      groups[m].map(e => '<div class="lrow" style="border:0;padding:5px 2px"><div class="grow small">' + esc(e.name) + '</div><button class="iconbtn2" data-delx="' + e.id + '" style="width:26px;height:26px;font-size:11px;color:var(--danger)">🗑</button></div>').join('') + '</div>';
  });
  body.innerHTML = '<div class="card" style="margin-bottom:0"><h3>📚 我的动作库</h3><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">' + h + '</div>' +
    '<div class="tiny muted" style="margin-top:10px">训练中保存的新动作会自动进入这里；「系统动作库」分页可挑入管理员维护的公共动作。</div>' +
    '<div class="row gap8 mt" style="align-items:end">' +
      '<div style="flex:1"><label class="tiny muted">新动作名</label><input class="input" id="nx_name" placeholder="如：窄距俯卧撑"></div>' +
      '<div style="width:120px"><label class="tiny muted">肌群</label><select class="select" id="nx_muscle">' + MUSCLES.map(m => '<option>' + m + '</option>').join('') + '</select></div>' +
      '<button class="btn primary" id="nx_add">添加</button></div></div>';
  $('#nx_add', body).addEventListener('click', () => {
    const name = $('#nx_name', body).value.trim();
    if(!name){ toast('请填写动作名', true); return; }
    state.exercises.push({ id:uid(), name, muscle: $('#nx_muscle', body).value });
    save(); renderExLib($('#tabBody')); toast('已添加');
  });
  $$('[data-delx]', body).forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.delx;
    /* 注意:必须改 USERS.shared.exercises 本体(再重新取引用),只换 state.exercises 指向会同步不生效 */
    USERS.shared.exercises = USERS.shared.exercises.filter(e => e.id !== id);
    state.exercises = USERS.shared.exercises;
    save(); renderExLib($('#tabBody'));
  }));
}
async function renderExLibSys(body){
  body.innerHTML = '<div class="tiny muted">载入系统库…</div>';
  const sys = await fetchSysLib();
  if(exLibTab !== 'sys') return;
  if(!sys){ body.innerHTML = '<div class="card"><div class="empty" style="padding:14px"><div class="e-ic" style="font-size:24px">🔌</div>服务器离线，暂时看不到系统库</div></div>'; return; }
  const groups = {};
  sys.exercises.forEach(e => { (groups[e.muscle || '其他'] = groups[e.muscle || '其他'] || []).push(e); });
  let h = '';
  MUSCLES.forEach(m => {
    if(!groups[m]) return;
    h += '<div class="col"><div class="tiny muted" style="font-weight:700;margin:4px 2px 6px">' + esc(m) + '</div>' +
      groups[m].map((e) => {
        const owned = USERS.shared.exercises.some(x => x.name === e.name);
        return '<div class="lrow" style="border:0;padding:5px 2px"><div class="grow small">' + esc(e.name) + '</div>' +
          (owned ? '<span class="chip b3" style="padding:2px 9px;font-size:12px">已有</span>'
                 : '<button class="btn sm ghost" data-impex="' + sys.exercises.indexOf(e) + '">＋我的库</button>') + '</div>';
      }).join('') + '</div>';
  });
  body.innerHTML = '<div class="card" style="margin-bottom:0"><h3>🗂 系统动作库（只读）</h3>' +
    '<div class="tiny muted" style="margin-bottom:8px">由管理员通过后台维护，改动不影响你已有的个人库。</div>' +
    (h ? '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">' + h + '</div>'
       : '<div class="empty" style="padding:14px"><div class="e-ic" style="font-size:24px">🗂</div>系统库暂无动作</div>') + '</div>';
  $$('[data-impex]', body).forEach(btn => btn.addEventListener('click', () => {
    if(importExerciseFromSys(sys.exercises[num(btn.dataset.impex)])){ renderExLibSys(body); }
  }));
}

/* =====================================================
   身体数据
===================================================== */
const MEASURES = [
  {id:'weight', label:'体重', unit:'kg'},
  {id:'chest',  label:'胸围', unit:'cm'},
  {id:'waist',  label:'腰围', unit:'cm'},
  {id:'hip',    label:'臀围', unit:'cm'},
  {id:'arm',    label:'臂围', unit:'cm'},
  {id:'thigh',  label:'大腿围', unit:'cm'},
  {id:'bf',     label:'体脂率', unit:'%'},
];
let bodyMetric = 'weight';

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
  const chart = chartCard('chartBody', bodyMetric === 'weight' ? '体重趋势（含目标）' : (MEASURES.find(m=>m.id===bodyMetric)||{}).label + ' 趋势', '近60条 · 鼠标悬停查看数值',
    '<select class="select" id="bm_select" style="max-width:120px;padding:5px 8px">' + metricOpts + '</select>');

  // 最近记录表
  const rows = [...state.body].sort((a,b) => a.date < b.date ? 1 : -1).slice(0, 14).map(r =>
    '<tr><td>' + dateCN(r.date) + '</td>' + MEASURES.map(m => '<td>' + (r[m.id] !== undefined && r[m.id] !== null ? round(r[m.id],1) : '—') + '</td>').join('') + '</tr>').join('');
  const history = state.body.length ?
    '<div class="card" style="padding:6px 12px 12px"><div style="overflow:auto"><table class="tbl"><thead><tr><th>日期</th>' + MEASURES.map(m => '<th>' + m.label + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>'
    : '';

  const html =
    '<div class="card" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
      '<div class="goal-ring" id="bmiring">' +
        '<svg width="120" height="120"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--surface-3)" stroke-width="12"></circle><circle id="bmiringc" cx="60" cy="60" r="52" fill="none" stroke="var(--brand)" stroke-width="12" stroke-linecap="round" stroke-dasharray="326.7" stroke-dashoffset="326.7"></circle></svg>' +
        '<div class="gv"><b id="bmiringv">--</b><span class="tiny muted">BMI</span></div>' +
      '</div>' +
      '<div class="grow" style="min-width:190px">' +
        '<div class="tiny muted">当前体重</div>' +
        '<div class="hero" style="color:var(--brand-ink)">' + (w===null?'--':w.toFixed(1)) + '<span class="unit">kg</span></div>' +
        '<div class="delta ' + cls + '" style="font-size:13px">' + (delta || '&nbsp;') + '</div>' +
        '<div class="row mt" style="gap:8px"><button class="btn primary" id="bm_add">✏️ 记录今天</button>' +
        '<button class="btn" id="bm_hist">查看全部</button></div>' +
      '</div>' +
    '</div>' +
    '<div class="row mt">' + tileVals + '</div>' +
    '<div class="mt">' + chart + '</div>' +
    history;

  $('#view').innerHTML = html;
  // BMI 环
  (function ring(){
    if(bmiV === null){ $('#bmiringv').textContent = '--'; return; }
    $('#bmiringv').textContent = bmiV;
    const c = $('#bmiringc');
    const range = [15, 32];
    const frac = clamp((bmiV - range[0]) / (range[1] - range[0]), 0, 1);
    c.style.strokeDashoffset = String(326.7 * (1 - frac));
    c.setAttribute('stroke', bmiV < 18.5 ? 'var(--cat1)' : bmiV < 24 ? 'var(--brand)' : bmiV < 28 ? 'var(--warn)' : 'var(--danger)');
  })();
  $('#bm_add').addEventListener('click', () => openBodyDialog());
  $('#bm_hist').addEventListener('click', () => {
    const all = [...state.body].sort((a,b) => a.date < b.date ? 1 : -1);
    const rows = all.map(r => '<tr><td>' + dateCN(r.date) + '</td>' + MEASURES.map(m => '<td>' + (r[m.id] !== undefined && r[m.id] !== null ? round(r[m.id],1) : '—') + '</td>').join('') + '</tr>').join('');
    const dlg = showDialog('身体记录历史（共 ' + all.length + ' 条）',
      '<div style="overflow:auto;max-height:60vh"><table class="tbl"><thead><tr><th>日期</th>' + MEASURES.map(m => '<th>' + m.label + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>', {size:'lg'});
  });
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
  // 体重目标参考线
  let ref = null;
  if(metric === 'weight' && state.goal.targetKg){
    ref = { y: state.goal.targetKg, label:'目标 ' + state.goal.targetKg };
  }
  const svg = lineChartSVG({
    points: out,
    color: 'var(--brand)',
    fill: true,
    ref,
    yUnit: mdef.unit,
    fmtY: v => mdef.id === 'bf' ? v.toFixed(0) : (v < 10 ? v.toFixed(1) : v.toFixed(0)),
  });
  $('#chartBody').innerHTML = '<div class="cc-h"><div class="cc-t">' + esc(mdef.label) + ' 趋势</div><span class="cc-s">近' + out.length + '条 · 悬停看数值</span></div>' + svg;
}

/* 卡片容器 html：给统计页与身体页复用 */
function chartCard(containerId, title, sub, controls){
  return '<div class="chart-card" style="margin-bottom:16px"><div class="cc-h"><div><div class="cc-t">' + esc(title) + '</div>' + (sub ? '<div class="cc-s">' + sub + '</div>' : '') + '</div>' + (controls || '') + '</div><div id="' + containerId + '"></div></div>';
}

/* =====================================================
   今日睡眠 / 今日饮水（原「睡眠饮水」页并入概览页）
   记录仍以日期为键（state.sleep/state.water），睡眠归属"起床那天"。
   概览页两张"今日"卡直接记录当天；卡右上角 🕘 打开历史弹窗，
   弹窗内可翻任意日期查看 / 补记 / 修改 / 删除。
===================================================== */
let lifeDate = today();            // 历史弹窗内翻页的当前日期
const QUALITY = [{n:1,ic:'😖'},{n:2,ic:'😕'},{n:3,ic:'😐'},{n:4,ic:'🙂'},{n:5,ic:'😄'}];

function lifeWaterCard(d, ctx){    // ctx:'home'=概览今日卡（标题/🕘）| 'dlg'=历史弹窗卡
  const isHome = ctx === 'home';
  const wCups = waterFor(d);
  const wPct = Math.round(wCups / state.waterTarget * 100);
  return '<div class="card" style="margin-bottom:0"><h3><span>' + (isHome ? '💧 今日饮水' : '💧 饮水') + '</span><span class="grow"></span>' +
    (isHome ? '<button class="btn sm ghost" data-lifehis title="翻日期查看/补记/修改历史记录">🕘 补记</button>' : '') + '</h3>' +
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
  const sl = sleepFor(d);
  const head = '<span>' + (isHome ? '😴 今日睡眠' : '😴 睡眠') + '</span>' +
    (isHome && !sl ? '<span class="hint">起床后记录昨夜睡眠</span>' : '') +
    '<span class="grow"></span>' +
    (isHome ? '<button class="btn sm ghost" data-lifehis title="翻日期查看/补记/修改历史记录">🕘 补记</button>' : '');
  if(!sl) return '<div class="card" style="margin-bottom:0"><h3>' + head + '</h3>' +
    '<div class="form-grid">' +
      '<div><label>入睡</label><input class="input" type="time" id="sl_bed" value="23:30"></div>' +
      '<div><label>起床</label><input class="input" type="time" id="sl_wake" value="07:00"></div>' +
    '</div>' +
    '<div class="row mt" style="align-items:center;justify-content:space-between">' +
      '<div class="tiny muted">质量：</div><div class="stars" id="sl_stars">' + QUALITY.map(q => '<button class="slq on" data-q="' + q.n + '">' + q.ic + '</button>').join('') + '</div>' +
    '</div>' +
    '<div class="row mt" style="justify-content:space-between;align-items:center"><span class="tiny muted">预计睡眠 <b id="sl_prev">--</b></span>' +
    '<button class="btn primary sm" id="sl_save">保存</button></div>' +
  '</div>';
  return '<div class="card" style="margin-bottom:0"><h3>' + head + '</h3>' +
    '<div class="lrow"><div class="thumb">😴</div><div class="grow"><div class="b">' + esc(sl.bed || '--:--') + ' → ' + esc(sl.wake || '--:--') + '</div>' +
    '<div class="sub">时长 ' + round(sl.mins/60,1) + ' 小时 · ' + (sl.mins>=420?'达标':'偏少') + '</div></div>' +
    '<div class="stars">' + QUALITY.map(q => '<button class="' + (sl.quality>=q.n?'on':'') + '" disabled>' + q.ic + '</button>').join('') + '</div>' +
    '<button class="iconbtn2" data-sleedit title="修改">✏️</button></div>' +
    '<div class="row mt" style="justify-content:flex-end"><button class="btn danger ghost sm" data-sledel>删除</button></div>' +
  '</div>';
}

/* 概览页两张"今日"卡（date 恒为今天） */
function lifeTodayHTML(){
  return '<div class="grid cols-2 mt">' + lifeWaterCard(today(), 'home') + lifeSleepCard(today(), 'home') + '</div>';
}
function bindLifeToday(v){
  $$('[data-lifehis]', v).forEach(b => b.addEventListener('click', openLifeHistory));
  bindLifeCard(v, today(), 'home');
}

/* 历史弹窗：daynav 翻页 + 同两张卡（'dlg' 上下文），保存后只重绘弹窗 */
function openLifeHistory(){
  const dlg = showDialog('📅 睡眠饮水 · 历史记录', '', {size:'lg'});
  renderLifeDlg(dlg.box, dlg.close);   // 传 captured close：叠层弹窗关闭后 curDialog 已空，不能再用全局 closeDialog
}
function renderLifeDlg(b, close){
  const d = lifeDate;
  const isToday = d === today();
  b.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">' +
      '<div class="daynav"><button class="iconbtn2" data-day="-1">‹</button>' +
        '<div class="lbl">' + dateCN(d) + '<small>' + (isToday ? '今天' : '周' + DAY_CN[weekday(d)]) + '</small></div>' +
        '<button class="iconbtn2" data-day="1">›</button>' +
        (isToday ? '' : '<button class="btn sm" data-day="today">回到今天</button>') +
      '</div>' +
      '<div class="tiny muted">睡眠以「起床那天」归属 · 翻日期即可查看或补记</div>' +
    '</div>' +
    '<div class="grid cols-2">' + lifeWaterCard(d, 'dlg') + lifeSleepCard(d, 'dlg') + '</div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>关闭</button></div>';
  $$('[data-day]', b).forEach(btn => btn.addEventListener('click', () => {
    if(btn.dataset.day === 'today') lifeDate = today(); else lifeDate = addDays(lifeDate, num(btn.dataset.day));
    renderLifeDlg(b, close);
  }));
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', close);
  bindLifeCard(b, d, 'dlg', close);
}

/* 绑定 root 内的一张睡眠+饮水卡；保存后按 ctx 重绘所属表面 */
function bindLifeCard(root, d, ctx, close){
  const after = () => { if(ctx === 'home') renderHome(); else renderLifeDlg(root, close); };
  const sl = sleepFor(d);
  if(!sl){
    const starsBox = $('#sl_stars', root);
    if(starsBox){
      let q = 3;
      function paint(){ $$('.slq', starsBox).forEach(b2 => b2.classList.toggle('on', num(b2.dataset.q) <= q)); }
      paint();
      $$('.slq', starsBox).forEach(b2 => b2.addEventListener('click', () => { q = num(b2.dataset.q); paint(); }));
      function calcDur(){ const bed = $('#sl_bed', root).value, wake = $('#sl_wake', root).value; if(!bed || !wake){ $('#sl_prev', root).textContent = '--'; return null; }
        const [bh,bm] = bed.split(':').map(Number), [wh,wm] = wake.split(':').map(Number);
        let mins = (wh*60+wm) - (bh*60+bm); if(mins < 0) mins += 1440; if(mins === 0) mins = 1440;
        $('#sl_prev', root).textContent = round(mins/60,1) + ' 小时'; return mins; }
      $('#sl_bed', root).addEventListener('change', calcDur); $('#sl_wake', root).addEventListener('change', calcDur); calcDur();
      $('#sl_save', root).addEventListener('click', () => {
        const bed = $('#sl_bed', root).value, wake = $('#sl_wake', root).value;
        if(!bed || !wake){ toast('请填写入睡与起床时间', true); return; }
        state.sleep[d] = { bed, wake, mins: calcDur() || 0, quality: q };
        save(); after(); toast('已记录睡眠');
      });
    }
  } else {
    const ed = $('[data-sleedit]', root); if(ed) ed.addEventListener('click', () => sleepQuick(d, sl, after));
    const de = $('[data-sledel]', root); if(de) de.addEventListener('click', () => { delete state.sleep[d]; save(); after(); toast('已删除'); });
  }
  const wp = $('[data-wplus]', root); if(wp) wp.addEventListener('click', () => { state.water[d] = (state.water[d]||0) + 1; save(); after(); });
  const wm = $('[data-wmin]', root); if(wm) wm.addEventListener('click', () => { if(waterFor(d) > 0){ state.water[d] = waterFor(d) - 1; save(); after(); } });
}

function sleepQuick(d, sl, after){   // 修改已有睡眠记录（概览今日卡 / 历史弹窗共用）
  after = after || (() => renderHome());
  const html =
    '<div class="form-grid">' +
      '<div><label>入睡</label><input class="input" type="time" id="sq_bed" value="' + esc(sl.bed||'') + '"></div>' +
      '<div><label>起床</label><input class="input" type="time" id="sq_wake" value="' + esc(sl.wake||'') + '"></div>' +
    '</div>' +
    '<div class="row mt" style="align-items:center"><span class="tiny muted" style="margin-right:8px">质量：</span><div class="stars" id="sq_stars">' + QUALITY.map(q => '<button class="sqst on" data-q="' + q.n + '">' + q.ic + '</button>').join('') + '</div></div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="sq_save">保存</button></div>';
  const dlg = showDialog('修改睡眠', html);
  const b = dlg.box;
  let q = sl.quality;
  const sb = $('#sq_stars', b);
  function paint(){ $$('.sqst', sb).forEach(x => x.classList.toggle('on', num(x.dataset.q) <= q)); }
  paint();
  $$('.sqst', sb).forEach(x => x.addEventListener('click', () => { q = num(x.dataset.q); paint(); }));
  function dur(){ const bed = $('#sq_bed', b).value, wake = $('#sq_wake', b).value; if(!bed||!wake) return 0; let m = (wake.split(':')[0]*60 + wake.split(':')[1]*1) - (bed.split(':')[0]*60 + bed.split(':')[1]*1); if(m<0)m+=1440; return m===0?1440:m; }
  $('#sq_save', b).addEventListener('click', () => {
    state.sleep[d] = { bed: $('#sq_bed', b).value, wake: $('#sq_wake', b).value, mins: dur(), quality: q };
    save(); closeDialog(); after(); toast('已更新');
  });
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
}

function renderSleepChart(){
  const el = $('#st_sleep'); if(!el) return;
  const ds = lastNDates(14);
  const pts = ds.map(x => ({ x, y: (state.sleep[x] ? state.sleep[x].mins : 0) }));
  el.innerHTML = barChartSVG({ points: pts, color: 'var(--cat2)', target: 420, targetLabel:'7h', unit:'分钟', fmtY: v => (v/60).toFixed(1) + 'h' });
}
function renderWaterChart(){
  const el = $('#st_water'); if(!el) return;
  const ds = lastNDates(14);
  const pts = ds.map(x => ({ x, y: waterFor(x) }));
  el.innerHTML = barChartSVG({ points: pts, color: 'var(--cat1)', target: state.waterTarget, targetLabel: state.waterTarget + '杯', unit:'杯', fmtY: v => v + '' });
}

/* =====================================================
   目标
===================================================== */
function renderGoals(){
  const g = state.goal;
  const cur = latestVal('weight') || state.profile.currentKg;
  const start = g.startKg || cur;
  const tgt = g.targetKg || cur;
  const modeLabel = {cut:'减脂', bulk:'增肌', maintain:'保持'}[g.mode] || '';

  // 目标进度 hero
  const total = Math.abs(tgt - start) || 1;
  const done = Math.abs(start - cur);
  const pct = clamp(Math.round(done / total * 100), 0, 100);
  const need = Math.abs(cur - tgt);
  const dirLabel = cur > tgt ? '要减' : '要增';

  // 目标卡
  const goalCard =
    '<div class="card"><h3>🎯 主目标</h3>' +
    '<div class="row" style="align-items:center;gap:18px;flex-wrap:wrap">' +
      '<div class="goal-ring" style="width:104px;height:104px">' +
        '<svg width="104" height="104"><circle cx="52" cy="52" r="45" fill="none" stroke="var(--surface-3)" stroke-width="11"></circle><circle id="gr_c" cx="52" cy="52" r="45" fill="none" stroke="var(--brand)" stroke-width="11" stroke-linecap="round" stroke-dasharray="282.7" stroke-dashoffset="282.7"></circle></svg>' +
        '<div class="gv"><b id="gr_v" style="font-size:20px">' + pct + '%</b><span class="tiny muted">已完成</span></div>' +
      '</div>' +
      '<div class="grow" style="min-width:170px">' +
        '<div class="lrow" style="border:0;padding:3px 0"><span class="tiny muted" style="width:64px">当前</span><b>' + cur + ' kg</b></div>' +
        '<div class="lrow" style="border:0;padding:3px 0"><span class="tiny muted" style="width:64px">起点</span><span>' + start + ' kg</span></div>' +
        '<div class="lrow" style="border:0;padding:3px 0"><span class="tiny muted" style="width:64px">目标</span><span>' + tgt + ' kg · ' + modeLabel + '</span></div>' +
        (g.targetDate ? '<div class="lrow" style="border:0;padding:3px 0"><span class="tiny muted" style="width:64px">期限</span><span>' + dateCN(g.targetDate) + '</span></div>' : '') +
      '</div>' +
      '<button class="btn" id="goal_edit">修改目标</button>' +
    '</div>' +
    (g.targetDate ? '<div class="tiny muted" style="margin-top:10px">还' + dirLabel + ' <b>' + need.toFixed(1) + 'kg</b>，距期限 ' + daysTo(g.targetDate) + ' 天，约每周 ' + round(need / Math.max(1, daysTo(g.targetDate)/7), 2) + 'kg（合理区间 0.2-0.8kg/周）</div>' : '') +
    '</div>';

  // 每日目标卡（营养 + 活动量 + 饮水）
  const T = target();
  const actLabel = (ACTIVITIES.find(a => String(a.v) === String(state.activity)) || {}).label || state.activity;
  const nutCard =
    '<div class="card"><h3><span>🥗 每日目标</span><span class="grow"></span><button class="btn sm" id="nut_edit">修改目标</button></h3>' +
    '<div style="margin:2px 0 12px"><span class="hero" style="font-size:34px;color:var(--brand-ink)">' + T.kcal + '<span class="unit">kcal</span></span></div>' +
    '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">' +
      '<div class="tile" style="box-shadow:none;background:var(--surface-2);min-width:0;padding:11px 10px"><div class="lab">蛋白</div><div class="val" style="font-size:19px">' + T.p + '<span class="unit">g</span></div></div>' +
      '<div class="tile" style="box-shadow:none;background:var(--surface-2);min-width:0;padding:11px 10px"><div class="lab">碳水</div><div class="val" style="font-size:19px">' + T.c + '<span class="unit">g</span></div></div>' +
      '<div class="tile" style="box-shadow:none;background:var(--surface-2);min-width:0;padding:11px 10px"><div class="lab">脂肪</div><div class="val" style="font-size:19px">' + T.f + '<span class="unit">g</span></div></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px">' +
      '<div class="tile" style="box-shadow:none;background:var(--surface-2);min-width:0;padding:11px 10px"><div class="lab">活动量</div><div class="val" style="font-size:15px;line-height:1.35;white-space:normal">' + esc(actLabel) + '</div></div>' +
      '<div class="tile" style="box-shadow:none;background:var(--surface-2);min-width:0;padding:11px 10px"><div class="lab">每日饮水</div><div class="val" style="font-size:19px">' + state.waterTarget + '<span class="unit">杯</span></div></div>' +
    '</div>' +
    '<div class="tiny muted mt">目标基于 BMR ' + Math.round(bmr()) + ' kcal × 活动系数 ' + state.activity + (state.goal.mode!=='maintain' ? ' 及' + (state.goal.mode==='cut'?'-400':'+300') + ' 调整' : '') + (state.nutrition.auto ? '（自动计算中）' : '（当前为手动设定）') + '；饮水目标用于概览页「今日饮水」卡的达标判断。点右上角「修改目标」可调整。</div>' +
    '</div>';

  const html = goalCard + nutCard;
  $('#view').innerHTML = html;
  const gr = $('#gr_c');
  gr.style.strokeDashoffset = String(282.7 * (1 - pct/100));
  $('#goal_edit').addEventListener('click', openGoalEditor);
  $('#nut_edit').addEventListener('click', openNutritionEditor);
}


/* ---------- 每日目标编辑（营养 + 活动量 + 饮水，目标页） ---------- */
function openNutritionEditor(){
  const n = state.nutrition;
  const html =
    '<div class="chkline" style="margin-bottom:12px"><input type="checkbox" id="ne_auto"' + (n.auto ? ' checked' : '') + '> <span>根据基础代谢与目标自动计算</span></div>' +
    '<div class="form-grid">' +
      '<div class="span2"><label>日常活动量</label><select class="select" id="ne_act">' + ACTIVITIES.map(a => '<option value="' + a.v + '">' + a.label + '</option>').join('') + '</select></div>' +
      '<div class="span2"><label>每日饮水目标（杯）</label><input class="input" id="ne_water" type="number" min="1" max="30" value="' + state.waterTarget + '"></div>' +
    '</div>' +
    '<div class="form-grid mt" id="neGrid">' +
      '<div><label>热量 kcal</label><input class="input" id="ne_kcal" type="number" value="' + (n.kcal || '') + '"></div>' +
      '<div><label>蛋白质 g</label><input class="input" id="ne_protein" type="number" value="' + (n.protein || '') + '"></div>' +
      '<div><label>碳水 g</label><input class="input" id="ne_carbs" type="number" value="' + (n.carbs || '') + '"></div>' +
      '<div><label>脂肪 g</label><input class="input" id="ne_fat" type="number" value="' + (n.fat || '') + '"></div>' +
    '</div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="ne_save">保存</button></div>';
  const dlg = showDialog('修改每日目标', html);
  const b = dlg.box;
  $('#ne_act', b).value = String(state.activity);
  const c0 = calcNutrition();
  $('#ne_kcal', b).value = n.kcal || c0.kcal;
  $('#ne_protein', b).value = n.protein || c0.protein;
  $('#ne_carbs', b).value = n.carbs || c0.carbs;
  $('#ne_fat', b).value = n.fat || c0.fat;
  const setNut = on => {
    $$('#neGrid input', b).forEach(i => i.disabled = on);
    if(on){ const c = calcNutrition(); $('#ne_kcal', b).value = c.kcal; $('#ne_protein', b).value = c.protein; $('#ne_carbs', b).value = c.carbs; $('#ne_fat', b).value = c.fat; }
  };
  $('#ne_auto', b).addEventListener('change', e => setNut(e.target.checked));
  setNut(n.auto);
  $('#ne_save', b).addEventListener('click', () => {
    state.activity = num($('#ne_act', b).value);
    state.waterTarget = clamp(num($('#ne_water', b).value) || state.waterTarget, 1, 40);
    state.nutrition = { auto:$('#ne_auto', b).checked, kcal:num($('#ne_kcal', b).value), protein:num($('#ne_protein', b).value), carbs:num($('#ne_carbs', b).value), fat:num($('#ne_fat', b).value) };
    syncNutrition(); save(); closeDialog(); renderGoals(); renderHome(); toast('已保存');
  });
  const cx = $('[data-cancel]', b); if(cx) cx.addEventListener('click', closeDialog);
}

/* ---------- 每日打卡卡（展示在概览页） ---------- */
function habitCardHTML(){
  const t = today();
  const ds = lastNDates(7);
  const colHead = ds.map(d => '<span>' + (d===t ? '今' : (parseISO(d).getDate() + '')) + '</span>').join('');
  const nameRows = state.habits.map(h => {
    const strk = habitStreak(h, t);
    return '<div class="hab-n"><span style="font-size:17px">' + h.icon + '</span><span class="nm">' + esc(h.name) + '</span>' +
      (strk > 0 ? '<span class="tiny muted" title="连续天数">🔥' + strk + '</span>' : '') +
      '<button class="iconbtn2" data-delhab="' + h.id + '" style="width:24px;height:24px;font-size:11px;color:var(--danger);flex:0 0 auto">🗑</button></div>';
  }).join('');
  const dayRows = state.habits.map(h => {
    const cells = ds.map(d => {
      const done = !!h.done[d];
      const future = d > t;
      return '<div class="hab-cell"><button class="hab-dot ' + (done?'on':'') + (future?' future':'') + '" data-hab="' + h.id + '" data-day="' + d + '" style="' + (done?'background:' + h.color + ';border-color:' + h.color + '':'') + '" title="' + (future?'':'点击打卡') + '">✓</button></div>';
    }).join('');
    return '<div class="hab-r">' + cells + '</div>';
  }).join('');

  return '<div class="card"><h3>📌 每日打卡 <span class="hint">点圆圈切换当天完成</span></h3>' +
    '<div class="hab-flex">' +
      '<div class="hab-names"><div class="hab-h">&nbsp;</div>' + nameRows + '</div>' +
      '<div class="hab-days"><div class="hab-days-in"><div class="hab-h">' + colHead + '</div>' + dayRows + '</div></div>' +
    '</div>' +
    '<div class="row mt" style="align-items:end;gap:8px">' +
      '<div style="flex:1"><label class="tiny muted">新习惯</label><input class="input" id="nhab_name" placeholder="如：不吃零食"></div>' +
      '<div style="width:64px"><label class="tiny muted">图标</label><input class="input" id="nhab_icon" maxlength="2" value="✅"></div>' +
      '<div style="width:110px"><label class="tiny muted">颜色</label><select class="select" id="nhab_color"><option value="var(--brand)">绿</option><option value="var(--cat1)">蓝</option><option value="var(--cat2)">橙</option><option value="var(--cat3)">青</option></select></div>' +
      '<button class="btn primary" id="nhab_add">添加</button></div></div>';
}
function bindHabitEvents(){
  const v = $('#view');
  $$('[data-hab]', v).forEach(btn => btn.addEventListener('click', () => {
    if(btn.classList.contains('future')) return;
    const h = state.habits.find(x => x.id === btn.dataset.hab);
    const d = btn.dataset.day;
    if(h.done[d]) delete h.done[d]; else h.done[d] = true;
    save(); renderHome();
  }));
  $$('[data-delhab]', v).forEach(btn => btn.addEventListener('click', () => {
    state.habits = state.habits.filter(h => h.id !== btn.dataset.delhab); save(); renderHome();
  }));
  $('#nhab_add', v).addEventListener('click', () => {
    const name = $('#nhab_name', v).value.trim(); if(!name){ toast('请填写习惯名', true); return; }
    state.habits.push({ id:uid(), name, icon: $('#nhab_icon', v).value || '✅', color: $('#nhab_color', v).value, done:{} });
    save(); renderHome();
  });
}
function daysTo(s){ return Math.round((parseISO(s) - parseISO(today())) / 86400000); }

function openGoalEditor(){
  const g = state.goal;
  const cur = latestVal('weight') || state.profile.currentKg;
  const html =
    '<div class="field"><label>当前目标</label><select class="select" id="ge_mode">' +
      '<option value="cut"' + (g.mode==='cut'?' selected':'') + '>减脂（热量赤字）</option>' +
      '<option value="maintain"' + (g.mode==='maintain'?' selected':'') + '>保持</option>' +
      '<option value="bulk"' + (g.mode==='bulk'?' selected':'') + '>增肌（热量盈余）</option></select></div>' +
    '<div class="form-grid">' +
      '<div><label>起点体重 kg</label><input class="input" id="ge_start" type="number" step="0.1" value="' + (g.startKg || cur) + '"></div>' +
      '<div><label>目标体重 kg</label><input class="input" id="ge_target" type="number" step="0.1" value="' + (g.targetKg || cur) + '"></div>' +
      '<div class="span2"><label>目标日期（可留空）</label><input class="input" type="date" id="ge_date" value="' + (g.targetDate || '') + '"></div>' +
    '</div>' +
    '<div class="d-f"><button class="btn ghost" data-cancel>取消</button><button class="btn primary" id="ge_save">保存</button></div>';
  const dlg = showDialog('设定目标', html);
  const b = dlg.box;
  $('#ge_save', b).addEventListener('click', () => {
    state.goal.mode = $('#ge_mode', b).value;
    state.goal.startKg = num($('#ge_start', b).value) || cur;
    state.goal.targetKg = num($('#ge_target', b).value) || state.goal.startKg;
    state.goal.targetDate = $('#ge_date', b).value || '';
    syncNutrition(); save(); closeDialog(); renderGoals(); renderHome();
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
      '<title>' + esc(p.x + ' · ' + (o.fmtVal || (v=>String(Math.round(v))))(p.y)) + '</title></rect>';
    if(i % step === 0) s += '<text x="' + cx + '" y="' + (CHART_H - 10) + '" text-anchor="middle" font-size="10.5" fill="' + CX.ax + '">' + esc((o.fmtX || (x=>x))(p.x)) + '</text>';
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
   统计看板
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
    const sl = sleepFor(x); if(sl){ sleepSum += sl.mins; sleepCnt++; }
  });
  const wk30 = state.workouts.filter(w => w.date >= d30[0] && w.date <= today()).length;
  const wNow = latestVal('weight');
  const w30 = bodyVal('weight', d30[0]);
  let wDelta = null, wDeltaCls = '';
  if(wNow !== null && w30 !== null){ wDelta = wNow - w30; wDeltaCls = wDelta > 0 ? 'up' : (wDelta < 0 ? 'down' : ''); }
  // 近7天习惯完成率
  let done7 = 0, tot7 = 0;
  lastNDates(7).forEach(d => state.habits.forEach(h => { tot7++; if(h.done[d]) done7++; }));
  return {
    avgKcal: kcalCnt ? Math.round(kcalSum/kcalCnt) : null,
    wk30, wDelta, wDeltaCls,
    avgSleep: sleepCnt ? Math.round(sleepSum/sleepCnt/60*10)/10 : null,
    avgWater: waterCnt ? Math.round(waterSum/waterCnt*10)/10 : null,
    habitRate: tot7 ? Math.round(done7/tot7*100) : null,
  };
}
function renderStats(){
  const S = statSummary();
  const T = target();
  const tiles =
    tileHTML('近30天平均摄入', S.avgKcal === null ? '--' : fmtNum(S.avgKcal), 'kcal', '目标 ' + fmtNum(T.kcal), '') +
    tileHTML('训练次数(30天)', S.wk30, '次', '') +
    tileHTML('体重变化(30天)', wDeltaText(S), '', '') +
    tileHTML('平均睡眠', S.avgSleep === null ? '--' : S.avgSleep, 'h', '');
  const tiles2 =
    tileHTML('平均饮水', S.avgWater === null ? '--' : S.avgWater, '杯', '') +
    tileHTML('打卡完成率(7天)', S.habitRate === null ? '--' : S.habitRate + '%', '', '') +
    tileHTML('当前BMI', bmi() === null ? '--' : bmi(), '', '') +
    tileHTML('距目标', (state.goal.targetKg ? (Math.abs(latestVal('weight')||state.profile.currentKg - state.goal.targetKg)).toFixed(1) : '--'), 'kg', '');

  // 图表容器
  const c1 = chartWrap('体重趋势', '近120条记录 · 虚线为目标体重', 'st_weight', '');
  const c2 = chartWrap('每日热量 vs 目标', '近30天', 'st_cal', '');
  const c3 = chartWrap('宏量营养素摄入', '近14天 · kcal', 'st_macro', legendHTML([{label:'蛋白',color:CX.c1},{label:'碳水',color:CX.c2},{label:'脂肪',color:CX.c3}]));
  const c4 = chartWrap('每周训练容量', '近12周 · Σ重量×次数', 'st_vol', '');
  const c5 = chartWrap('睡眠时长', '近14天 · 虚线为目标 7 小时', 'st_sleep', '');
  const c6 = chartWrap('每日饮水量', '近14天 · 虚线为每日目标', 'st_water', '');

  const html =
    '<div class="row">' + tiles + '</div>' +
    '<div class="row mt">' + tiles2 + '</div>' +
    '<div class="mt">' + c1 + '</div>' +
    '<div class="grid cols-2">' + c2 + '</div>' +
    '<div>' + c3 + '</div>' +
    '<div>' + c4 + '</div>' +
    '<div class="grid cols-2">' + c5 + c6 + '</div>';

  $('#view').innerHTML = html;

  // 体重图
  const wRecs = state.body.filter(r => r.weight !== undefined && r.weight !== null);
  const wPts = wRecs.slice(Math.max(0, wRecs.length - 120)).map(r => ({ x:r.date, y:r.weight }));
  $('#st_weight').innerHTML = lineChartSVG({
    points: wPts, color: CX.brand, area: true,
    ref: { y: state.goal.targetKg || null, label: state.goal.targetKg ? '目标 ' + state.goal.targetKg + 'kg' : null },
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
    fmtVal: v => v + ' kg', fmtX: x => 'W' + x.wk,
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
function weeklyVolumes(weeks){
  const out = [];
  const curMonday = mondayOf(today());
  for(let k = weeks - 1; k >= 0; k--){
    const ws = addDays(curMonday, -7*k);
    const we = addDays(ws, 7);
    let vol = 0;
    state.workouts.forEach(w => { if(w.date >= ws && w.date < we) vol += wkVolume(w); });
    out.push({ x: ws, y: Math.round(vol), wk: 'W' + (weeks - k) });
  }
  return out;
}

/* =====================================================
   启动
===================================================== */
function runSelfTest(){
  const errs = [];
  try {
    demoData();
    const views = ['home','diet','train','body','goals','stats'];
    views.forEach(v => {
      try { curView = v; rebuildNav(); renderView(); errs.push(v + ':ok'); }
      catch(e){ errs.push(v + ':ERR ' + e.message); }
    });
    const audit = [];
    const vid = $('#view');
    audit.push('viewLen=' + (vid ? vid.innerHTML.length : -1));
    audit.push('svgs=' + document.querySelectorAll('#view svg').length);
    audit.push('rects=' + document.querySelectorAll('#view rect').length);
    audit.push('paths=' + document.querySelectorAll('#view path').length);
    audit.push('circles=' + document.querySelectorAll('#view circle').length);
    ['st_weight','st_cal','st_macro','st_vol'].forEach(id => {
      const el = $('#' + id);
      audit.push(id + '_svg=' + (el && el.innerHTML.indexOf('<svg') >= 0 ? 'y' : 'n') + (el ? '_len=' + el.innerHTML.length : ''));
    });
    audit.push('tiles=' + document.querySelectorAll('#view .tile').length);
    const box = document.createElement('pre');
    box.id = 'selftest';
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;background:#fff;color:#c00;padding:10px;font:12px monospace;max-width:90vw;white-space:pre-wrap';
    box.textContent = errs.join('\n') + '\n---AUDIT---\n' + audit.join('\n');
    document.body.appendChild(box);
  } catch(e2){ const box = document.createElement('pre'); box.id='selftest'; box.textContent='FATAL ' + e2.message; document.body.appendChild(box); }
}
function runFTest(){
  const L = [];
  const _preState = JSON.stringify(USERS);   /* adoptRoundtrip 用例会内存态改写为旧版单人，测试后须恢复，避免污染共享服务器数据 */
  function T(name, fn){ try { fn(); L.push(name + ':ok'); } catch(e){ L.push(name + ':ERR ' + e.message); } }
  T('mealAdd', () => { const b4 = dayTotals(today()).kcal; addMealItem(today(), 'lunch', mealItem(state.foods[1], 150)); if(dayTotals(today()).kcal <= b4) throw new Error('kcal-not-increased'); });
  T('upsertBody', () => { const b4 = state.body.length; upsertBody({ date: today(), weight: 70.5, waist: 86 }); const lb = bodyLatest(); if(!lb || lb.weight !== 70.5) throw new Error('latest-wrong'); });
  T('water', () => { state.water[today()] = (state.water[today()] || 0) + 1; if(waterFor(today()) < 1) throw new Error('water-fail'); });
  T('sleep', () => { state.sleep[today()] = { bed:'23:00', wake:'07:30', mins:510, quality:5 }; if(!sleepFor(today())) throw new Error('sleep-fail'); });
  T('habit', () => { const h = state.habits[0]; h.done[today()] = true; if(habitStreak(h, today()) < 1) throw new Error('streak-fail'); });
  T('goalSave', () => { openGoalEditor(); const b = curDialog.box; $('#ge_mode', b).value = 'bulk'; $('#ge_target', b).value = 75; $('#ge_save', b).click(); if(state.goal.mode !== 'bulk') throw new Error('goal-not-saved'); });
  T('mealDialog', () => { dietDate = today(); renderDiet(); addMealDialog(today(), 'dinner'); const b = curDialog.box; $('#mi_name', b).value = '测试餐'; $('#mi_kcal', b).value = 100; $('#mi_p', b).value = 10; $('#mi_c', b).value = 10; $('#mi_f', b).value = 5; $('#mi_g', b).value = 200; $('#mi_save', b).click(); if(dayTotals(today()).kcal < 10) throw new Error('meal-dialog-not-saved'); });
  T('workoutCore', () => { const before = state.workouts.length; state.workouts.push({ id:uid(), date:today(), name:'测试', items:[{ id:uid(), exId:state.exercises[0].id, exName:state.exercises[0].name, muscle:state.exercises[0].muscle, sets:[{reps:8, weight:60},{reps:8, weight:60}] }] }); const w = state.workouts[state.workouts.length-1]; if(wkVolume(w) !== 960) throw new Error('vol-wrong'); const pr = isPR(state.exercises[0].id, today(), [{reps:8, weight:200}]); if(!pr.wPR) throw new Error('pr-false'); if(state.workouts.length <= before) throw new Error('not-added'); });
  T('workoutDlg', () => {
    const before = state.workouts.length;
    openWorkoutDlg(today());
    let ovs = $$('.overlay');
    $('#wl_addex', ovs[ovs.length-1]).click();
    ovs = $$('.overlay');
    const pick = $('[data-pick]', ovs[ovs.length-1]);
    if(!pick) throw new Error('no-picker-item');
    pick.click();
    ovs = $$('.overlay');
    $('#wl_save', ovs[ovs.length-1]).click();
    if(state.workouts.length <= before) throw new Error('dlg-not-saved');
  });
  T('plans', () => { let mon = null; for(let i = 0; i < 400 && !mon; i++){ const d = addDays(today(), -i); if(weekday(d) === 1) mon = d; } if(!planForDate(mon)) throw new Error('monday-plan-missing'); });
  T('charts', () => { const s1 = lineChartSVG({ points:[{x:'2026-01-01',y:1},{x:'2026-01-02',y:3}], color:CX.brand }); if(s1.indexOf('<svg') < 0) throw new Error('line-no-svg'); const s2 = groupedBarSVG({ days:['2026-01-01','2026-01-02'], series:[{label:'a', color:CX.c1, data:[1,2]}] }); if(s2.indexOf('<rect') < 0) throw new Error('bar-no-rect'); });
  T('selfTree', () => {
    /* v4:任何时刻树里只有本账户一位成员 */
    if(userCount() !== 1) throw new Error('should-have-1-user');
    const sid = selfUid();
    if(sid && Object.keys(USERS.users)[0] !== sid) throw new Error('uid-mismatch');
  });
  T('adoptRoundtrip', () => {
    const snap = JSON.parse(JSON.stringify(USERS));
    if(!adoptRaw(snap)) throw new Error('v4-adopt-fail');
    normalizeSelfTree(); materialize();
    if(userCount() !== 1) throw new Error('count-should-be-1');
    const leg = { profile:{gender:'male',birthYear:1988,height:180,currentKg:90}, theme:'dark', onboarded:true, foods:[], exercises:[], body:[{date:today(), weight:90}] };
    if(!adoptRaw(leg)) throw new Error('legacy-adopt-fail');
    normalizeSelfTree(); materialize();
    if(userCount() !== 1) throw new Error('legacy-user-fail');
    if(activeUser().profile.currentKg !== 90) throw new Error('legacy-kg-fail');
    if(!USERS.shared.foods.length) throw new Error('shared-seed-missing');
  });
  /* 恢复测试前状态并落盘推送，防止 adoptRoundtrip 的旧版单人态污染服务器 */
  if(adoptRaw(JSON.parse(_preState))){ materialize(); save(); }
  const box = document.createElement('pre');
  box.id = 'selftest';
  box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;background:#fff;color:#0a0;padding:10px;font:12px monospace;max-width:90vw;white-space:pre-wrap';
  box.textContent = L.join('\n');
  document.body.appendChild(box);
}
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

async function startMain(offlineBoot){
  await load();
  rebuildNav();
  const qs = new URLSearchParams(location.search);
  if(qs.has('probe')){
    const u = activeUser();
    const pre = document.createElement('pre');
    pre.id = 'selftest';
    pre.textContent = JSON.stringify({ user:activeUser().name, uid:selfUid(), role:me&&me.role, kg:u.profile.currentKg, body:u.body.length, foods:USERS.shared.foods.length, ex:USERS.shared.exercises.length, theme:USERS.theme, onboarded:!!USERS.onboarded });
    document.body.appendChild(pre);
    return;
  }
  if(qs.has('selftest')){ runSelfTest(); return; }
  if(qs.has('ftest')){ demoData(); runFTest(); return; }
  if(qs.has('shot')){ demoData(); if(NAV.some(n => n.id === qs.get('shot'))) go(qs.get('shot')); return; }
  if(offlineBoot){ srv.online = false; toast('服务器离线：正显示本机缓存，恢复后自动补同步', true); }
  if(!USERS.onboarded){ showOnboard(); }
  go('home');
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
init();
