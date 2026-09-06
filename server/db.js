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
 * - 有数组语义处一律带 seq，保证顺序往返一致；日期/星期/习惯 id 等映射键天然唯一 */
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
CREATE TABLE IF NOT EXISTS plan_defs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL,
  plan_id TEXT, name TEXT,
  PRIMARY KEY (user_id, weekday)
);
CREATE TABLE IF NOT EXISTS plan_items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  item_id TEXT, ex_id TEXT, ex_name TEXT, muscle TEXT,
  sets INTEGER, reps INTEGER, weight REAL,
  PRIMARY KEY (user_id, weekday, seq)
);
CREATE TABLE IF NOT EXISTS workouts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  date TEXT, name TEXT, note TEXT,
  PRIMARY KEY (user_id, workout_id)
);
CREATE TABLE IF NOT EXISTS workout_items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  item_id TEXT, ex_id TEXT, ex_name TEXT, muscle TEXT,
  PRIMARY KEY (user_id, workout_id, seq)
);
/* 用 item_seq 引用所属动作项（而非 item_id）：主键列不能为 NULL，旧数据可能缺 id */
CREATE TABLE IF NOT EXISTS workout_sets (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id TEXT NOT NULL,
  item_seq INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  reps REAL, weight REAL,
  PRIMARY KEY (user_id, workout_id, item_seq, seq)
);
/* 同日多条是旧版导入可能出现的形状，故主键用 seq 而非 date */
CREATE TABLE IF NOT EXISTS body_records (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  date TEXT NOT NULL,
  weight REAL, chest REAL, waist REAL, hip REAL, arm REAL, thigh REAL, bf REAL,
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
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

module.exports = { open, DEFAULT_DB };
