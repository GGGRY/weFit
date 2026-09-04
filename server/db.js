'use strict';
/* =====================================================
   数据库层（零依赖：Node 内置 node:sqlite）
   职责：打开/建表。数据转换在 mapper.js，HTTP 在 server.js。
   ===================================================== */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB = path.join(__dirname, 'data', 'jjhealth.db');

/* 关系表设计：
 * - app：单行全局状态 + rev（乐观并发版本号）
 * - users：成员注册表；profile/goal/nutrition 是形状固定的小配置对象，JSON 列保真
 * - 会增长的集合（饮食/训练/计划/身体/睡眠/饮水/习惯）全部拆为真正的关系表
 * - 有数组语义处一律带 seq，保证顺序往返一致；日期/星期/习惯 id 等映射键天然唯一 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS app (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  theme TEXT NOT NULL DEFAULT 'light',
  onboarded INTEGER NOT NULL DEFAULT 0,
  active_user_id TEXT,
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  avatar TEXT,
  color TEXT,
  activity REAL,
  water_target INTEGER,
  profile_json TEXT,
  goal_json TEXT,
  nutrition_json TEXT
);
CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  kcal REAL, p REAL, c REAL, f REAL
);
CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  name TEXT, muscle TEXT
);
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
CREATE TABLE IF NOT EXISTS sleep_records (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  bed TEXT, wake TEXT, mins INTEGER, quality INTEGER,
  PRIMARY KEY (user_id, date)
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
`;

const ALL_TABLES = [
  'habit_done', 'habits', 'water_records', 'sleep_records', 'body_records',
  'workout_sets', 'workout_items', 'workouts', 'plan_items', 'plan_defs',
  'meals', 'meal_days', 'exercises', 'foods', 'users', 'app',
];

function open(dbPath) {
  const file = dbPath || process.env.DB_PATH || DEFAULT_DB;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  /* journal_mode=DELETE：不留常驻 -wal 边文件，数据库文件在 OneDrive 目录里同步更友好 */
  db.exec('PRAGMA journal_mode = DELETE;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

module.exports = { open, DEFAULT_DB, ALL_TABLES };
