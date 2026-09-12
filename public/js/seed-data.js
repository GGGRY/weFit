/* =====================================================
   食物/动作库种子数据 —— 数据本体在 seed-data.json，本文件只做枚举与加载
   - 数据源：public/js/seed-data.json（唯一数据源，禁止在 JS 里另抄一份）
   - 浏览器：index.html 在 app.js 之前加载本文件；本文件同步读取同目录 seed-data.json
   - 服务端：server/seed.js require('../public/js/seed-data.js')；Node 侧直接 require JSON
   历史上两份手抄（app.js 与 server/seed.js）已发生数值漂移（香蕉/苹果的 f），
   收敛为本 JSON 后禁止再在任何一侧另抄一份。
   v4.4：肌群枚举 SEED_MUSCLES 一并收编（曾各抄一份于 app.js 与 admin.html）。
   v4.11：动作库三件套 —— cat 大类 / muscle 部位 / mode 计数方式，三者正交：
       杠铃卧推 = 力量 · 胸 · 计次     跑步 = 有氧 · 全身 · 计时
       平板支撑 = 力量 · 核心 · 计时（"是什么"与"怎么计数"互不决定）
   增删枚举只改这里：app.js / admin.html 同源读取，服务端 sanitizeLibrary 白名单亦引用同一常量。
   * 旧字段名 muscle 保留原语义（部位），另加 cat 装大类 —— 不是改名。
   ===================================================== */
const SEED_CATS = ['力量','有氧','课程','球类','柔韧','其他'];
const SEED_MUSCLES = ['胸','背','腿','肩','手臂','核心','全身','其他'];
const SEED_MODES = ['reps','time'];
const SEED_MODE_CN = { 'reps':'计次', 'time':'计时' };           /* 展示用中文名（前端与 admin 同源，防两处漂移） */
/* 表单默认值：只是预选，不是约束（有氧也能标"腿"，计时也能是"核心"） */
const SEED_MODE_DEFAULT = {'力量':'reps','有氧':'time','课程':'time','球类':'time','柔韧':'time','其他':'reps'};
const SEED_MUSCLE_DEFAULT = {'力量':'胸'};           // 其余大类默认 '全身'
function muscleDefault(cat){ return SEED_MUSCLE_DEFAULT[cat] || '全身'; }
function modeDefault(cat){ return SEED_MODE_DEFAULT[cat] || 'reps'; }

/* 食物条目的营养来源(src)——展示在「数据管理-食物库」每行的名称旁:
 * 系统库(种子/USDA 导入)记 'USDA';用户自己「＋ 添加食物」录入的记 '用户';
 * 从系统库「＋我的库」导入时沿用源条目的 src。前端与 server/seed.js 同源取这两个常量。 */
const FOOD_SRC_SYS = 'USDA';
const FOOD_SRC_USER = '用户';

/* 数据本体统一从 seed-data.json 读取：
 * Node 侧 require JSON（缺失/坏 JSON 直接抛错、服务起不来——不静默变空库）；
 * 浏览器侧同步 XHR（同源、index.html 先加载本文件，无构建）。
 * 浏览器读不到时**不能静默变空库**（SEED_FOODS 为空会被「旧库换新种子」等路径拿来覆盖库），
 * 所以记下 SEED_LOAD_ERROR 并 console.error，调用方按空数组自行收紧。 */
let SEED_LOAD_ERROR = null;
function seedLoadFailed(reason){
  SEED_LOAD_ERROR = reason;
  if (typeof console !== 'undefined' && console.error) console.error('[seed] seed-data.json 读取失败：' + reason + ' —— SEED_FOODS/SEED_EXERCISES 为空');
}
function loadSeedData(){
  if (typeof module !== 'undefined' && module.exports){
    const data = require('./seed-data.json');
    return { foods: data.foods || [], exercises: data.exercises || [] };
  }
  if (typeof XMLHttpRequest !== 'undefined'){
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'js/seed-data.json', false);
      xhr.send(null);
      if (xhr.status >= 200 && xhr.status < 300){
        const data = JSON.parse(xhr.responseText);
        return { foods: data.foods || [], exercises: data.exercises || [] };
      }
      seedLoadFailed('HTTP ' + xhr.status);
    } catch (e) { seedLoadFailed(e && e.message ? e.message : String(e)); }
  } else {
    seedLoadFailed('无 XMLHttpRequest');
  }
  return { foods: [], exercises: [] };
}

const _SEED = loadSeedData();
const SEED_FOODS = _SEED.foods;
const SEED_EXERCISES = _SEED.exercises;

/* Node 侧（server/seed.js）经 CommonJS 取用；浏览器里这几行是无害空操作 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SEED_FOODS, SEED_EXERCISES, SEED_CATS, SEED_MUSCLES, SEED_MODES, SEED_MODE_CN,
    SEED_MODE_DEFAULT, SEED_MUSCLE_DEFAULT, muscleDefault, modeDefault, FOOD_SRC_SYS, FOOD_SRC_USER };
}
