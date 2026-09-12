/* =====================================================
   食物/动作库种子数据 —— 数据本体在 seed-data.json，本文件只做枚举与加载
   - 数据源：public/js/seed-data.json（唯一数据源，禁止在 JS 里另抄一份）
   - 浏览器：index.html / admin.html 只取本文件的枚举与常量（大类/部位/记录方式/营养来源）；
     **不加载 seed-data.json**（v4.16 起；此前是同步 XHR，见下）
   - 服务端：server/seed.js require('../public/js/seed-data.js')；Node 侧直接 require JSON
   历史上两份手抄（app.js 与 server/seed.js）已发生数值漂移（香蕉/苹果的 f），
   收敛为本 JSON 后禁止再在任何一侧另抄一份（调试钩子的演示数据除外，见 app.js 的 DEMO_FOODS，
   它只服务 ?selftest/?ftest/?shot，与系统库无关）。
   v4.4：肌群枚举 SEED_MUSCLES 一并收编（曾各抄一份于 app.js 与 admin.html）。
   v4.11：动作库三件套 —— cat 大类 / muscle 部位 / mode 计数方式，三者正交：
       杠铃卧推 = 力量 · 胸 · 计次     跑步 = 有氧 · 全身 · 计时
       平板支撑 = 力量 · 核心 · 计时（"是什么"与"怎么计数"互不决定）
   增删枚举只改这里：app.js / admin.html 同源读取，服务端 sanitizeLibrary 白名单亦引用同一常量。
   * 旧字段名 muscle 保留原语义（部位），另加 cat 装大类 —— 不是改名。
   ===================================================== */
const SEED_CATS = ['力量','有氧','球类','柔韧','其他'];   /* 已删「课程」大类：原 2 条课程动作改判为「有氧」，见 CHANGELOG */
const SEED_MUSCLES = ['胸','背','腿','肩','手臂','核心','全身','其他'];
const SEED_MODES = ['reps','time'];
const SEED_MODE_CN = { 'reps':'计次', 'time':'计时' };           /* 展示用中文名（前端与 admin 同源，防两处漂移） */
/* 表单默认值：只是预选，不是约束（有氧也能标"腿"，计时也能是"核心"） */
const SEED_MODE_DEFAULT = {'力量':'reps','有氧':'time','球类':'time','柔韧':'time','其他':'reps'};
const SEED_MUSCLE_DEFAULT = {'力量':'胸'};           // 其余大类默认 '全身'
function muscleDefault(cat){ return SEED_MUSCLE_DEFAULT[cat] || '全身'; }
function modeDefault(cat){ return SEED_MODE_DEFAULT[cat] || 'reps'; }

/* 食物条目的营养来源(src)——展示在「数据管理-食物库」每行的名称旁:
 * 系统库(种子/USDA 导入)记 'USDA';用户自己「＋ 添加食物」录入的记 '用户';
 * 从系统库「＋我的库」导入时沿用源条目的 src。前端与 server/seed.js 同源取这两个常量。 */
const FOOD_SRC_SYS = 'USDA';
const FOOD_SRC_USER = '用户';

/* 数据本体（食物 321 条 / 动作 27 个）**只有服务端用**：server/seed.js require 本文件、
 * 由 Node 侧 require seed-data.json 建系统库；缺失/坏 JSON 直接抛错、服务起不来（不静默变空库）。
 * **浏览器侧不加载数据本体**（v4.16）：用户端要系统库走 GET /api/system/library，本人库在数据树里，
 * 调试钩子的演示数据用 app.js 内联的 DEMO_FOODS/DEMO_EXERCISES。此前浏览器用同步 XHR 拉这 62KB，
 * 每刷新一次就要在主线程上阻塞地下载（既是「手机刷新卡一下」的成因，也把 fetch 的 4s 超时定时器拖到响应之后才执行）。
 * 浏览器侧需要的只是下面的枚举/默认值/来源常量（~1KB 内联），不依赖那个 JSON。 */
let SEED_FOODS = [];
let SEED_EXERCISES = [];
if (typeof module !== 'undefined' && module.exports) {
  const data = require('./seed-data.json');
  SEED_FOODS = data.foods || [];
  SEED_EXERCISES = data.exercises || [];
}

/* Node 侧（server/seed.js）经 CommonJS 取用；浏览器里这几行是无害空操作 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SEED_FOODS, SEED_EXERCISES, SEED_CATS, SEED_MUSCLES, SEED_MODES, SEED_MODE_CN,
    SEED_MODE_DEFAULT, SEED_MUSCLE_DEFAULT, muscleDefault, modeDefault, FOOD_SRC_SYS, FOOD_SRC_USER };
}
