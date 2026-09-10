'use strict';
/* =====================================================
   v4.11 破坏性迁移回归测试
   覆盖 db.js 的 wipeLegacyWorkout()——整批改动里唯一会「删用户数据」的代码。

   做法：手工造一个**旧结构**库（旧的 plan_items/workout_items/workout_sets 列，
   外加饮食/身体/睡眠/饮水/习惯/账户/食物库等非运动数据），用新 db.js 的 open() 打开，断言：
     ① 周计划 / 运动日志 / workout_sets 被清空，且两张表按新列重建；
     ② 非运动数据逐行完好（值级比对，不只是行数）；
     ③ 个人动作库置空、系统库只换动作部分（食物原样保留）；
     ④ **不复发**：重置后新建的运动记录，再次 open() 必须存活（判据是 workout_sets 是否存在）；
     ⑤ 重置 bump 各账户 rev（脏缓存客户端会被 converge 拦到人工裁决，不静默回推）。
   运行：node test/migration.test.js
   ===================================================== */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const dbm = require('../db');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('[PASS] ' + name); }
  else { failed++; console.log('[FAIL] ' + name + (detail ? '  →  ' + detail : '')); }
}

const TMP = path.join(__dirname, 'tmp-v411-migration.db');
try { fs.rmSync(TMP, { force: true }); } catch (e) {}

/* ---------- 旧结构 DDL（v4.10 及以前的运动三表 + 需要存活/比对的其余表） ---------- */
const LEGACY_DDL = `
CREATE TABLE app (id INTEGER PRIMARY KEY CHECK (id = 1), system_json TEXT);
CREATE TABLE users (
  id TEXT PRIMARY KEY, name TEXT, avatar TEXT, color TEXT,
  activity REAL, water_target INTEGER,
  profile_json TEXT, goal_json TEXT, nutrition_json TEXT,
  rev INTEGER NOT NULL DEFAULT 0, theme TEXT, onboarded INTEGER NOT NULL DEFAULT 0,
  foods_json TEXT, exercises_json TEXT
);
CREATE TABLE accounts (username TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pwd TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at INTEGER NOT NULL);
CREATE TABLE sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE meal_days (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL, PRIMARY KEY (user_id, date));
CREATE TABLE meals (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL, slot TEXT NOT NULL,
  seq INTEGER NOT NULL, item_id TEXT, name TEXT, kcal REAL, p REAL, c REAL, f REAL, g REAL,
  PRIMARY KEY (user_id, date, slot, seq));
CREATE TABLE plan_defs (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, weekday INTEGER NOT NULL,
  plan_id TEXT, name TEXT, PRIMARY KEY (user_id, weekday));
CREATE TABLE plan_items (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, weekday INTEGER NOT NULL,
  seq INTEGER NOT NULL, item_id TEXT, ex_id TEXT, ex_name TEXT, muscle TEXT,
  sets INTEGER, reps INTEGER, weight REAL, PRIMARY KEY (user_id, weekday, seq));
CREATE TABLE workouts (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, workout_id TEXT NOT NULL,
  seq INTEGER NOT NULL, date TEXT, name TEXT, note TEXT, PRIMARY KEY (user_id, workout_id));
CREATE TABLE workout_items (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, workout_id TEXT NOT NULL,
  seq INTEGER NOT NULL, item_id TEXT, ex_id TEXT, ex_name TEXT, muscle TEXT,
  PRIMARY KEY (user_id, workout_id, seq));
CREATE TABLE workout_sets (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, workout_id TEXT NOT NULL,
  item_seq INTEGER NOT NULL, seq INTEGER NOT NULL, reps REAL, weight REAL,
  PRIMARY KEY (user_id, workout_id, item_seq, seq));
CREATE TABLE body_records (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, seq INTEGER NOT NULL,
  date TEXT NOT NULL, weight REAL, chest REAL, waist REAL, hip REAL, arm REAL, thigh REAL, bf REAL,
  PRIMARY KEY (user_id, seq));
CREATE TABLE sleep_sessions (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL,
  seq INTEGER NOT NULL, t TEXT, bed TEXT, wake TEXT, mins INTEGER, quality INTEGER,
  PRIMARY KEY (user_id, date, seq));
CREATE TABLE water_records (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL,
  cups INTEGER, PRIMARY KEY (user_id, date));
CREATE TABLE habits (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, habit_id TEXT NOT NULL,
  seq INTEGER NOT NULL, name TEXT, icon TEXT, color TEXT, PRIMARY KEY (user_id, habit_id));
CREATE TABLE habit_done (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, habit_id TEXT NOT NULL,
  date TEXT NOT NULL, PRIMARY KEY (user_id, habit_id, date));
`;

