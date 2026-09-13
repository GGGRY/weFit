/* =====================================================
   同步切片契约 —— 唯一来源（v4.20）
   - 浏览器：index.html 在 app.js 之前加载本文件，前端直接用全局
   - 服务端：server/mapper.js require('../public/js/slices.js')
   为什么单独成文件：同 sleep-shape.js —— 切片边界（哪一块状态属于哪个 key、值长什么样、
   怎么读怎么写）必须在前后端**同一套**，两份手抄必然漂移（本项目在 seed-data、
   MUSCLES/GOAL_ADJ、睡眠形状上踩过多次）。

   背景：旧同步粒度是「本账户整树」——一次打勾就把本人 9 张表的行全删全插，
   冲突也按整账户算。切片化后：**写只写脏片、CAS 按片、冲突只冲突同片**。

   切片语法（`(账户, date)` 是天然原子单位）：
     固定片  profile / lib / body / habits
     逐日片  meals:<date> / workouts:<date> / sleep:<date> / water:<date> / habitdone:<date>
   值形状 = 该片在状态树里的那一块（见下），值 null / 键缺失一律表示「删除该片」。

   约定：
   - 值里的键「缺失」与 null 语义不同（与 mapper 的 jz/put 同一取向）：缺失 = 不动这一列。
   - body 不拆日：body_records 的 seq 是位置语义，拆日会错位；habits 拆成
     「定义（habits）」＋「逐日打卡（habitdone:<date>）」两片，同一天打卡才不会跟
     改习惯名互撞。
   ===================================================== */

const SLICE_PROFILE = 'profile';
const SLICE_LIB = 'lib';
const SLICE_BODY = 'body';
const SLICE_HABITS = 'habits';

/* 逐日片：kind:date */
const SLICE_DAY_KINDS = ['meals', 'workouts', 'sleep', 'water', 'habitdone'];
const SLICE_FIXED = [SLICE_PROFILE, SLICE_LIB, SLICE_BODY, SLICE_HABITS];

/* profile 片涵盖 users 行的全部列（账户设置 + 档案 + 界面偏好）：一条 UPDATE 就能写完，
 * 且这些字段都是「手动改一次、极少并发」的量级，无需再拆细。 */
const PROFILE_KEYS = ['name', 'avatar', 'color', 'activity', 'waterTarget', 'profile', 'goal', 'nutrition'];
const PREF_KEYS = ['homeOrder', 'bodyHidden', 'chartOrder'];

const SLICE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* 每类片的值形状（v4.20）：服务端写入口的护栏与前端脏片比对都靠它。
 * 与 sliceValue/writeSlice 同住一份，就是「形状契约」唯一的家——服务端不要再抄一份。 */
const SLICE_VALUE_TYPE = {
  profile: 'object', lib: 'object', body: 'array', habits: 'array',
  meals: 'object', workouts: 'object', sleep: 'array', water: 'number', habitdone: 'object',
};

function sliceDayKey(kind, date) { return kind + ':' + date; }

/* 'meals:2026-09-13' → {kind:'meals', date:'2026-09-13'}；非法/未知 → null */
function parseSliceKey(key) {
  if (typeof key !== 'string') return null;
  if (SLICE_FIXED.indexOf(key) >= 0) return { kind: key, date: null };
  const i = key.indexOf(':');
  if (i <= 0) return null;
  const kind = key.slice(0, i), date = key.slice(i + 1);
  if (SLICE_DAY_KINDS.indexOf(kind) < 0 || !SLICE_DATE_RE.test(date)) return null;
  return { kind: kind, date: date };
}
function isValidSliceKey(key) { return parseSliceKey(key) !== null; }

/* 状态树恒为「单一成员 = 本账户档案」；这里按 active → 唯一键兜底取那一位 */
function selfUser(tree) {
  if (!tree || !tree.users) return null;
  return tree.users[tree.active] || tree.users[Object.keys(tree.users)[0]] || null;
}

const asArr = v => (Array.isArray(v) ? v : []);
const putIf = (o, k, v) => { if (v !== undefined && v !== null) o[k] = v; };

