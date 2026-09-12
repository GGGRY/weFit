'use strict';
/* =====================================================
   一次性：删掉「课程」大类，存量数据迁到「有氧」
   - 用户裁定 2026-09-12：大类枚举去掉「课程」；
     系统库里那 2 条课程动作（帕梅拉跳操 / 燃脂操课）改判为「有氧 · 全身 · 计时」
   - 枚举白名单（server.js sanitizeLibrary）随 seed-data.js 一起收窄：库里若还留着 cat='课程'，
     下次任何一次整库 PUT 都会被静默丢键 → 前端兜底成「其他」，所以这里主动迁移
   - 覆盖三处存量：app.system_json（系统库）、users.exercises_json（个人库）、workout_items.cat（运动记录）
   - 每改一个用户就 rev+1：让各端本机脏缓存走进「rev 前移」分支，不会把带「课程」的旧库回推
   - 幂等：只改 cat==='课程' 的条目，重跑无改动、不再 rev+1
   用法：node server/test/migrate-cat-drop-course.js [--yes]（默认干跑；--yes 才写库，写前先备份）
   ===================================================== */
const fs = require('node:fs');
const dbm = require('../db');

const FROM = '课程', TO = '有氧';

function readJson(text, fallback) {
  try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : fallback; } catch (e) { return fallback; }
}

function migrateExList(list) {
  const hit = [];
  (list || []).forEach(e => { if (e && e.cat === FROM) { e.cat = TO; hit.push(e.name); } });
  return hit;
}

function main() {
  const commit = process.argv.includes('--yes');
  const file = process.env.DB_PATH || dbm.DEFAULT_DB;
  const db = dbm.open();

  const sys = readJson(db.prepare('SELECT system_json FROM app WHERE id = 1').get().system_json, { foods: [], exercises: [] });
  const sysHit = migrateExList(sys.exercises);

  const users = db.prepare('SELECT id, name, exercises_json FROM users').all();
  const plan = users.map(u => {
    const ex = readJson(u.exercises_json, []);
    const hit = migrateExList(ex);
    return { u, ex, hit };
  });

  const itemRows = db.prepare("SELECT user_id, date, seq, ex_name FROM workout_items WHERE cat = ?").all(FROM);

  console.log('[' + FROM + '→' + TO + '] 系统库：' + sysHit.length + ' 条 ' + JSON.stringify(sysHit));
  plan.forEach(p => console.log('      用户 ' + p.u.id + '（' + p.u.name + '）个人库：' + p.hit.length + ' 条 ' + JSON.stringify(p.hit)));
  console.log('      运动记录：' + itemRows.length + ' 项 ' + JSON.stringify(itemRows.map(r => r.ex_name)));

  if (!commit) {
    console.log('[课程] 干跑结束（未写库）。确认无误后加 --yes 再跑一次');
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const bak = file + '.bak-' + stamp + '-nocourse';
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);   /* 写前备份（跑前服务已停，文件是静止的） */
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE app SET system_json = ? WHERE id = 1').run(JSON.stringify(sys));
    const updUser = db.prepare('UPDATE users SET exercises_json = ?, rev = rev + 1 WHERE id = ?');
    plan.forEach(p => { if (p.hit.length) updUser.run(JSON.stringify(p.ex), p.u.id); });
    const updItem = db.prepare('UPDATE workout_items SET cat = ? WHERE cat = ?');
    updItem.run(TO, FROM);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (e2) { /* 回滚失败保持原错误上抛 */ }
    throw e;
  }

  const afterSys = readJson(db.prepare('SELECT system_json FROM app WHERE id = 1').get().system_json, { foods: [] });
  const leftSys = (afterSys.exercises || []).filter(e => e.cat === FROM).length;
  const leftItems = db.prepare('SELECT COUNT(*) n FROM workout_items WHERE cat = ?').get(FROM).n;
  let leftUsers = 0;
  db.prepare('SELECT id, exercises_json FROM users').all().forEach(u => {
    leftUsers += readJson(u.exercises_json, []).filter(e => e.cat === FROM).length;
  });
  console.log('[课程] 完成（备份 ' + bak + '）：系统库剩 ' + leftSys + ' 条 / 个人库剩 ' + leftUsers + ' 条 / 运动记录剩 ' + leftItems + ' 项');
}

main();