const UID = 'u_legacy';
const OLD_LIB = JSON.stringify([{ id: 'e0', name: '杠铃卧推', muscle: '胸' }]);
const OLD_FOODS = JSON.stringify([{ id: 'f0', name: '米饭', per100: { kcal: 116, p: 2.6, c: 25.9, f: 0.3 } }]);
const OLD_SYS = JSON.stringify({
  foods: [{ id: 'sf0', name: '米饭', per100: { kcal: 116, p: 2.6, c: 25.9, f: 0.3 } }],
  exercises: [{ id: 'se0', name: '跑步机慢跑', muscle: '有氧' }],
});

function buildLegacy() {
  const db = new DatabaseSync(TMP);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(LEGACY_DDL);
  db.prepare('INSERT INTO app(id, system_json) VALUES (1, ?)').run(OLD_SYS);
  db.prepare(`INSERT INTO users(id,name,avatar,color,activity,water_target,profile_json,rev,theme,onboarded,foods_json,exercises_json)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(UID, '老用户', '🙂', 'green', 1.375, 8, JSON.stringify({ height: 175 }), 7, 'dark', 1, OLD_FOODS, OLD_LIB);
  db.prepare('INSERT INTO accounts(username,user_id,pwd,role,created_at) VALUES (?,?,?,?,?)')
    .run('legacy', UID, 'scrypt$s$h', 'admin', 1);
  db.prepare('INSERT INTO sessions(token,username,created_at,expires_at) VALUES (?,?,?,?)').run('tk', 'legacy', 1, 9e12);
  /* 非运动数据：逐行写死，迁移后逐值比对 */
  db.prepare('INSERT INTO meal_days(user_id,date) VALUES (?,?)').run(UID, '2026-09-01');
  db.prepare('INSERT INTO meals(user_id,date,slot,seq,item_id,name,kcal,p,c,f,g) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(UID, '2026-09-01', 'breakfast', 0, 'm1', '燕麦片', 367, 13, 61, 7, 60);
  db.prepare('INSERT INTO body_records(user_id,seq,date,weight,waist) VALUES (?,?,?,?,?)').run(UID, 0, '2026-08-01', 72.1, 88.2);
  db.prepare('INSERT INTO sleep_sessions(user_id,date,seq,t,bed,wake,mins,quality) VALUES (?,?,?,?,?,?,?,?)')
    .run(UID, '2026-09-01', 0, 'night', '23:10', '07:20', 490, 4);
  db.prepare('INSERT INTO water_records(user_id,date,cups) VALUES (?,?,?)').run(UID, '2026-09-01', 8);
  db.prepare('INSERT INTO habits(user_id,habit_id,seq,name,icon,color) VALUES (?,?,?,?,?,?)').run(UID, 'h1', 0, '饮水达标', '💧', 'var(--cat1)');
  db.prepare('INSERT INTO habit_done(user_id,habit_id,date) VALUES (?,?,?)').run(UID, 'h1', '2026-09-01');
  /* 旧运动数据：都该被清掉 */
  db.prepare('INSERT INTO plan_defs(user_id,weekday,plan_id,name) VALUES (?,?,?,?)').run(UID, 1, 'p1', '推日');
  db.prepare('INSERT INTO plan_items(user_id,weekday,seq,item_id,ex_id,ex_name,muscle,sets,reps,weight) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(UID, 1, 0, 'pi1', 'e0', '杠铃卧推', '胸', 4, 8, 70);
  db.prepare('INSERT INTO workouts(user_id,workout_id,seq,date,name,note) VALUES (?,?,?,?,?,?)').run(UID, 'w1', 0, '2026-08-30', '推日', '');
  db.prepare('INSERT INTO workout_items(user_id,workout_id,seq,item_id,ex_id,ex_name,muscle) VALUES (?,?,?,?,?,?,?)')
    .run(UID, 'w1', 0, 'wi1', 'e0', '杠铃卧推', '胸');
  db.prepare('INSERT INTO workout_sets(user_id,workout_id,item_seq,seq,reps,weight) VALUES (?,?,?,?,?,?)')
    .run(UID, 'w1', 0, 0, 8, 70);
  db.close();
}

function count(db, sql, ...args) { return db.prepare(sql).get(...args).c; }

function main() {
  buildLegacy();

  /* ---------- 第一次 open：应触发重置 ---------- */
  const db = dbm.open(TMP);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  ok('T1 workout_sets 表已删除', !tables.includes('workout_sets'), tables.join(','));
  const wiCols = db.prepare('PRAGMA table_info(workout_items)').all().map(r => r.name);
  const piCols = db.prepare('PRAGMA table_info(plan_items)').all().map(r => r.name);
  ok('T2 workout_items 按新列重建', wiCols.join(',') === 'user_id,workout_id,seq,item_id,ex_id,ex_name,cat,muscle,reps,weight,mins,km', wiCols.join(','));
  ok('T3 plan_items 按新列重建(无 sets)', piCols.join(',') === 'user_id,weekday,seq,item_id,ex_id,ex_name,cat,muscle,reps,weight,mins,km', piCols.join(','));

  /* ---------- 运动数据清零 ---------- */
  ok('T4 周计划清空', count(db, 'SELECT COUNT(*) c FROM plan_defs') === 0 && count(db, 'SELECT COUNT(*) c FROM plan_items') === 0);
  ok('T5 运动日志清空', count(db, 'SELECT COUNT(*) c FROM workouts') === 0 && count(db, 'SELECT COUNT(*) c FROM workout_items') === 0);

  /* ---------- 非运动数据逐值完好 ---------- */
  const meal = db.prepare('SELECT * FROM meals WHERE user_id=?').get(UID);
  ok('T6a 饮食逐值完好', !!meal && meal.name === '燕麦片' && meal.kcal === 367 && meal.g === 60, JSON.stringify(meal));
  ok('T6b meal_days 完好', count(db, 'SELECT COUNT(*) c FROM meal_days WHERE user_id=?', UID) === 1);
  const body = db.prepare('SELECT * FROM body_records WHERE user_id=?').get(UID);
  ok('T6c 身体记录逐值完好', !!body && body.weight === 72.1 && body.waist === 88.2, JSON.stringify(body));
  const slp = db.prepare('SELECT * FROM sleep_sessions WHERE user_id=?').get(UID);
  ok('T6d 睡眠段逐值完好', !!slp && slp.mins === 490 && slp.quality === 4, JSON.stringify(slp));
  ok('T6e 饮水完好', count(db, 'SELECT cups c FROM water_records WHERE user_id=?', UID) === 8);
  ok('T6f 习惯与打卡完好',
    count(db, 'SELECT COUNT(*) c FROM habits WHERE user_id=?', UID) === 1
    && count(db, 'SELECT COUNT(*) c FROM habit_done WHERE user_id=?', UID) === 1);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(UID);
  ok('T7a 账户与会话完好', count(db, 'SELECT COUNT(*) c FROM accounts') === 1 && count(db, 'SELECT COUNT(*) c FROM sessions') === 1);
  ok('T7b 档案字段未动', u.name === '老用户' && u.theme === 'dark' && u.water_target === 8,
     JSON.stringify({ name: u.name, theme: u.theme }));
  ok('T7c 个人食物库原样保留', u.foods_json === OLD_FOODS, u.foods_json);
  ok('T7d 个人动作库置空(客户端以新种子重建)', u.exercises_json === null, String(u.exercises_json));
  ok('T7e 重置 bump rev(脏缓存客户端走人工裁决，不静默回推)', u.rev === 8, 'rev=' + u.rev);

  /* ---------- 系统库：只换动作 ---------- */
  const sys = JSON.parse(db.prepare('SELECT system_json FROM app WHERE id=1').get().system_json);
  ok('T8a 系统库食物原样保留', JSON.stringify(sys.foods) === JSON.stringify([{ id: 'sf0', name: '米饭', per100: { kcal: 116, p: 2.6, c: 25.9, f: 0.3 } }]),
     JSON.stringify(sys.foods));
  ok('T8b 系统库动作换为新种子(27 条带三件套)',
    sys.exercises.length === 27 && sys.exercises.every(e => e.cat && e.muscle && e.mode)
    && sys.exercises.some(e => e.name === '跑步' && e.cat === '有氧' && e.mode === 'time'),
    'n=' + sys.exercises.length + ' 首条=' + JSON.stringify(sys.exercises[0]));

  /* ---------- 幂等：重置后写入的运动数据，再次 open 必须存活 ---------- */
  db.prepare('INSERT INTO workouts(user_id,workout_id,seq,date,name,note) VALUES (?,?,?,?,?,?)').run(UID, 'w_new', 0, '2026-09-10', '新记录', '');
  db.prepare(`INSERT INTO workout_items(user_id,workout_id,seq,item_id,ex_id,ex_name,cat,muscle,reps,weight,mins,km)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(UID, 'w_new', 0, 'wi_new', 'e1', '跑步', '有氧', '全身', null, null, 30, 5);
  db.close();

  const db2 = dbm.open(TMP);
  ok('T9 重复 open 不复发：新建的运动记录存活',
    count(db2, 'SELECT COUNT(*) c FROM workouts') === 1 && count(db2, 'SELECT COUNT(*) c FROM workout_items') === 1);
  const it = db2.prepare('SELECT * FROM workout_items WHERE workout_id=?').get('w_new');
  ok('T10 新形状往返字段落地正确', it.mins === 30 && it.km === 5 && it.cat === '有氧' && it.muscle === '全身' && it.reps === null,
     JSON.stringify(it));
  /* 关掉再清理：DELETE journal 模式下无 -wal/-shm 残留 */
  db2.close();
  try { fs.rmSync(TMP, { force: true }); } catch (e) {}

  console.log('---');
  console.log(failed === 0 ? '全部通过:' + passed + ' 项断言(v4.11 破坏性迁移)'
                           : '通过 ' + passed + ',失败 ' + failed);
  process.exit(failed === 0 ? 0 : 1);
}

try { main(); } catch (e) { console.error('测试崩溃:', e); try { fs.rmSync(TMP, { force: true }); } catch (e2) {} process.exit(1); }
