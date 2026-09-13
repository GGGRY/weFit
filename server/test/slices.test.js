'use strict';
/* =====================================================
   同步切片契约单元测试（public/js/slices.js）
   这份代码浏览器（index.html 先于 app.js 加载）与服务端（mapper.js require）共用，
   它错了两侧一起错——这里钉纯函数层：键语法 / 树上取片 / 片上写树 / 人话名。
   运行：node test/slices.test.js
   ===================================================== */
const S = require('../../public/js/slices.js');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('[PASS] ' + name); }
  else { failed++; console.log('[FAIL] ' + name + (detail ? '  →  ' + detail : '')); }
}
const J = v => JSON.stringify(v);

function testTree() {
  return {
    theme: 'dark', onboarded: true,
    shared: { foods: [{ id: 'f1', name: '米饭' }], exercises: [{ id: 'e1', name: '深蹲' }] },
    users: { u1: {
      id: 'u1', name: '阿明', avatar: '🙂', color: 'green', activity: 1.375, waterTarget: 8,
      profile: { gender: 'male', birthYear: 1992, height: 175, currentKg: 72 },
      goal: { mode: 'cut' }, nutrition: { auto: true, kcal: 2100 },
      homeOrder: ['diet', 'workout'], bodyHidden: [], chartOrder: ['weight'],
      meals: { '2026-09-13': { breakfast: [{ id: 'f1', name: '米饭', g: 120 }], lunch: [], dinner: [], snack: [] } },
      workouts: [
        { id: 'w1', date: '2026-09-12', name: 'A', items: [{ exName: '深蹲', done: true }] },
        { id: 'w2', date: '2026-09-13', name: 'B', items: [] },
      ],
      body: [{ date: '2026-09-13', weight: 72 }],
      habits: [
        { id: 'h1', name: '饮水达标', icon: '💧', color: 'c1', done: { '2026-09-13': true } },
        { id: 'h2', name: '睡满', icon: '😴', color: 'c2', done: {} },
      ],
      sleep: { '2026-09-13': [{ t: 'night', bed: '23:30', wake: '07:00', mins: 450 }] },
      water: { '2026-09-13': 6 },
    } },
    active: 'u1',
  };
}

/* ---- 键语法 ---- */
ok('K1 固定片/逐日片合法，其余非法',
  S.isValidSliceKey('profile') && S.isValidSliceKey('lib') && S.isValidSliceKey('body')
  && S.isValidSliceKey('habits') && S.isValidSliceKey('meals:2026-09-13')
  && S.isValidSliceKey('workouts:2026-01-01') && S.isValidSliceKey('sleep:2026-09-13')
  && S.isValidSliceKey('water:2026-09-13') && S.isValidSliceKey('habitdone:2026-09-13')
  && !S.isValidSliceKey('meals') && !S.isValidSliceKey('meals:2026-9-13')
  && !S.isValidSliceKey('meals:20260913') && !S.isValidSliceKey('plans:2026-09-13')
  && !S.isValidSliceKey('meals:2026-09-13:x') && !S.isValidSliceKey('') && !S.isValidSliceKey(null));
ok('K2 parseSliceKey 拆出 kind/date，固定片 date=null',
  J(S.parseSliceKey('meals:2026-09-13')) === J({ kind: 'meals', date: '2026-09-13' })
  && J(S.parseSliceKey('body')) === J({ kind: 'body', date: null })
  && S.parseSliceKey('nope') === null);

/* ---- 枚举树上存在的片 ---- */
const keysOf = t => S.sliceKeysOf(t).sort().join(',');
ok('E1 sliceKeysOf = 4 固定片 + 出现的逐日片（工作/睡眠/饮水/打卡/饮食）',
  keysOf(testTree()) === ['body', 'habitdone:2026-09-13', 'habits', 'lib', 'meals:2026-09-13',
    'profile', 'sleep:2026-09-13', 'water:2026-09-13', 'workouts:2026-09-12', 'workouts:2026-09-13'].sort().join(','),
  keysOf(testTree()));
ok('E2 空树只回固定片（不会凭空造逐日片）',
  keysOf({ theme: 'light', shared: {}, users: { u1: { id: 'u1' } }, active: 'u1' }) === 'body,habits,lib,profile');

