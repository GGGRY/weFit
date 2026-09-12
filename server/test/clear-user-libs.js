'use strict';
/* =====================================================
   一次性：清空指定账户的个人食物库 / 动作库（foods_json / exercises_json → []）
   - 背景（2026-09-12 用户裁定）：注册不再自动导入系统库，个人库初始为空。
     服务端改动之前/之后的一小段时间里，客户端 adoptRaw 还会把空库填成
     321 食物 + 27 动作并推回服务器，实测注册的测试账户就这么被填满了——
     本工具用来把这批「非用户本意」的条目清掉。
   - 每清一个账户 rev+1：让各端本机缓存走「rev 前移」分支，不会把旧库回推
     （脏缓存会弹人工裁决——这是期望行为，不静默覆盖）
   - 只动个人库，系统库与其他字段（档案/饮食/运动/身体…）一字不改
   - 幂等：库已空则跳过、不 rev+1
   用法：node server/test/clear-user-libs.js <用户名> [<用户名> …] [--yes]
         （默认干跑；--yes 才写库，写前先备份。建议先停服务再跑）
   ===================================================== */
const fs = require('node:fs');
const dbm = require('../db');

function readArr(text) {
  try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

function main() {
  const commit = process.argv.includes('--yes');
  const names = process.argv.slice(2).filter(a => a !== '--yes' && !a.startsWith('--'));
  const unknownFlags = process.argv.slice(2).filter(a => a.startsWith('--') && a !== '--yes' && a !== '--');
  if (unknownFlags.length) { console.error('[clear] 未知参数：' + unknownFlags.join(' ')); process.exit(1); }
  if (!names.length) { console.error('用法：node server/test/clear-user-libs.js <用户名> [<用户名> …] [--yes]'); process.exit(1); }

  const file = process.env.DB_PATH || dbm.DEFAULT_DB;
  const db = dbm.open();
  const rows = names.map(n => db.prepare('SELECT a.username, u.id, u.name, u.rev, u.foods_json, u.exercises_json ' +
    'FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.username = ?').get(n));
  const missing = names.filter((n, i) => !rows[i]);
  if (missing.length) { console.error('[clear] 找不到账户：' + missing.join(' ')); process.exit(1); }

  const plan = rows.map(r => {
    const foods = readArr(r.foods_json), exercises = readArr(r.exercises_json);
    return { r, foods, exercises, dirty: foods.length > 0 || exercises.length > 0 };
  });
  console.log('[clear] 数据库 ' + file);
  plan.forEach(p => console.log('      账户 ' + p.r.username + '（' + p.r.name + '，' + p.r.id + '）rev=' + p.r.rev +
    '：foods ' + p.foods.length + ' → ' + (p.dirty ? 0 : p.foods.length) +
    '，exercises ' + p.exercises.length + ' → ' + (p.dirty ? 0 : p.exercises.length) +
    (p.dirty ? '' : '（已空，跳过）')));
  const touched = plan.filter(p => p.dirty);
  if (!commit) {
    console.log('[clear] 干跑结束（未写库，将改动 ' + touched.length + ' 个账户）。确认无误后加 --yes 再跑一次');
    return;
  }
  if (!touched.length) { console.log('[clear] 无需改动，未写库、未 rev+1'); return; }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  /* 每次跑都留一份独立快照（同一天跑第二次不会复用上一次的备份——否则新改动前的状态就没了） */
  let bak = file + '.bak-' + stamp + '-emptylib';
  for (let i = 2; fs.existsSync(bak); i++) bak = file + '.bak-' + stamp + '-emptylib-' + i;
  fs.copyFileSync(file, bak);   /* 写前备份（跑前服务已停，文件是静止的） */
  db.exec('BEGIN IMMEDIATE');
  try {
    const upd = db.prepare("UPDATE users SET foods_json = '[]', exercises_json = '[]', rev = rev + 1 WHERE id = ?");
    touched.forEach(p => upd.run(p.r.id));
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (e2) { /* 回滚失败保持原错误上抛 */ }
    throw e;
  }
  console.log('[clear] 完成（备份 ' + bak + '）');
  plan.forEach(p => {
    const a = db.prepare('SELECT rev, foods_json, exercises_json FROM users WHERE id = ?').get(p.r.id);
    console.log('      账户 ' + p.r.username + ' rev=' + a.rev + '：foods ' + readArr(a.foods_json).length +
      '，exercises ' + readArr(a.exercises_json).length);
  });
}

main();
