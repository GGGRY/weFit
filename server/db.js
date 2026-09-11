'use strict';
/* =====================================================
   数据库层（零依赖：Node 内置 node:sqlite）
   职责：打开/建表/迁移。数据转换在 mapper.js，HTTP 在 server.js，鉴权在 auth.js。
   v4 起：鉴权账户 + 会话持久化 + 账户级数据隔离（每用户独立 rev / 个人库）。
   ===================================================== */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { seedLibrary } = require('./seed');

const DEFAULT_DB = path.join(__dirname, 'data', 'jjhealth.db');

/* 关系表设计：
 * - app：单行全局配置（v4.3 起仅存 system_json；旧版 theme/onboarded/active_user_id/rev
 *   遗留列与全局 foods/exercises 表已停止建新库——存量库不 DROP，避免破坏性迁移）
 * - users：成员注册表；profile/goal/nutrition 是形状固定的小配置对象，JSON 列保真
 * - 会增长的集合（饮食/训练/计划/身体/睡眠/饮水/习惯）全部拆为真正的关系表
 * - 有数组语义处一律带 seq，保证顺序往返一致；日期/星期/习惯 id 等映射键天然唯一
 * - v4.11 唯一一处例外：运动项由 sets 数组拍平为列，旧运动表整体作废（见 wipeLegacyWorkout）
 * - v4.12：周计划与运动记录合并——plan_defs/plan_items 取消，workouts/workout_items 改按 date 键，
 *   一天一条；done=1 即运动记录，done 缺省即未完成的计划（见 wipeLegacyWorkout） */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS app (
  id INTEGER PRIMARY KEY CHECK (id = 1)
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT,
  avatar TEXT,
  color TEXT,
  activity REAL,
  water_target INTEGER,
  profile_json TEXT,
  goal_json TEXT,
  nutrition_json TEXT
);
/* v4.3：旧全局 foods/exercises 表停止建表（v4 起系统库在 app.system_json、个人库在
 * users 的 JSON 列；存量库中的同名遗留空表保持不删，见文件头注释） */
/* 日期被"打开过"的标记（餐次可能 4 槽全空，也要能原样还原） */
CREATE TABLE IF NOT EXISTS meal_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS meals (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  slot TEXT NOT NULL,
  seq INTEGER NOT NULL,
  item_id TEXT, name TEXT,
  kcal REAL, p REAL, c REAL, f REAL, g REAL,
  PRIMARY KEY (user_id, date, slot, seq)
);
/* v4.12：周计划与运动记录合并 —— 一天一条「运动安排」，date 即身份。
 * 同版本第二步：完成的粒度从「一天」下放到「每一项」——done 移到 workout_items，
 * 当天只要有一项打勾即视为该日已运动（days 表的 done 列已废弃，存量库保留死列不 DROP）。
 * seq 只用于保数组顺序（与其余集合同约定），旧结构见 wipeLegacyWorkout()。 */
CREATE TABLE IF NOT EXISTS workouts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  seq INTEGER NOT NULL,
  day_id TEXT, name TEXT,
  PRIMARY KEY (user_id, date)
);
/* v4.11：运动项拍平 —— 力量（次数+重量）与计时（时长+距离）同表同形；
 * v4.12：随 workouts 一起改挂 date（一天一条，项序用 seq 保真）；
 * v4.12：done 落到每一项（1 = 已打勾完成）。 */
CREATE TABLE IF NOT EXISTS workout_items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  seq INTEGER NOT NULL,
  item_id TEXT, ex_id TEXT, ex_name TEXT, cat TEXT, muscle TEXT,
  reps REAL, weight REAL, mins REAL, km REAL,
  done INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date, seq)
);
/* v4.11 起不再有 workout_sets（逐组子表）——一次记录 = 一条汇总，见 wipeLegacyWorkout()；
 * v4.12 起不再有 plan_defs/plan_items——周计划已并入 workouts；
 * v4.12 起 workouts.done 废弃（完成状态在 workout_items.done），存量库保留死列 */