/* ---- 取片 ---- */
{
  const t = testTree();
  ok('V1 profile 片含账户级 + 档案 + 偏好，theme/onboarded 恒在场',
    S.sliceValue(t, 'profile').name === '阿明' && S.sliceValue(t, 'profile').theme === 'dark'
    && S.sliceValue(t, 'profile').onboarded === true
    && J(S.sliceValue(t, 'profile').homeOrder) === J(['diet', 'workout']));
  ok('V2 lib 片带个人库两份',
    J(S.sliceValue(t, 'lib')) === J({ foods: [{ id: 'f1', name: '米饭' }], exercises: [{ id: 'e1', name: '深蹲' }] }));
  ok('V3 habits 片只有定义、没有 done',
    J(S.sliceValue(t, 'habits')) === J([
      { id: 'h1', name: '饮水达标', icon: '💧', color: 'c1' },
      { id: 'h2', name: '睡满', icon: '😴', color: 'c2' }]));
  ok('V4 habitdone 片 = 该日打卡集合，无人打卡 → undefined',
    J(S.sliceValue(t, 'habitdone:2026-09-13')) === J({ h1: true })
    && S.sliceValue(t, 'habitdone:2026-09-12') === undefined);
  ok('V5 逐日片取到了就是那一块，没这一天 → undefined',
    S.sliceValue(t, 'water:2026-09-13') === 6 && S.sliceValue(t, 'water:2026-09-12') === undefined
    && S.sliceValue(t, 'workouts:2026-09-13').name === 'B' && S.sliceValue(t, 'workouts:2026-09-01') === undefined
    && Array.isArray(S.sliceValue(t, 'sleep:2026-09-13')) && S.sliceValue(t, 'body').length === 1
    && S.sliceValue(t, 'meals:2026-09-13').breakfast.length === 1);
  ok('V6 未知/非法键取值为 undefined', S.sliceValue(t, 'bogus') === undefined && S.sliceValue(t, 'meals:2026-9-13') === undefined);
ok('V6b 空树/未建树（启动裁决早期）取值返回 undefined 而不抛异常',
  S.sliceValue(null, 'profile') === undefined && S.sliceValue(undefined, 'water:2026-09-13') === undefined
  && S.sliceValue({}, 'habits') === undefined);
  ok('V8 habitdone 值形状与习惯数组顺序无关（键排序：不让「调了个顺序」变成每天全量重推）',
    (() => {
      const a = testTree(), b = testTree();
      b.users.u1.habits = b.users.u1.habits.slice().reverse();
      return J(S.sliceValue(a, 'habitdone:2026-09-13')) === J(S.sliceValue(b, 'habitdone:2026-09-13'))
        && J(S.sliceValue(a, 'habitdone:2026-09-13')) === J({ h1: true });
    })());
  ok('V10 sliceValueEq：对象键序无关、数组顺序有关、undefined≡null（冲突前的内容比对）',
    (() => {
      const a = { x: 1, y: [1, 2], z: { p: 1, q: 2 } };
      const b = { z: { q: 2, p: 1 }, y: [1, 2], x: 1 };
      const c = { x: 1, y: [2, 1], z: { p: 1, q: 2 } };
      const d = { x: 1, y: [1, 2] };
      return S.sliceValueEq(a, b) && !S.sliceValueEq(a, c) && !S.sliceValueEq(a, d)
        && S.sliceValueEq(undefined, null) && !S.sliceValueEq(0, null) && S.sliceValueEq(0, 0)
        && !S.sliceValueEq([1], { 0: 1 });
    })());
  ok('V9 SLICE_VALUE_TYPE 覆盖全部片类型（校验表与读写契约同一来源）',
    S.SLICE_FIXED.concat(S.SLICE_DAY_KINDS).every(k => typeof S.SLICE_VALUE_TYPE[k] === 'string'));
  ok('V7 serializeSlice：有值给 JSON 串，缺片给 undefined', S.serializeSlice(t, 'water:2026-09-13') === '6'
    && S.serializeSlice(t, 'water:2026-09-12') === undefined);
}

