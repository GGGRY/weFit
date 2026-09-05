'use strict';
/* =====================================================
   系统共享库种子(与前端 public/js/app.js 的 SEED_FOODS / SEED_EXERCISES 保持同步)
   系统库由管理员维护;新注册账户的个人库 = 系统库整份拷贝。
   ===================================================== */

const SEED_FOODS = [
  { name: '米饭', per100: { kcal: 116, p: 2.6, c: 25.9, f: 0.3 } },
  { name: '鸡胸肉', per100: { kcal: 118, p: 22, c: 0.6, f: 3 } },
  { name: '鸡蛋', per100: { kcal: 143, p: 12.6, c: 0.9, f: 9.5 } },
  { name: '牛奶', per100: { kcal: 65, p: 3.3, c: 4.9, f: 3.6 } },
  { name: '全麦面包', per100: { kcal: 246, p: 11, c: 44, f: 4 } },
  { name: '燕麦片', per100: { kcal: 367, p: 13, c: 61, f: 7 } },
  { name: '红薯', per100: { kcal: 86, p: 1.6, c: 20, f: 0.2 } },
  { name: '香蕉', per100: { kcal: 93, p: 1.4, c: 22, f: 0 } },
  { name: '苹果', per100: { kcal: 53, p: 0.4, c: 13.7, f: 0.4 } },
  { name: '西兰花', per100: { kcal: 34, p: 2.8, c: 4.3, f: 0.4 } },
  { name: '三文鱼', per100: { kcal: 139, p: 17.2, c: 0, f: 7.3 } },
  { name: '瘦牛肉', per100: { kcal: 125, p: 20, c: 0, f: 4.6 } },
  { name: '花生酱', per100: { kcal: 600, p: 25, c: 20, f: 50 } },
  { name: '乳清蛋白粉', per100: { kcal: 400, p: 80, c: 6, f: 7 } },
];
const SEED_EXERCISES = [
  { name: '杠铃卧推', muscle: '胸' }, { name: '上斜哑铃卧推', muscle: '胸' }, { name: '哑铃飞鸟', muscle: '胸' },
  { name: '引体向上', muscle: '背' }, { name: '杠铃划船', muscle: '背' }, { name: '高位下拉', muscle: '背' }, { name: '坐姿划船', muscle: '背' },
  { name: '杠铃深蹲', muscle: '腿' }, { name: '腿举', muscle: '腿' }, { name: '罗马尼亚硬拉', muscle: '腿' }, { name: '箭步蹲', muscle: '腿' },
  { name: '站姿推举', muscle: '肩' }, { name: '哑铃侧平举', muscle: '肩' },
  { name: '哑铃二头弯举', muscle: '手臂' }, { name: '绳索三头下压', muscle: '手臂' },
  { name: '平板支撑', muscle: '核心' }, { name: '悬垂举腿', muscle: '核心' },
  { name: '跑步机慢跑', muscle: '有氧' },
];

/* 系统库形状与个人库一致:{foods:[{id,name,per100}], exercises:[{id,name,muscle}]} */
function seedLibrary() {
  return {
    foods: SEED_FOODS.map((f, i) => ({ id: 'sf' + i, name: f.name, per100: Object.assign({}, f.per100) })),
    exercises: SEED_EXERCISES.map((e, i) => ({ id: 'se' + i, name: e.name, muscle: e.muscle })),
  };
}

/* 新注册用户个人库的系统种子条目换前缀 id(避免与用户自增 id 空间纠缠) */
function copyLibrary(lib) {
  const out = {
    foods: (lib.foods || []).map((f, i) => ({
      id: 'f' + Date.now().toString(36) + '_' + i,
      name: f.name,
    })),
    exercises: (lib.exercises || []).map((e, i) => ({
      id: 'e' + Date.now().toString(36) + '_' + i,
      name: e.name,
    })),
  };
  out.foods.forEach((fo, i) => {
    const src = (lib.foods || [])[i];
    if (src && src.per100) {
      const per = {};
      ['kcal', 'p', 'c', 'f'].forEach(k => { if (src.per100[k] !== undefined && src.per100[k] !== null) per[k] = src.per100[k]; });
      if (Object.keys(per).length) fo.per100 = per;
    }
  });
  out.exercises.forEach((ex, i) => {
    const src = (lib.exercises || [])[i];
    if (src && src.muscle) ex.muscle = src.muscle;
  });
  return out;
}

module.exports = { seedLibrary, copyLibrary };
