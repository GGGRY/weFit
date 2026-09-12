'use strict';
/* =====================================================
   系统共享库种子构建
   系统库由管理员维护。2026-09-12 起新注册账户的个人库初始为空（注册不再拷贝系统库），
   copyLibrary() 只剩一次性工具 reset-food-library.js 在用。
   v4.3：SEED_FOODS / SEED_EXERCISES 不再在本文件另抄一份——
   与前端共用唯一数据源 public/js/seed-data.json（seed-data.js 只做枚举与加载；曾出现两份拷贝数值漂移）。
   v4.11：动作条目携带 cat(大类)/muscle(部位)/mode(计次|计时) 三件套，
   并在此转出枚举常量供 server.js 的 sanitizeLibrary 白名单引用（仍然只有一份定义）。
   ===================================================== */

const {
  SEED_FOODS, SEED_EXERCISES, SEED_CATS, SEED_MUSCLES, SEED_MODES, FOOD_SRC_SYS, FOOD_SRC_USER,
} = require('../public/js/seed-data.js');

/* per100 只保留这 4 个营养键(v4.4:server.js 的 sanitizeLibrary 同一白名单,
 * 曾两处各写一份——加了第 5 键会一边保留一边静默丢弃) */
const FOOD_NUM_KEYS = ['kcal', 'p', 'c', 'f'];

/* 系统库形状与个人库一致：
 * {foods:[{id,name,per100,src}], exercises:[{id,name,cat,muscle,mode}]}
 * src = 食物条目的营养来源（系统库种子来自 USDA，见 seed-data.js 的 FOOD_SRC_SYS） */
function seedLibrary() {
  return {
    foods: SEED_FOODS.map((f, i) => ({ id: 'sf' + i, name: f.name, per100: Object.assign({}, f.per100), src: f.src || FOOD_SRC_SYS })),
    exercises: SEED_EXERCISES.map((e, i) => ({ id: 'se' + i, name: e.name, cat: e.cat, muscle: e.muscle, mode: e.mode })),
  };
}

/* 系统库条目换前缀 id 拷入个人库(避免与用户自增 id 空间纠缠)；2026-09-12 起仅供
 * 一次性工具 server/test/reset-food-library.js 使用，注册已不再调用 */
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
    const sysFood = (lib.foods || [])[i];
    fo.src = (sysFood && sysFood.src) || FOOD_SRC_SYS;   /* 来源随条目一起拷贝：从系统库挑进来的仍算 USDA */
    if (sysFood && sysFood.per100) {
      const per = {};
      FOOD_NUM_KEYS.forEach(k => { if (sysFood.per100[k] !== undefined && sysFood.per100[k] !== null) per[k] = sysFood.per100[k]; });
      if (Object.keys(per).length) fo.per100 = per;
    }
  });
  out.exercises.forEach((ex, i) => {
    const sysEx = (lib.exercises || [])[i];
    if (!sysEx) return;
    if (sysEx.cat) ex.cat = sysEx.cat;
    if (sysEx.muscle) ex.muscle = sysEx.muscle;
    if (sysEx.mode) ex.mode = sysEx.mode;
  });
  return out;
}

module.exports = { seedLibrary, copyLibrary, FOOD_NUM_KEYS, SEED_CATS, SEED_MUSCLES, SEED_MODES, FOOD_SRC_SYS, FOOD_SRC_USER };
