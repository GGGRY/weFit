'use strict';
/* =====================================================
   破坏性迁移 + 就地迁移回归测试（db.js 的 wipeLegacyWorkout / migrate）
   前者会「删用户数据」，后者绝不能。三种旧结构各测一遍，判据互斥且幂等：

   A. preV411（有 workout_sets，v4.10 及以前）：运动项 sets 拍平
      → 周计划 / 运动日志 / 个人动作库全部作废，系统库只换 exercises，其余数据零影响
   B. preV412（有 plan_defs，workouts 还是 workout_id 列，v4.11）：周计划与日志合并
      → 周计划与日志作废、workouts 按 date 重建；动作库原样保留，其余零影响
   C. v4.12 中间态（天级 done，项上还没有 done）：完成粒度下放到每一项
      → **就地迁移，不删任何数据、不动 rev**：补 workout_items.done 并把旧的
        「整天已完成」下放到它的每一项；回填只在补列那一次做（用户取消的完成不能被刷回来）

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

const TMP_A = path.join(__dirname, 'tmp-prev411-migration.db');
const TMP_B = path.join(__dirname, 'tmp-prev412-migration.db');
const TMP_C = path.join(__dirname, 'tmp-prev413-migration.db');

/* ---------- 非运动数据（两套旧库共用的 DDL 片段；迁移后要逐值比对） ---------- */
const COMMON_DDL = `
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

/* ---------- v4.10 及以前的运动三表（有 workout_sets） ---------- */
const V411_DDL = COMMON_DDL + `
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
`;

/* ---------- v4.11（sets 已拍平；周计划与日志还分着） ---------- */
const V412_DDL = COMMON_DDL + `
CREATE TABLE plan_defs (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, weekday INTEGER NOT NULL,
  plan_id TEXT, name TEXT, PRIMARY KEY (user_id, weekday));
CREATE TABLE plan_items (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, weekday INTEGER NOT NULL,
  seq INTEGER NOT NULL, item_id TEXT, ex_id TEXT, ex_name TEXT, cat TEXT, muscle TEXT,
  reps REAL, weight REAL, mins REAL, km REAL, PRIMARY KEY (user_id, weekday, seq));
CREATE TABLE workouts (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, workout_id TEXT NOT NULL,
  seq INTEGER NOT NULL, date TEXT, name TEXT, note TEXT, PRIMARY KEY (user_id, workout_id));
CREATE TABLE workout_items (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, workout_id TEXT NOT NULL,
  seq INTEGER NOT NULL, item_id TEXT, ex_id TEXT, ex_name TEXT, cat TEXT, muscle TEXT,
  reps REAL, weight REAL, mins REAL, km REAL, PRIMARY KEY (user_id, workout_id, seq));
