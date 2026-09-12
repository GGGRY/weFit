'use strict';
/* =====================================================
   一次性：给食物条目补「营养来源(src)」
   - 用户裁定 2026-09-12：食物库每项带一个来源字段（数据管理-食物库每行显示）
   - 系统库：现有条目全部来自 USDA 导入 → src = 'USDA'
   - 个人库：与系统库同名的条目沿用系统库的 src（用户从系统库挑进去的仍是 USDA），
             其余（用户自己录入的）→ src = '用户'
   - 每改一个用户就 rev+1：让各端本机脏缓存走进「rev 前移」分支，不会把没 src 的旧库回推
   - 幂等：只补缺失的 src，重跑不改已填的值、不再 rev+1
   用法：node server/test/set-food-src.js [--yes]（默认干跑；--yes 才写库，写前先备份）
   ===================================================== */
const fs = require('node:fs');
const dbm = require('../db');
const { FOOD_SRC_SYS, FOOD_SRC_USER } = require('../seed');

function readJson(text, fallback) {
  try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : fallback; } catch (e) { return fallback; }
}

function main() {
  const commit = process.argv.includes('--yes');
  const file = process.env.DB_PATH || dbm.DEFAULT_DB;
  const db = dbm.open();
  const sys = readJson(db.prepare('SELECT system_json FROM app WHERE id = 1').get().system_json, { foods: [], exercises: [] });
  const sysName = new Map();
  let sysMiss = 0;
  (sys.foods || []).forEach(f => {
    if (!f.src) { f.src = FOOD_SRC_SYS; sysMiss++; }
    sysName.set(f.name, f.src);
  });
  const users = db.prepare('SELECT id, name, foods_json FROM users').all();
  const plan = users.map(u => {
    const foods = readJson(u.foods_json, []);
    let fromSys = 0, fromUser = 0;
    foods.forEach(f => {
      if (f.src) return;
      const s = sysName.get(f.name);
      if (s) { f.src = s; fromSys++; } else { f.src = FOOD_SRC_USER; fromUser++; }
    });
    return { u, foods, fromSys, fromUser };
  });
  console.log('[src] 系统库食物 ' + (sys.foods || []).length + ' 条：补 src ' + sysMiss + ' 条 → ' + FOOD_SRC_SYS);
  plan.forEach(p => console.log('      用户 ' + p.u.id + '（' + p.u.name + '）个人库 ' + p.foods.length +
    ' 条：沿用系统库 ' + p.fromSys + ' 条 / 记为' + FOOD_SRC_USER + ' ' + p.fromUser + ' 条'));
  if (!commit) {
    console.log('[src] 干跑结束（未写库）。确认无误后加 --yes 再跑一次');
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const bak = file + '.bak-' + stamp + '-src';
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);   /* 写前备份（跑前服务已停，文件是静止的） */
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE app SET system_json = ? WHERE id = 1').run(JSON.stringify(sys));
    const upd = db.prepare('UPDATE users SET foods_json = ?, rev = rev + 1 WHERE id = ?');
    plan.forEach(p => { if (p.fromSys || p.fromUser) upd.run(JSON.stringify(p.foods), p.u.id); });
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (e2) { /* 回滚失败保持原错误上抛 */ }
    throw e;
  }
  const after = readJson(db.prepare('SELECT system_json FROM app WHERE id = 1').get().system_json, { foods: [] });
  const miss = (after.foods || []).filter(f => !f.src).length;
  const revs = db.prepare('SELECT id, rev, foods_json FROM users').all();
  console.log('[src] 完成（备份 ' + bak + '）：系统库缺 src 剩 ' + miss + ' 条');
  revs.forEach(u => {
    const n = readJson(u.foods_json, []).filter(f => !f.src).length;
    console.log('      user ' + u.id + ' rev=' + u.rev + ' 个人库缺 src ' + n + ' 条');
  });
}

main();