/* ---------- 读：树上取出某片的值（不存在 → undefined） ---------- */
function sliceValue(tree, key) {
  const p = parseSliceKey(key);
  if (!p || !tree) return undefined;   /* 树还没建好（启动裁决早期）也不能抛 */
  if (p.kind === SLICE_PROFILE) {
    const out = {};
    if (tree.theme !== undefined) out.theme = tree.theme;
    out.onboarded = !!tree.onboarded;
    const u = selfUser(tree);
    if (u) PROFILE_KEYS.concat(PREF_KEYS).forEach(k => putIf(out, k, u[k]));
    return out;
  }
  if (p.kind === SLICE_LIB) {
    const s = (tree && tree.shared) || {};
    return { foods: asArr(s.foods), exercises: asArr(s.exercises) };
  }
  const u = selfUser(tree);
  if (!u) return undefined;
  if (p.kind === SLICE_BODY) return asArr(u.body);
  if (p.kind === SLICE_HABITS) {
    return asArr(u.habits).map(h => {
      const o = {};
      putIf(o, 'id', h && h.id); putIf(o, 'name', h && h.name);
      putIf(o, 'icon', h && h.icon); putIf(o, 'color', h && h.color);
      return o;
    });
  }
  if (p.kind === 'meals') {
    const dm = (u.meals || {})[p.date];
    return (dm === undefined || dm === null) ? undefined : dm;   /* null = 没有这一天（与键缺失同义） */
  }
  if (p.kind === 'workouts') {
    const w = asArr(u.workouts).find(x => x && x.date === p.date);
    return w === undefined ? undefined : w;
  }
  if (p.kind === 'sleep') {
    const v = (u.sleep || {})[p.date];
    return (v === undefined || v === null) ? undefined : v;
  }
  if (p.kind === 'water') {
    const v = (u.water || {})[p.date];
    return (v === undefined || v === null) ? undefined : v;   /* 0 杯是有效记录，不能当缺片 */
  }
  if (p.kind === 'habitdone') {
    /* 键按 id 排序：这一片的值形状必须与「习惯定义数组的顺序」无关——
     * 否则只是两端习惯顺序不同（或用户调整了习惯顺序）就会让**每一天**看起来都变了，
     * 按片同步下就是一次全量重推（值一模一样，纯浪费，也会搅乱冲突判定与测试）。 */
    const done = {};
    asArr(u.habits).filter(h => h && h.id && h.done && h.done[p.date]).map(h => h.id).sort()
      .forEach(id => { done[id] = true; });
    return Object.keys(done).length ? done : undefined;   /* 空集合 = 无这一片 */
  }
  return undefined;
}

/* ---------- 写：把某片的值写回树上（null/undefined → 删除该片） ---------- */
function writeSlice(tree, key, value) {
  const p = parseSliceKey(key);
  if (!p || !tree) return false;
  const del = value === undefined || value === null;
  if (p.kind === SLICE_PROFILE) {
    if (del) return false;                       /* profile 片恒在场，不允许整片删除 */
    /* 整列替换语义（与整树 PUT 时 jz/nz 写这一行的效果逐一对应）：
     * 值里缺的键 = 清空该列，而不是「不动」——否则「逐片写」与「整树写」两路会分叉 */
    const v = value;
    tree.theme = (v.theme === undefined || v.theme === null) ? 'light' : v.theme;
    tree.onboarded = !!v.onboarded;
    const u = selfUser(tree);
    if (!u) return false;
    PROFILE_KEYS.concat(PREF_KEYS).forEach(k => {
      if (v[k] === undefined || v[k] === null) delete u[k];
      else u[k] = v[k];
    });
    return true;
  }
  if (p.kind === SLICE_LIB) {
    tree.shared = tree.shared || {};
    tree.shared.foods = del ? [] : asArr(value.foods);
    tree.shared.exercises = del ? [] : asArr(value.exercises);
    return true;
  }
  const u = selfUser(tree);
  if (!u) return false;
  if (p.kind === SLICE_BODY) { u.body = del ? [] : asArr(value); return true; }
  if (p.kind === SLICE_HABITS) {
    const defs = del ? [] : asArr(value);
    const old = asArr(u.habits);
    u.habits = defs.map((d, i) => {
      const o = Object.assign({}, d);
      if (!o.id) o.id = 'h_seq_' + i;                  /* 与服务端 insertUserData 的兜底 id 同一口径 */
      const prev = old.find(h => h && h.id === o.id);
      o.done = (prev && prev.done) ? prev.done : {};   /* 打卡记录按 id 保留；新习惯从空开始 */
      return o;
    });
    return true;
  }
  if (p.kind === 'meals') {
    u.meals = u.meals || {};
    if (del) delete u.meals[p.date]; else u.meals[p.date] = value;
    return true;
  }
  if (p.kind === 'workouts') {
    u.workouts = asArr(u.workouts);
    const i = u.workouts.findIndex(x => x && x.date === p.date);
    if (del) { if (i >= 0) u.workouts.splice(i, 1); return true; }
    const w = Object.assign({}, value, { date: p.date });   /* 日期以键为准 */
    if (i >= 0) u.workouts[i] = w; else u.workouts.push(w); /* 位置：在则原地、不在则末尾（与服务端 seq=max+1 同序） */
    return true;
  }
  if (p.kind === 'sleep') {
    u.sleep = u.sleep || {};
    if (del) delete u.sleep[p.date]; else u.sleep[p.date] = value;
    return true;
  }
  if (p.kind === 'water') {
    u.water = u.water || {};
    if (del) delete u.water[p.date]; else u.water[p.date] = value;
    return true;
  }
  if (p.kind === 'habitdone') {
    const set = del ? {} : (value || {});
    asArr(u.habits).forEach(h => {
      if (!h) return;
      h.done = h.done || {};
      if (set[h.id]) h.done[p.date] = true; else delete h.done[p.date];
    });
    return true;
  }
  return false;
}