`;

const UID = 'u_legacy';
const OLD_LIB = JSON.stringify([{ id: 'e0', name: '杠铃卧推', muscle: '胸' }]);            // v4.10：缺 cat/mode
const NEW_LIB = JSON.stringify([{ id: 'e0', name: '杠铃卧推', cat: '力量', muscle: '胸', mode: 'reps' }]);
const OLD_FOODS = JSON.stringify([{ id: 'f0', name: '米饭', per100: { kcal: 116, p: 2.6, c: 25.9, f: 0.3 } }]);
const OLD_SYS = JSON.stringify({
  foods: [{ id: 'sf0', name: '米饭', per100: { kcal: 116, p: 2.6, c: 25.9, f: 0.3 } }],
  exercises: [{ id: 'se0', name: '跑步机慢跑', muscle: '有氧' }],
});

/* 两套旧库共用的非运动数据（迁移后逐值断言） */
function insertCommonData(db, libJson) {
  db.prepare(`INSERT INTO users(id,name,avatar,color,activity,water_target,profile_json,rev,theme,onboarded,foods_json,exercises_json)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(UID, '老用户', '🙂', 'green', 1.375, 8, JSON.stringify({ height: 175 }), 7, 'dark', 1, OLD_FOODS, libJson);
  db.prepare('INSERT INTO accounts(username,user_id,pwd,role,created_at) VALUES (?,?,?,?,?)')
    .run('legacy', UID, 'scrypt$s$h', 'admin', 1);
  db.prepare('INSERT INTO sessions(token,username,created_at,expires_at) VALUES (?,?,?,?)').run('tk', 'legacy', 1, 9e12);
  db.prepare('INSERT INTO meal_days(user_id,date) VALUES (?,?)').run(UID, '2026-09-01');
  db.prepare('INSERT INTO meals(user_id,date,slot,seq,item_id,name,kcal,p,c,f,g) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(UID, '2026-09-01', 'breakfast', 0, 'm1', '燕麦片', 367, 13, 61, 7, 60);
  db.prepare('INSERT INTO body_records(user_id,seq,date,weight,waist) VALUES (?,?,?,?,?)').run(UID, 0, '2026-08-01', 72.1, 88.2);
  db.prepare('INSERT INTO sleep_sessions(user_id,date,seq,t,bed,wake,mins,quality) VALUES (?,?,?,?,?,?,?,?)')
    .run(UID, '2026-09-01', 0, 'night', '23:10', '07:20', 490, 4);
  db.prepare('INSERT INTO water_records(user_id,date,cups) VALUES (?,?,?)').run(UID, '2026-09-01', 8);
  db.prepare('INSERT INTO habits(user_id,habit_id,seq,name,icon,color) VALUES (?,?,?,?,?,?)').run(UID, 'h1', 0, '饮水达标', '💧', 'var(--cat1)');
  db.prepare('INSERT INTO habit_done(user_id,habit_id,date) VALUES (?,?,?)').run(UID, 'h1', '2026-09-01');
}

