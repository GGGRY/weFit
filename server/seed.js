'use strict';
/* =====================================================
   系统共享库种子构建
   系统库由管理员维护;新注册账户的个人库 = 系统库整份拷贝。
   v4.3：SEED_FOODS / SEED_EXERCISES 不再在本文件另抄一份——
   与前端共用唯一数据源 public/js/seed-data.js（曾出现两份拷贝数值漂移）。
   ===================================================== */

const { SEED_FOODS, SEED_EXERCISES } = require('../public/js/seed-data.js');

/* per100 只保留这 4 个营养键(v4.4:server.js 的 sanitizeLibrary 同一白名单,
 * 曾两处各写一份——加了第 5 键会一边保留一边静默丢弃) */
const FOOD_NUM_KEYS = ['kcal', 'p', 'c', 'f'];

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
      FOOD_NUM_KEYS.forEach(k => { if (src.per100[k] !== undefined && src.per100[k] !== null) per[k] = src.per100[k]; });
      if (Object.keys(per).length) fo.per100 = per;
    }
  });
  out.exercises.forEach((ex, i) => {
    const src = (lib.exercises || [])[i];
    if (src && src.muscle) ex.muscle = src.muscle;
  });
  return out;
}

module.exports = { seedLibrary, copyLibrary, FOOD_NUM_KEYS };
