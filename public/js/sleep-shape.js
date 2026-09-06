/* =====================================================
   睡眠记录形状契约 —— 唯一来源
   - 浏览器：index.html 在 app.js 之前加载本文件，前端直接用全局
   - 服务端：server/mapper.js require('../public/js/sleep-shape.js')
   为什么单独成文件：睡眠形状必须在两处做**同一套**归一化——前端（本机缓存 / 导入备份
   走 ensureUserIntact）与服务端（写库走 mapper.insertUserData）。两份手抄必然漂移
   （本项目已在 seed-data、MUSCLES/GOAL_ADJ 上踩过两次），所以规则只此一份。

   形状：state.sleep[日期] = 段数组 [{t, bed, wake, mins, quality}]，键可缺省。
   归一化（normalizeSleepDay）的三条裁决，两侧完全一致：
     1. 段内只认 t/bed/wake/mins/quality 五键；类型不符（bed 是对象、mins 是字符串…）丢键
        —— 顺带堵死「非字符串/非数值绑进 SQLite 直接把 PUT 打成 500」
     2. 清洗后一个键都不剩的段 → 丢该段（空对象/字段全被丢也算脏值，整段丢）
     3. 段数组为空（本来就是空数组 / 全被丢光）→ 该日期键不承载记录，删键
        睡眠没有「日期存在性」标记表（饮食有 meal_days），留一个空数组只会让
        「PUT 有键 / GET 无键」长期抖动，所以规定为空即删。
   唯一超出上面三条的例外：单日段数上限 SLEEP_MAX_SEGS，服务端显式 400 拒绝（不静默截断）。
   ===================================================== */

/* 类型固定三档；def = 新增该类型时表单的默认入睡/起床 */
const SLEEP_TYPES = [
  { k: 'night', ic: '😴', label: '夜间睡眠', def: ['23:30', '07:00'] },
  { k: 'nap',   ic: '😌', label: '午睡',     def: ['13:00', '13:40'] },
  { k: 'rest',  ic: '🛋️', label: '其他休息', def: ['15:00', '15:30'] },
];
const SLEEP_GOAL_MINS = 420;    // 7 小时（达标与统计一律按「全天各段总时长」口径）
const SLEEP_MAX_SEGS = 32;      // 单日段数上限：正常 UI 远够不到，只防坏缓存/异常客户端灌库

/* 未知类型返回 null——由调用方如实展示（旧写法兜底成「夜间睡眠」= 看错 + 编辑时被静默改写） */
function sleepType(k) { return SLEEP_TYPES.find(t => t.k === k) || null; }

/* 入睡→起床跨日时长；缺值/格式异常 null。
 * 同分同秒：夜间按一整夜 1440（跨零点手滑的常见形状），午睡/小憩按 0——
 * 否则「13:00 → 13:00」这类笔误会凭空给当天加上 24 小时，把概览合计和 14 天图一起拉爆。 */
function sleepDur(bed, wake, type) {
  if (!bed || !wake) return null;
  const bh = Number(String(bed).split(':')[0]), bm = Number(String(bed).split(':')[1]);
  const wh = Number(String(wake).split(':')[0]), wm = Number(String(wake).split(':')[1]);
  if (![bh, bm, wh, wm].every(Number.isFinite)) return null;
  let m = (wh * 60 + wm) - (bh * 60 + bm);
  if (m < 0) m += 1440;
  if (m === 0) return type === 'night' ? 1440 : 0;
  return m;
}

const sleepTxt = v => (typeof v === 'string' && v.trim() ? v : null);          // 文本列：非空字符串才收
const sleepInt = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);  // 数值列：只认数字

/* 清洗单段；返回 null = 该段应丢弃 */
function cleanSleepSeg(el) {
  if (!el || typeof el !== 'object' || Array.isArray(el)) return null;         // [null] / ["x"] 这类脏元素
  const t = sleepTxt(el.t), bed = sleepTxt(el.bed), wake = sleepTxt(el.wake);
  const mins = sleepInt(el.mins), quality = sleepInt(el.quality);
  const s = {};
  if (t !== null) s.t = t;
  if (bed !== null) s.bed = bed;
  if (wake !== null) s.wake = wake;
  if (mins !== null) s.mins = mins;
  if (quality !== null) s.quality = quality;
  return Object.keys(s).length ? s : null;
}

/* 清洗「一天」：返回规范段数组，或 null 表示该日期键应删除（规则 3） */
function normalizeSleepDay(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (let i = 0; i < v.length; i++) { const s = cleanSleepSeg(v[i]); if (s) out.push(s); }
  return out.length ? out : null;
}

/* Node 侧（server/mapper.js）经 CommonJS 取用；浏览器里这行是无害空操作 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SLEEP_TYPES, SLEEP_GOAL_MINS, SLEEP_MAX_SEGS, sleepType, sleepDur, normalizeSleepDay };
}