function buildPreV411() {
  const db = new DatabaseSync(TMP_A);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(V411_DDL);
  db.prepare('INSERT INTO app(id, system_json) VALUES (1, ?)').run(OLD_SYS);
  insertCommonData(db, OLD_LIB);
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

function buildPreV412() {
  const db = new DatabaseSync(TMP_B);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(V412_DDL);
  db.prepare('INSERT INTO app(id, system_json) VALUES (1, ?)').run(OLD_SYS);
  insertCommonData(db, NEW_LIB);
  db.prepare('INSERT INTO plan_defs(user_id,weekday,plan_id,name) VALUES (?,?,?,?)').run(UID, 1, 'p1', '推日');
  db.prepare(`INSERT INTO plan_items(user_id,weekday,seq,item_id,ex_id,ex_name,cat,muscle,reps,weight,mins,km)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(UID, 1, 0, 'pi1', 'e0', '杠铃卧推', '力量', '胸', 32, 70, null, null);
  db.prepare('INSERT INTO workouts(user_id,workout_id,seq,date,name,note) VALUES (?,?,?,?,?,?)').run(UID, 'w1', 0, '2026-09-02', '推日', '');
  db.prepare(`INSERT INTO workout_items(user_id,workout_id,seq,item_id,ex_id,ex_name,cat,muscle,reps,weight,mins,km)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(UID, 'w1', 0, 'wi1', 'e0', '杠铃卧推', '力量', '胸', 32, 70, null, null);
  db.close();
}

function count(db, sql, ...args) { return db.prepare(sql).get(...args).c; }
function cols(db, t) { return db.prepare('PRAGMA table_info(' + t + ')').all().map(r => r.name).join(','); }
function tables(db) { return db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name); }
function assertCommonIntact(db, label) {
  const meal = db.prepare('SELECT * FROM meals WHERE user_id=?').get(UID);
  ok(label + ' 饮食逐值完好', !!meal && meal.name === '燕麦片' && meal.kcal === 367 && meal.g === 60, JSON.stringify(meal));
  const body = db.prepare('SELECT * FROM body_records WHERE user_id=?').get(UID);
  ok(label + ' 身体记录逐值完好', !!body && body.weight === 72.1 && body.waist === 88.2, JSON.stringify(body));
  ok(label + ' 身体新增列「小腿围」已补上且旧值为 NULL',
    cols(db, 'body_records').includes('calf') && body.calf === null, cols(db, 'body_records'));
  const slp = db.prepare('SELECT * FROM sleep_sessions WHERE user_id=?').get(UID);
  ok(label + ' 睡眠段逐值完好', !!slp && slp.mins === 490 && slp.quality === 4, JSON.stringify(slp));
  ok(label + ' 饮水/习惯/账户/会话完好',
    count(db, 'SELECT cups c FROM water_records WHERE user_id=?', UID) === 8
    && count(db, 'SELECT COUNT(*) c FROM habits WHERE user_id=?', UID) === 1
    && count(db, 'SELECT COUNT(*) c FROM habit_done WHERE user_id=?', UID) === 1
    && count(db, 'SELECT COUNT(*) c FROM accounts') === 1
    && count(db, 'SELECT COUNT(*) c FROM sessions') === 1);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(UID);
  ok(label + ' 档案字段未动', u.name === '老用户' && u.theme === 'dark' && u.water_target === 8, JSON.stringify({ name: u.name, theme: u.theme }));
  ok(label + ' 个人食物库原样保留', u.foods_json === OLD_FOODS, u.foods_json);
  ok(label + ' 重置 bump rev(脏缓存客户端走人工裁决，不静默回推)', u.rev === 8, 'rev=' + u.rev);
  return u;
}

/* ============ A. preV411：sets 拍平 ============ */
function scenarioA() {
  try { fs.rmSync(TMP_A, { force: true }); } catch (e) {}
  buildPreV411();
  const db = dbm.open(TMP_A);
  const ts = tables(db);
  ok('A1 workout_sets 表已删除', !ts.includes('workout_sets'), ts.join(','));
  ok('A2 plan_defs/plan_items 已删除(v4.12 起不再有)',
    !ts.includes('plan_defs') && !ts.includes('plan_items'), ts.join(','));
  ok('A3 workouts 按 date 重建', cols(db, 'workouts') === 'user_id,date,seq,day_id,name', cols(db, 'workouts'));
  ok('A4 workout_items 按 date 重建且带 done', cols(db, 'workout_items') === 'user_id,date,seq,item_id,ex_id,ex_name,cat,muscle,reps,weight,mins,km,done', cols(db, 'workout_items'));
  ok('A5 运动数据清零', count(db, 'SELECT COUNT(*) c FROM workouts') === 0 && count(db, 'SELECT COUNT(*) c FROM workout_items') === 0);
  const u = assertCommonIntact(db, 'A6');
  ok('A7 个人动作库置空(客户端以新种子重建)', u.exercises_json === null, String(u.exercises_json));
  const sys = JSON.parse(db.prepare('SELECT system_json FROM app WHERE id=1').get().system_json);
  ok('A8 系统库食物原样保留', JSON.stringify(sys.foods) === JSON.stringify([{ id: 'sf0', name: '米饭', per100: { kcal: 116, p: 2.6, c: 25.9, f: 0.3 } }]), JSON.stringify(sys.foods));
  ok('A9 系统库动作换为新种子(27 条带三件套)',
    sys.exercises.length === 27 && sys.exercises.every(e => e.cat && e.muscle && e.mode)
    && sys.exercises.some(e => e.name === '跑步' && e.cat === '有氧' && e.mode === 'time'),
    'n=' + sys.exercises.length + ' 首条=' + JSON.stringify(sys.exercises[0]));
  /* 幂等：重置后按新形状写入的数据，再次 open 必须存活（判据此时已全为假） */
  db.prepare('INSERT INTO workouts(user_id,date,seq,day_id,name) VALUES (?,?,?,?,?)').run(UID, '2026-09-10', 0, 'w_new', '新安排');
  db.prepare(`INSERT INTO workout_items(user_id,date,seq,item_id,ex_id,ex_name,cat,muscle,reps,weight,mins,km,done)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(UID, '2026-09-10', 0, 'wi_new', 'e1', '跑步', '有氧', '全身', null, null, 30, 5, 1);
  db.close();
  const db2 = dbm.open(TMP_A);
  ok('A10 重复 open 不复发：新建安排存活',
    count(db2, 'SELECT COUNT(*) c FROM workouts') === 1 && count(db2, 'SELECT COUNT(*) c FROM workout_items') === 1);
  const it = db2.prepare('SELECT * FROM workout_items WHERE date=?').get('2026-09-10');
  const wk = db2.prepare('SELECT * FROM workouts WHERE date=?').get('2026-09-10');
  ok('A11 新形状往返字段落地正确', it.mins === 30 && it.km === 5 && it.cat === '有氧' && it.muscle === '全身' && it.reps === null
    && it.done === 1 && wk.day_id === 'w_new', JSON.stringify(it) + ' ' + JSON.stringify(wk));
  db2.close();
}

/* ============ B. preV412：计划与记录合并 ============ */
function scenarioB() {
  try { fs.rmSync(TMP_B, { force: true }); } catch (e) {}
  buildPreV412();
  const db = dbm.open(TMP_B);
  const ts = tables(db);
  ok('B1 plan_defs/plan_items 已删除', !ts.includes('plan_defs') && !ts.includes('plan_items'), ts.join(','));
  ok('B2 workouts 按 date 重建(无天级 done)', cols(db, 'workouts') === 'user_id,date,seq,day_id,name', cols(db, 'workouts'));
  ok('B3 workout_items 按 date 重建且带 done', cols(db, 'workout_items') === 'user_id,date,seq,item_id,ex_id,ex_name,cat,muscle,reps,weight,mins,km,done', cols(db, 'workout_items'));
  ok('B4 周计划与运动日志清零', count(db, 'SELECT COUNT(*) c FROM workouts') === 0 && count(db, 'SELECT COUNT(*) c FROM workout_items') === 0);
  const u = assertCommonIntact(db, 'B5');
  ok('B6 动作库原样保留(v4.12 没动项形状，不该误伤)', u.exercises_json === NEW_LIB, String(u.exercises_json));
  const sys = db.prepare('SELECT system_json FROM app WHERE id=1').get().system_json;
  ok('B7 系统库一字未改', sys === OLD_SYS, sys);
  /* 幂等：新形状写入后再次 open 存活，done 保真 */
  db.prepare('INSERT INTO workouts(user_id,date,seq,day_id,name) VALUES (?,?,?,?,?)').run(UID, '2026-09-12', 0, 'w2', '计划日');
  db.prepare(`INSERT INTO workout_items(user_id,date,seq,item_id,ex_id,ex_name,cat,muscle,reps,weight,mins,km,done)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(UID, '2026-09-12', 0, 'wi2', 'e0', '杠铃卧推', '力量', '胸', 30, 60, null, null, 0);
  db.close();
  const db2 = dbm.open(TMP_B);
  ok('B8 重复 open 不复发：新建计划存活且项级 done 保真',
    count(db2, 'SELECT COUNT(*) c FROM workouts') === 1 && count(db2, 'SELECT COUNT(*) c FROM workout_items') === 1
    && db2.prepare('SELECT done d FROM workout_items WHERE item_id=?').get('wi2').d === 0);
  db2.close();
}

/* ============ C. v4.12 中间态：完成粒度下放到每一项（就地补列，不删数据） ============ */
const V412_MID_DDL = COMMON_DDL + `
CREATE TABLE workouts (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL,
  seq INTEGER NOT NULL, day_id TEXT, name TEXT, done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, date));
CREATE TABLE workout_items (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL,
  seq INTEGER NOT NULL, item_id TEXT, ex_id TEXT, ex_name TEXT, cat TEXT, muscle TEXT,
  reps REAL, weight REAL, mins REAL, km REAL, PRIMARY KEY (user_id, date, seq));
`;
function buildV412Mid() {
  const db = new DatabaseSync(TMP_C);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(V412_MID_DDL);
  db.prepare('INSERT INTO app(id, system_json) VALUES (1, ?)').run(OLD_SYS);
  insertCommonData(db, NEW_LIB);
  const wi = db.prepare(`INSERT INTO workout_items(user_id,date,seq,item_id,ex_id,ex_name,cat,muscle,reps,weight,mins,km)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const w = db.prepare('INSERT INTO workouts(user_id,date,seq,day_id,name,done) VALUES (?,?,?,?,?,?)');
  w.run(UID, '2026-09-20', 0, 'd1', '已完成的推日', 1);   /* 旧：整天 done=1，两项 */
  wi.run(UID, '2026-09-20', 0, 'i1', 'e0', '杠铃卧推', '力量', '胸', 32, 70, null, null);
  wi.run(UID, '2026-09-20', 1, 'i2', 'e18', '跑步', '有氧', '全身', null, null, 30, 5);
  w.run(UID, '2026-09-21', 1, 'd2', '明天的腿日', 0);      /* 旧：未开始 */
  wi.run(UID, '2026-09-21', 0, 'i3', 'e0', '杠铃深蹲', '力量', '腿', 32, 90, null, null);
  db.close();
}
function scenarioC() {
  try { fs.rmSync(TMP_C, { force: true }); } catch (e) {}
  buildV412Mid();
  const db = dbm.open(TMP_C);
  ok('C1 workout_items 补上 done 列', cols(db, 'workout_items').endsWith(',done'), cols(db, 'workout_items'));
  ok('C2 数据零丢失：2 天 + 3 项全在',
    count(db, 'SELECT COUNT(*) c FROM workouts') === 2 && count(db, 'SELECT COUNT(*) c FROM workout_items') === 3);
  ok('C3 旧的「整天已完成」下放到它的每一项，未开始的那天保持不变',
    count(db, "SELECT COUNT(*) c FROM workout_items WHERE date='2026-09-20' AND done=1") === 2
    && count(db, "SELECT COUNT(*) c FROM workout_items WHERE date='2026-09-21' AND done=0") === 1);
  ok('C4 就地迁移不动 rev（这不是破坏性重置）', db.prepare('SELECT rev FROM users WHERE id=?').get(UID).rev === 7);
  ok('C5 动作库与系统库原样保留',
    db.prepare('SELECT exercises_json e FROM users WHERE id=?').get(UID).e === NEW_LIB
    && db.prepare('SELECT system_json s FROM app WHERE id=1').get().s === OLD_SYS);
  /* 用户取消某项完成 → 再次 open 不能被回填复位（回填只在补列那一次做） */
  db.prepare("UPDATE workout_items SET done = 0 WHERE item_id='i2'").run();
  db.close();
  const db2 = dbm.open(TMP_C);
  ok('C6 回填只做一次：用户取消的完成不会被重新刷上',
    db2.prepare("SELECT done d FROM workout_items WHERE item_id='i2'").get().d === 0
    && db2.prepare("SELECT done d FROM workout_items WHERE item_id='i1'").get().d === 1);
  db2.close();
}

function main() {
  scenarioA();
  scenarioB();
  scenarioC();
  try { fs.rmSync(TMP_A, { force: true }); } catch (e) {}
  try { fs.rmSync(TMP_B, { force: true }); } catch (e) {}
  try { fs.rmSync(TMP_C, { force: true }); } catch (e) {}
  console.log('---');
  console.log(failed === 0 ? '全部通过:' + passed + ' 项断言(v4.11/v4.12 破坏性迁移 + v4.12 就地补列)'
                           : '通过 ' + passed + ',失败 ' + failed);
  process.exit(failed === 0 ? 0 : 1);
}

try { main(); } catch (e) {
  console.error('测试崩溃:', e);
  try { fs.rmSync(TMP_A, { force: true }); } catch (e2) {}
  try { fs.rmSync(TMP_B, { force: true }); } catch (e2) {}
  try { fs.rmSync(TMP_C, { force: true }); } catch (e2) {}
  process.exit(1);
}
