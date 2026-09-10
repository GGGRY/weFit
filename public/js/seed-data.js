/* =====================================================
   食物/动作库种子数据 —— 唯一数据源（v4.3；动作库 v4.11 重构）
   - 浏览器：index.html 在 app.js 之前加载本文件，前端直接用全局 SEED_FOODS / SEED_EXERCISES
   - 服务端：server/seed.js require('../public/js/seed-data.js')
   历史上两份手抄（app.js 与 server/seed.js）已发生数值漂移（香蕉/苹果的 f），
   收敛为本文件后禁止再在任何一侧另抄一份。
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
/* mode='reps'：记录 总次数（+ 可选重量，留空 = 自重）
   mode='time'：记录 总时长（分钟，可含小数）+ 可选距离 km */
const SEED_EXERCISES = [
  /* ── 力量 · 计次 ── */
  {name:'杠铃卧推', cat:'力量', muscle:'胸', mode:'reps'}, {name:'上斜哑铃卧推', cat:'力量', muscle:'胸', mode:'reps'}, {name:'哑铃飞鸟', cat:'力量', muscle:'胸', mode:'reps'},
  {name:'引体向上', cat:'力量', muscle:'背', mode:'reps'}, {name:'杠铃划船', cat:'力量', muscle:'背', mode:'reps'}, {name:'高位下拉', cat:'力量', muscle:'背', mode:'reps'}, {name:'坐姿划船', cat:'力量', muscle:'背', mode:'reps'},
  {name:'杠铃深蹲', cat:'力量', muscle:'腿', mode:'reps'}, {name:'腿举', cat:'力量', muscle:'腿', mode:'reps'}, {name:'罗马尼亚硬拉', cat:'力量', muscle:'腿', mode:'reps'}, {name:'箭步蹲', cat:'力量', muscle:'腿', mode:'reps'},
  {name:'站姿推举', cat:'力量', muscle:'肩', mode:'reps'}, {name:'哑铃侧平举', cat:'力量', muscle:'肩', mode:'reps'},
  {name:'哑铃二头弯举', cat:'力量', muscle:'手臂', mode:'reps'}, {name:'绳索三头下压', cat:'力量', muscle:'手臂', mode:'reps'},
  {name:'悬垂举腿', cat:'力量', muscle:'核心', mode:'reps'},
  /* ── 力量 · 计时（静力：仍是力量动作，只是按秒记） ── */
  {name:'平板支撑', cat:'力量', muscle:'核心', mode:'time'},
  /* ── 有氧 · 计时 ── */
  {name:'跑步', cat:'有氧', muscle:'全身', mode:'time'}, {name:'跑步机慢跑', cat:'有氧', muscle:'全身', mode:'time'},
  {name:'骑行', cat:'有氧', muscle:'全身', mode:'time'}, {name:'游泳', cat:'有氧', muscle:'全身', mode:'time'},
  {name:'跳绳', cat:'有氧', muscle:'全身', mode:'time'}, {name:'椭圆机', cat:'有氧', muscle:'全身', mode:'time'},
  /* ── 课程 · 计时 ── */
  {name:'帕梅拉跳操', cat:'课程', muscle:'全身', mode:'time'}, {name:'燃脂操课', cat:'课程', muscle:'全身', mode:'time'},
  /* ── 球类 / 柔韧 · 计时 ── */
  {name:'羽毛球', cat:'球类', muscle:'全身', mode:'time'},
  {name:'拉伸', cat:'柔韧', muscle:'全身', mode:'time'},
];
/* Node 侧（server/seed.js）经 CommonJS 取用；浏览器里这几行是无害空操作 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SEED_FOODS, SEED_EXERCISES, SEED_CATS, SEED_MUSCLES, SEED_MODES, SEED_MODE_CN,
    SEED_MODE_DEFAULT, SEED_MUSCLE_DEFAULT, muscleDefault, modeDefault };
}
