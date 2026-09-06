'use strict';
/* =====================================================
   睡眠形状契约单元测试（public/js/sleep-shape.js）
   这份代码浏览器（index.html 先于 app.js 加载）与服务端（mapper.js require）共用，
   所以它错了两侧一起错——单独钉一层纯函数断言，不需要 HTTP 也不需要 DOM。
   运行：node test/sleep-shape.test.js
   ===================================================== */
const { SLEEP_TYPES, SLEEP_MAX_SEGS, sleepType, sleepDur, normalizeSleepDay } =
  require('../../public/js/sleep-shape.js');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('[PASS] ' + name); }
  else { failed++; console.log('[FAIL] ' + name + (detail ? '  →  ' + detail : '')); }
}
const J = v => JSON.stringify(v);

/* ---- 类型 ---- */
ok('S1 三档类型齐全且键唯一', SLEEP_TYPES.length === 3 &&
  new Set(SLEEP_TYPES.map(t => t.k)).size === 3);
ok('S2 sleepType 命中返回原对象', sleepType('nap').label === '午睡');
ok('S3 未知类型返回 null（不冒充夜间，调用方须如实展示）',
  sleepType('meditation') === null && sleepType(undefined) === null);

/* ---- 时长 ---- */
ok('S4 跨零点', sleepDur('23:30', '07:00', 'night') === 450);
ok('S5 同日正向', sleepDur('13:00', '13:40', 'nap') === 40);
ok('S6 同分同秒：夜间=一整夜，午睡=0（旧版一律 1440，手滑一次把当天撑成 24h）',
  sleepDur('23:00', '23:00', 'night') === 1440 && sleepDur('13:00', '13:00', 'nap') === 0);
ok('S7 缺值/坏格式返回 null', sleepDur('', '07:00', 'night') === null &&
  sleepDur('23:00', 'x', 'night') === null && sleepDur(null, null, 'night') === null);

/* ---- 形状归一化（四条裁决） ---- */
ok('N1 规范数组原样通过', J(normalizeSleepDay([{ t: 'night', bed: '23:00', wake: '07:00', mins: 480, quality: 4 }])) ===
  J([{ t: 'night', bed: '23:00', wake: '07:00', mins: 480, quality:4 }]));
ok('N2 规则1：旧"一天一条"对象 → 一段 night', J(normalizeSleepDay({ bed: '23:00', wake: '07:00', mins: 480, quality: 4 })) ===
  J([{ t: 'night', bed: '23:00', wake: '07:00', mins: 480, quality: 4 }]));
ok('N3 规则1：旧形状自带 t 则不被改写', J(normalizeSleepDay({ t: 'rest', mins: 20 })) === J([{ t: 'rest', mins: 20 }]));
ok('N4 规则2：类型不符的字段丢键（非字符串的 t/bed/wake、非数字的 mins/quality）',
  J(normalizeSleepDay([{ t: { a: 1 }, bed: '23:00', wake: [7], mins: '480', quality: 3.9 }])) ===
  J([{ bed: '23:00', quality: 4 }]));
ok('N5 规则3：脏元素（null/标量/数组）整段丢弃，其余段下标前移',
  J(normalizeSleepDay([null, 'x', [], 0, { t: 'nap', mins: 30 }])) === J([{ t: 'nap', mins: 30 }]));
ok('N6 规则3：清洗后一个键不剩的段丢弃', J(normalizeSleepDay([{}, { t: '' }, null])) === 'null');
ok('N7 规则4：空数组 / 旧形状空对象 → null（该日键须删）',
  normalizeSleepDay([]) === null && normalizeSleepDay({}) === null);
ok('N8 规则1+3：旧形状四字段全空 → null 而非 ghost night 段', normalizeSleepDay({ mins: null }) === null);
ok('N9 数组外的值一律 null（标量/布尔/undefined）',
  normalizeSleepDay('x') === null && normalizeSleepDay(5) === null && normalizeSleepDay(undefined) === null);
ok('N10 幂等：清洗结果再过一遍不变', J(normalizeSleepDay(normalizeSleepDay([null, { t: 'nap', bed: '13:00', mins: '30' }]))) ===
  J([{ t: 'nap', bed: '13:00' }]));
ok('N11 未知 t 原样保真（服务端不会把它改成 night）', J(normalizeSleepDay([{ t: 'meditation', mins: 20 }])) ===
  J([{ t: 'meditation', mins: 20 }]));
ok('N12 上限常量存在且远大于正常使用', typeof SLEEP_MAX_SEGS === 'number' && SLEEP_MAX_SEGS >= 8);

console.log('---');
console.log(failed === 0 ? '全部通过:' + passed + ' 项断言(睡眠形状契约纯函数)' : '通过 ' + passed + ',失败 ' + failed);
process.exit(failed === 0 ? 0 : 1);