/* ---- 写片（往返） ---- */
{
  const t = testTree();
  const meals = { breakfast: [], lunch: [{ id: 'f2', name: '鸡胸', g: 150 }], dinner: [], snack: [] };
  ok('W1 meals 片往返', S.writeSlice(t, 'meals:2026-09-13', meals) && J(S.sliceValue(t, 'meals:2026-09-13')) === J(meals));
  ok('W2 新日期片写入后出现在 sliceKeysOf',
    S.writeSlice(t, 'water:2026-09-01', 3) && S.sliceValue(t, 'water:2026-09-01') === 3
    && S.sliceKeysOf(t).indexOf('water:2026-09-01') >= 0);
  ok('W3 写 null/undefined = 删片',
    S.writeSlice(t, 'water:2026-09-01', null) && S.sliceValue(t, 'water:2026-09-01') === undefined
    && S.sliceKeysOf(t).indexOf('water:2026-09-01') < 0);
  ok('W4 workouts：在则原地替换、不在则追加，date 以键为准',
    (() => {
      const before = t.users.u1.workouts.map(w => w.date).join(',');
      S.writeSlice(t, 'workouts:2026-09-12', { name: 'A2', items: [] });
      const replaced = t.users.u1.workouts.map(w => w.date).join(',') === before
        && S.sliceValue(t, 'workouts:2026-09-12').name === 'A2';
      S.writeSlice(t, 'workouts:2026-09-10', { date: '1999-01-01', name: 'C', items: [] });
      const appended = t.users.u1.workouts[t.users.u1.workouts.length - 1].date === '2026-09-10'
        && S.sliceValue(t, 'workouts:2026-09-10').name === 'C';
      S.writeSlice(t, 'workouts:2026-09-12', null);
      const deleted = S.sliceValue(t, 'workouts:2026-09-12') === undefined;
      return replaced && appended && deleted;
    })());
  ok('W5 habitdone：整天集合整替换（不在集合里的打卡清除），空集合不留键',
    (() => {
      S.writeSlice(t, 'habitdone:2026-09-13', { h2: true });
      const a = J(S.sliceValue(t, 'habitdone:2026-09-13')) === J({ h2: true });   /* h1 不在集合里 → 清除 */
      S.writeSlice(t, 'habitdone:2026-09-12', { h1: true, h2: true });
      const b = J(S.sliceValue(t, 'habitdone:2026-09-12')) === J({ h1: true, h2: true });
      S.writeSlice(t, 'habitdone:2026-09-13', null);
      const c = S.sliceValue(t, 'habitdone:2026-09-13') === undefined && S.sliceKeysOf(t).indexOf('habitdone:2026-09-13') < 0;
      return a && b && c;
    })());
  ok('W6 habits：改定义保留同名 id 的打卡记录，被删习惯的打卡一并消失',
    (() => {
      /* 上一步在 09-12 给 h1/h2 都打过卡：h2 改名后记录必须还在，h1 随习惯一起消失 */
      S.writeSlice(t, 'habits', [{ id: 'h2', name: '睡满8小时', icon: '😴', color: 'c3' }]);
      const u = t.users.u1;
      return u.habits.length === 1 && u.habits[0].id === 'h2' && u.habits[0].name === '睡满8小时'
        && J(u.habits[0].done) === J({ '2026-09-12': true }) && u.habits[0].color === 'c3';
    })());
  ok('W7 新增习惯（无 id）给 h_seq_i 兜底且从空打卡开始', (() => {
    S.writeSlice(t, 'habits', [{ name: '拉伸' }]);
    const u = t.users.u1;
    return u.habits.length === 1 && u.habits[0].id === 'h_seq_0' && J(u.habits[0].done) === J({});
  })());
  ok('W8 profile：整列替换语义——值里缺的键 = 清空（与整树 jz/nz 同口径），theme 缺省回 light',
    (() => {
      S.writeSlice(t, 'profile', { name: '小红', theme: 'light', onboarded: false });
      const u = t.users.u1;
      return u.name === '小红' && t.theme === 'light' && t.onboarded === false
        && u.activity === undefined && u.goal === undefined && u.homeOrder === undefined && u.chartOrder === undefined;
    })());
  ok('W9 lib：缺字段按空数组落，非数组输入收敛成空数组',
    (() => {
      S.writeSlice(t, 'lib', { foods: [{ id: 'f9' }] });
      const a = J(t.shared.foods) === J([{ id: 'f9' }]) && J(t.shared.exercises) === J([]);
      S.writeSlice(t, 'lib', null);
      const b = J(t.shared.foods) === J([]) && J(t.shared.exercises) === J([]);
      S.writeSlice(t, 'lib', { foods: 'x', exercises: 5 });
      const c = J(t.shared.foods) === J([]) && J(t.shared.exercises) === J([]);
      return a && b && c;
    })());
  ok('W10 body：整数组替换，null → 空数组',
    S.writeSlice(t, 'body', [{ date: '2026-09-14', weight: 71 }]) && t.users.u1.body.length === 1
    && S.writeSlice(t, 'body', null) && J(t.users.u1.body) === J([]));
  ok('W11 非法键/缺树写入返回 false 且不改树',
    S.writeSlice(t, 'bogus', 1) === false && S.writeSlice(null, 'water:2026-09-13', 1) === false);
}

/* ---- 人话名 ---- */
ok('L1 sliceLabel 给用户看的是日期 + 类别，不是键名',
  S.sliceLabel('meals:2026-09-13') === '9月13日 饮食' && S.sliceLabel('workouts:2026-01-01') === '1月1日 运动'
  && S.sliceLabel('water:2026-12-31') === '12月31日 饮水' && S.sliceLabel('habitdone:2026-09-13') === '9月13日 打卡'
  && S.sliceLabel('sleep:2026-09-13') === '9月13日 睡眠'
  && S.sliceLabel('profile') === '账户设置' && S.sliceLabel('lib') === '我的库'
  && S.sliceLabel('body') === '身体记录' && S.sliceLabel('habits') === '习惯设置'
  && S.sliceLabel('bogus') === 'bogus');

console.log('---');
console.log(failed === 0 ? '全部通过:' + passed + ' 项断言(同步切片契约纯函数)' : '通过 ' + passed + ',失败 ' + failed);
process.exit(failed === 0 ? 0 : 1);