/* 同日多条是旧版导入可能出现的形状，故主键用 seq 而非 date */
CREATE TABLE IF NOT EXISTS body_records (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  date TEXT NOT NULL,
  weight REAL, chest REAL, waist REAL, hip REAL, arm REAL, thigh REAL, calf REAL, bf REAL,
  PRIMARY KEY (user_id, seq)
);
/* 睡眠多段：一天可有多段（夜间/午睡/其他休息），seq 保录入顺序 */
CREATE TABLE IF NOT EXISTS sleep_sessions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL, seq INTEGER NOT NULL,
  t TEXT, bed TEXT, wake TEXT, mins INTEGER, quality INTEGER,
  PRIMARY KEY (user_id, date, seq)
);
CREATE TABLE IF NOT EXISTS water_records (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  cups INTEGER,
  PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS habits (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  habit_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  name TEXT, icon TEXT, color TEXT,
  PRIMARY KEY (user_id, habit_id)
);
CREATE TABLE IF NOT EXISTS habit_done (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  habit_id TEXT NOT NULL,
  date TEXT NOT NULL,
  PRIMARY KEY (user_id, habit_id, date)
);
CREATE INDEX IF NOT EXISTS idx_body_date ON body_records(user_id, date);
/* v4：登录账户与会话（老数据不迁移——存量成员视为作废，新账户注册即建档） */
CREATE TABLE IF NOT EXISTS accounts (
  username TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pwd TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
`;

/* 对既有数据库做幂等列迁移（SQLite 的 ADD COLUMN 无 IF NOT EXISTS，先查 table_info） */
function tableCols(db, table) {
  return db.prepare('PRAGMA table_info(' + table + ')').all().map(r => r.name);
}
function tableExists(db, table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

/* =====================================================
   破坏性重置：旧运动数据整体作废
   v4.11（用户裁定 2026-09-06）：运动项 sets 拍平 → 周计划 / 日志 / 个人动作库作废
   v4.12（用户裁定 2026-09-11）：计划与记录合并 → 周计划 / 日志作废，动作库**保留**

   判据（两类，任一为真即重置）：
     preV411 = workout_sets 表存在（该表只属于 v4.10 及以前，新 SCHEMA 不再建它）
     preV412 = plan_defs/plan_items 存在，或 workouts/workout_items 还是旧列
   跑过一次之后判据全部为假，故天然幂等、绝不复发。
   删除范围：周计划 / 运动日志；preV411 额外作废个人动作库与系统库 exercises（foods 保留）
   保留：饮食、身体、睡眠、饮水、习惯、账户、食物库；v4.12 的动作库原样保留
   ===================================================== */
const LEGACY_WORKOUT_TABLES = ['workout_items', 'workout_sets', 'workouts', 'plan_items', 'plan_defs'];
function legacyWorkoutShape(db) {
  const preV411 = tableExists(db, 'workout_sets');
  const preV412 = preV411
    || tableExists(db, 'plan_defs') || tableExists(db, 'plan_items')
    || (tableExists(db, 'workouts') && !tableCols(db, 'workouts').includes('day_id'))
    || (tableExists(db, 'workout_items') && !tableCols(db, 'workout_items').includes('date'));
  return preV412 ? { wipe: true, preV411 } : { wipe: false, preV411: false };
}
function wipeLegacyWorkout(db) {
  const { wipe, preV411 } = legacyWorkoutShape(db);
  if (!wipe) return false;
  /* 整段包进一个事务：DROP 与两处 JSON 更新要么全成、要么全回滚。
   * 逐条裸跑时若崩在中间（判据表已删、JSON 还没换），下次启动判据即消失 → 重置永久只做一半，
   * 且 SCHEMA 的 CREATE IF NOT EXISTS 也补不回来（旧表还在，新列永远不会补）。 */
  db.exec('BEGIN IMMEDIATE');
  try {
    LEGACY_WORKOUT_TABLES.forEach(t => db.exec('DROP TABLE IF EXISTS ' + t));
    /* 下面两步按「表 + 列都在」为条件执行：本函数跑在 open() 建表/迁移之前，
     * 多一层判空可避免任何形状异常把服务器启动打断 */
    if (tableExists(db, 'users')) {
      const cols = tableCols(db, 'users');
      /* v4.11 才需要动动作库：sets 时代个人库缺 cat/mode 三件套，必须整份重建。
       * v4.12 只合并了计划/记录，动作项形状与 v4.11 一致，个人动作库原样保留。 */
      if (preV411 && cols.includes('exercises_json')) db.exec('UPDATE users SET exercises_json = NULL');
      /* rev +1：让各客户端「本机脏缓存」走进人工裁决（converge 的 dirty && rev 前移分支），
       * 而不是凭同代脏直接整树回推——否则旧形状会在重置后悄悄回流 */
      if (cols.includes('rev')) db.exec('UPDATE users SET rev = rev + 1');
    }
    if (preV411 && tableExists(db, 'app') && tableCols(db, 'app').includes('system_json')) {
      const row = db.prepare('SELECT system_json FROM app WHERE id = 1').get();
      let sys = {};
      try { sys = JSON.parse((row && row.system_json) || '{}') || {}; } catch (e) { sys = {}; }
      db.prepare('UPDATE app SET system_json = ? WHERE id = 1')
        .run(JSON.stringify({ foods: Array.isArray(sys.foods) ? sys.foods : [], exercises: seedLibrary().exercises }));  // 只换动作
    }
    db.exec('COMMIT');
  } catch (e) {
    /* 重置做不干净宁可起不来：带着半新半旧的表结构继续跑只会更糟 */
    try { db.exec('ROLLBACK'); } catch (e2) { /* 回滚失败保持原错误上抛 */ }
    throw e;
  }
  return true;
}

function addColumn(db, table, col, decl) {
  if (!tableCols(db, table).includes(col)) db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + col + ' ' + decl);
}
function migrate(db) {
  /* 每用户独立：乐观并发版本号、界面偏好、个人食物/动作库（JSON 整存保真） */
  addColumn(db, 'users', 'rev', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'users', 'theme', 'TEXT');
  addColumn(db, 'users', 'onboarded', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'users', 'foods_json', 'TEXT');
  addColumn(db, 'users', 'exercises_json', 'TEXT');
  /* 系统共享库：单行 app 上整存 {foods, exercises}，管理员维护 */
  addColumn(db, 'app', 'system_json', 'TEXT');
  /* 身体数据新增「小腿围」（存量库 ALTER 补列，旧值保持 NULL） */
  addColumn(db, 'body_records', 'calf', 'REAL');
  /* v4.12 第二步（就地补列）：完成粒度由「一天」下放到「每一项」。
   * ① 给存量库补 workout_items.done（新库已在 SCHEMA 里带上，这里是 no-op）；
   * ② 把旧的「整天已完成」下放到它的每一项——数据零丢失，不破坏性重置。
   * **回填必须在「刚刚补上这一列」的那一次做**（hadItemDone 判定）：
   * 否则每次启动都会把旧 done=1 那天的项重新刷成 1，用户取消完成的操作会被静默推翻。 */
  const hadItemDone = tableCols(db, 'workout_items').includes('done');
  addColumn(db, 'workout_items', 'done', 'INTEGER NOT NULL DEFAULT 0');
  if (!hadItemDone && tableExists(db, 'workouts') && tableCols(db, 'workouts').includes('done')) {
    db.exec(`UPDATE workout_items SET done = 1 WHERE done = 0
             AND date IN (SELECT date FROM workouts WHERE done = 1)`);
  }
  db.exec('INSERT OR IGNORE INTO app(id) VALUES (1)');
  const row = db.prepare('SELECT system_json FROM app WHERE id = 1').get();
  let ok = false;
  try {
    const j = JSON.parse(row.system_json);
    ok = !!(j && Array.isArray(j.foods) && Array.isArray(j.exercises));
  } catch (e) { /* 空/坏 JSON → 重播种 */ }
  if (!ok) db.prepare('UPDATE app SET system_json = ? WHERE id = 1').run(JSON.stringify(seedLibrary()));
}

function open(dbPath) {
  const file = dbPath || process.env.DB_PATH || DEFAULT_DB;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  /* journal_mode=DELETE：不留常驻 -wal 边文件，数据库文件在 OneDrive 目录里同步更友好 */
  db.exec('PRAGMA journal_mode = DELETE;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  /* 必须在建表之前——先 DROP 旧结构，再由 SCHEMA 建出新结构的表 */
  if (wipeLegacyWorkout(db)) {
    console.log('[db] 破坏性重置：旧运动数据（周计划/运动日志）已作废并重建新结构');
  }
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

module.exports = { open, DEFAULT_DB };