/* 树上**当前存在**的全部切片键（已规范化树的固定片恒在场） */
function sliceKeysOf(tree) {
  const out = SLICE_FIXED.slice();
  const u = selfUser(tree);
  if (!u) return out;
  const add = k => { if (out.indexOf(k) < 0) out.push(k); };
  Object.keys(u.meals || {}).forEach(d => add(sliceDayKey('meals', d)));
  asArr(u.workouts).forEach(w => { if (w && w.date) add(sliceDayKey('workouts', w.date)); });
  Object.keys(u.sleep || {}).forEach(d => add(sliceDayKey('sleep', d)));
  Object.keys(u.water || {}).forEach(d => add(sliceDayKey('water', d)));
  const dates = {};
  asArr(u.habits).forEach(h => Object.keys((h && h.done) || {}).forEach(d => {
    if ((h.done || {})[d]) dates[d] = true;
  }));
  Object.keys(dates).forEach(d => add(sliceDayKey('habitdone', d)));
  return out;
}

/* 两片值是否等价（对象键序无关、数组顺序有关；undefined 与 null 都算「无」）。
 * 用途：冲突判定先做一次内容比对——多标签页、离线重启最容易撞上「两边其实是同一份内容」的假冲突。 */
function sliceValueEq(a, b) {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b || typeof a !== 'object') return false;
  const aa = Array.isArray(a), bb = Array.isArray(b);
  if (aa !== bb) return false;
  if (aa) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sliceValueEq(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  for (let i = 0; i < ka.length; i++) if (!sliceValueEq(a[ka[i]], b[ka[i]])) return false;
  return true;
}

/* 序列化一件切片（脏片比对用）；键不存在 → undefined */
function serializeSlice(tree, key) {
  const v = sliceValue(tree, key);
  return v === undefined ? undefined : JSON.stringify(v);
}

/* 人话名（冲突弹窗/提示里给用户看，别甩 meal:2026-09-13 这种键名） */
const SLICE_FIXED_LABEL = {
  profile: '账户设置', lib: '我的库', body: '身体记录', habits: '习惯设置',
};
const SLICE_DAY_LABEL = {
  meals: '饮食', workouts: '运动', sleep: '睡眠', water: '饮水', habitdone: '打卡',
};
function sliceLabel(key) {
  const p = parseSliceKey(key);
  if (!p) return String(key);
  if (p.kind in SLICE_FIXED_LABEL) return SLICE_FIXED_LABEL[p.kind];
  const md = p.date.slice(5).split('-');
  return Number(md[0]) + '月' + Number(md[1]) + '日 ' + (SLICE_DAY_LABEL[p.kind] || p.kind);
}

/* Node 侧（server/mapper.js）经 CommonJS 取用；浏览器里这行是无害空操作 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SLICE_PROFILE, SLICE_LIB, SLICE_BODY, SLICE_HABITS,
    SLICE_DAY_KINDS, SLICE_FIXED, PROFILE_KEYS, PREF_KEYS, SLICE_VALUE_TYPE,
    sliceDayKey, parseSliceKey, isValidSliceKey, sliceValue, writeSlice,
    sliceKeysOf, serializeSlice, sliceLabel, sliceValueEq,
  };
}
