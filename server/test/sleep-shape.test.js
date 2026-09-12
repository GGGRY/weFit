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
/* 2026-09-12 用户反馈：原 😴（夜间）/😌（午睡）都是睡脸，38px thumb 里分不出，
   所以图标必须三档互不相同、且不用人脸表情（脸表情留给头像等用途，睡眠类型不许用） */
ok('S1b 三档图标互不相同且都不是人脸表情（区分度：🌙 / ⛅ / 🛋️）',
  new Set(SLEEP_TYPES.map(t => t.ic)).size === 3 &&
  SLEEP_TYPES.every(t => !/[\u{1F600}-\u{1F64F}]/u.test(t.ic)),
  'icons=' + J(SLEEP_TYPES.map(t => t.ic)));
ok('S2 sleepType 命中返回原对象', sleepType('nap').label === '午睡');
ok('S3 未知类型返回 null（不冒充夜间，调用方须如实展示）',
  sleepType('meditation') === null && sleepType(undefined) === null);

/* ---- 时长 ---- */
ok('S4 跨零点', sleepDur('23:30', '07:00', 'night') === 450);
ok('S5 同日正向', sleepDur('13:00', '13:40', 'nap') === 40);
ok('S6 同分同秒：夜间=一整夜，午睡=0',
  sleepDur('23:00', '23:00', 'night') === 1440 && sleepDur('13:00', '13:00', 'nap') === 0);
ok('S7 缺值/坏格式返回 null', sleepDur('', '07:00', 'night') === null &&
  sleepDur('23:00', 'x', 'night') === null && sleepDur(null, null, 'night') === null);

/* ---- 形状归一化（三条裁决） ---- */
ok('N1 规范数组原样通过', J(normalizeSleepDay([{ t: 'night', bed: '23:00', wake: '07:00', mins: 480, quality: 4 }])) ===
  J([{ t: 'night', bed: '23:00', wake: '07:00', mins: 480, quality:4 }]));
ok('N2 规则1：类型不符的字段丢键（非字符串的 t/bed/wake、非数字的 mins/quality）',
  J(normalizeSleepDay([{ t: { a: 1 }, bed: '23:00', wake: [7], mins: '480', quality: 3.9 }])) ===
  J([{ bed: '23:00', quality: 4 }]));
ok('N3 规则2：脏元素（null/标量/数组）整段丢弃，其余段下标前移',
  J(normalizeSleepDay([null, 'x', [], 0, { t: 'nap', mins: 30 }])) === J([{ t: 'nap', mins: 30 }]));
ok('N4 规则2：清洗后一个键不剩的段丢弃', J(normalizeSleepDay([{}, { t: '' }, null])) === 'null');
ok('N5 规则3：空数组 / 空对象 → null（该日键须删）',
  normalizeSleepDay([]) === null && normalizeSleepDay({}) === null);
ok('N6 数组外的值一律 null（标量/布尔/undefined）',
  normalizeSleepDay('x') === null && normalizeSleepDay(5) === null && normalizeSleepDay(undefined) === null);
ok('N7 幂等：清洗结果再过一遍不变', J(normalizeSleepDay(normalizeSleepDay([null, { t: 'nap', bed: '13:00', mins: '30' }]))) ===
  J([{ t: 'nap', bed: '13:00' }]));
ok('N8 未知 t 原样保真（服务端不会把它改成 night）', J(normalizeSleepDay([{ t: 'meditation', mins: 20 }])) ===
  J([{ t: 'meditation', mins: 20 }]));
ok('N9 上限常量存在且远大于正常使用', typeof SLEEP_MAX_SEGS === 'number' && SLEEP_MAX_SEGS >= 8);

console.log('---');
console.log(failed === 0 ? '全部通过:' + passed + ' 项断言(睡眠形状契约纯函数)' : '通过 ' + passed + ',失败 ' + failed);
process.exit(failed === 0 ? 0 : 1);
