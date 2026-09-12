'use strict';
/* =====================================================
   一次性：把系统库与所有用户的个人食物库整体换血为 USDA 种子
   - 用户裁定 2026-09-12：删掉旧的 14 条中文种子与各用户已有个人食物库，
     系统库 + 所有用户个人库都重设为 public/js/seed-data.json 里的 321 条
   - 动作库（系统 exercises 与各用户 exercises_json）一律不动
   - 每改一个用户就 rev+1：让各端本机脏缓存走进「rev 前移」分支，不会把旧库回推
   - 只跑一次的手动工具：默认干跑，加 --yes 才真正写库；重跑会把之后再自建的食物也清掉，慎用
   用法：node server/test/reset-food-library.js [--yes]
   ===================================================== */
const dbm = require('../db');
const { seedLibrary, copyLibrary } = require('../seed');

function readJson(text, fallback) {
  try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : fallback; } catch (e) { return fallback; }
}

function main() {
  const commit = process.argv.includes('--yes');
  const db = dbm.open();
  const lib = seedLibrary();
  const users = db.prepare('SELECT id, name FROM users').all();
  const sysBefore = readJson(db.prepare('SELECT system_json FROM app WHERE id = 1').get().system_json, {});
  console.log('[reset] 目标：系统库食物 ' + (sysBefore.foods || []).length + ' 条 → ' + lib.foods.length + ' 条；' +
    '用户 ' + users.length + ' 个，各人个人食物库整份替换；动作库不动');
  if (!commit) {
    console.log('[reset] 干跑结束（未写库）。确认无误后加 --yes 再跑一次');
    return;
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const sys = { foods: lib.foods, exercises: Array.isArray(sysBefore.exercises) && sysBefore.exercises.length ? sysBefore.exercises : lib.exercises };
    db.prepare('UPDATE app SET system_json = ? WHERE id = 1').run(JSON.stringify(sys));
    const upd = db.prepare('UPDATE users SET foods_json = ?, rev = rev + 1 WHERE id = ?');
    for (const u of users) {
      const foods = copyLibrary({ foods: lib.foods }).foods;
      upd.run(JSON.stringify(foods), u.id);
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (e2) { /* 回滚失败保持原错误上抛 */ }
    throw e;
  }
  const sysAfter = readJson(db.prepare('SELECT system_json FROM app WHERE id = 1').get().system_json, {});
  const counts = db.prepare('SELECT id, rev, length(foods_json) AS n FROM users').all();
  console.log('[reset] 完成：系统库食物 ' + (sysAfter.foods || []).length + ' 条（动作 ' + (sysAfter.exercises || []).length + ' 条）');
  counts.forEach(u => console.log('        user ' + u.id + ' rev=' + u.rev + ' foods_json=' + u.n + 'B'));
}

main();
