'use strict';
/* =====================================================
   存量库一次性迁移测试（v4.6 睡眠多段化 sleep_records → sleep_sessions）
   为什么单独一个文件：这段逻辑只在"老库第一次启动"时跑一次，走不到 HTTP，
   roundtrip/admin 两套测试永远碰不到它——而它一旦出错就是启动崩或数据复活。
   手法：临时库里手工造一张旧 sleep_records 表 + 数据，close 后重新 open() 触发 migrate()。
   运行：node test/migrate.test.js
   ===================================================== */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dbm = require('../db');
const { composeUser } = require('../mapper');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('[PASS] ' + name); }
  else { failed++; console.log('[FAIL] ' + name + (detail ? '  →  ' + detail : '')); }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jjhealth-mig-'));
const FILE = path.join(dir, 'mig.db');

/* 旧表结构照抄 v4.5 及以前的定义（PK = user_id+date，一天一条；v4.6 起停建新库） */
function makeLegacyRows(db) {
  db.exec(`CREATE TABLE sleep_records(
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL, bed TEXT, wake TEXT, mins INTEGER, quality INTEGER,
    PRIMARY KEY (user_id, date));`);
  db.prepare(`INSERT INTO users(id, name, foods_json, exercises_json) VALUES ('u1','阿一','[]','[]')`).run();
  db.prepare(`INSERT INTO users(id, name, foods_json, exercises_json) VALUES ('u2','阿二','[]','[]')`).run();
  const ins = db.prepare('INSERT INTO sleep_records(user_id, date, bed, wake, mins, quality) VALUES (?,?,?,?,?,?)');
  ins.run('u1', '2026-08-01', '23:00', '07:00', 480, 4);
  ins.run('u1', '2026-08-02', '23:30', null, null, null);   // 半条记录（只有入睡）也要照样搬
  ins.run('u2', '2026-08-03', '00:00', '08:00', 480, 5);
  db.exec('PRAGMA foreign_keys=OFF');                        // 留一条真孤儿行：迁移不得为此崩启动
  ins.run('ghost', '2026-08-04', '01:00', '09:00', 480, 3);
  db.prepare('DELETE FROM users WHERE id = ?').run('u2');
}
const rows = db => db.prepare('SELECT user_id, date, seq, t, bed, wake, mins, quality FROM sleep_sessions ORDER BY user_id, date').all();
const flag = db => db.prepare('SELECT sleep_multi FROM app WHERE id = 1').get().sleep_multi;
const hasOld = db => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sleep_records'").get();

/* ---- 第一次启动：迁移 ---- */
let db = dbm.open(FILE);
makeLegacyRows(db);
db.prepare('UPDATE app SET sleep_multi = 0').run();
db.close();

try { db = dbm.open(FILE); }
catch (e) { ok('M1 存量库启动不崩', false, e.message); db = null; }

if (db) {
  const r = rows(db);
  ok('M1 存量库启动不崩（含孤儿旧行）', true);
  ok('M2 旧行逐条搬成 seq=0 的 night 段', JSON.stringify(r) === JSON.stringify([
    { user_id: 'u1', date: '2026-08-01', seq: 0, t: 'night', bed: '23:00', wake: '07:00', mins: 480, quality: 4 },
    { user_id: 'u1', date: '2026-08-02', seq: 0, t: 'night', bed: '23:30', wake: null, mins: null, quality: null },
  ]), JSON.stringify(r));
  ok('M3 已删账户的旧行不复活（CASCADE + 只认现存用户）', !r.some(x => x.user_id === 'u2'));
  ok('M4 迁移只跑一次（标志置 1）', flag(db) === 1, 'flag=' + flag(db));
  ok('M5 旧表留底不删（迁移可回溯）', hasOld(db));
  const data = composeUser(db, 'u1').data.users.u1;
  ok('M6 迁移结果按新形状读得出来', JSON.stringify(data.sleep['2026-08-01']) ===
    JSON.stringify([{ t: 'night', bed: '23:00', wake: '07:00', mins: 480, quality: 4 }]),
    JSON.stringify(data.sleep));
  ok('M7 空键按规范丢弃（2026-08-02 只有 bed）', JSON.stringify(data.sleep['2026-08-02']) ===
    JSON.stringify([{ t: 'night', bed: '23:30' }]), JSON.stringify(data.sleep['2026-08-02']));

  /* ---- 用户删光睡眠后重启：旧行不能被"再迁移"回来 ---- */
  db.prepare('DELETE FROM sleep_sessions WHERE user_id = ?').run('u1');
  db.close();
  db = dbm.open(FILE);
  ok('M8 删光睡眠后重启不复活（靠标志而非"新表为空"）', rows(db).length === 0, JSON.stringify(rows(db)));

  /* ---- 迁移之后正常读写不受影响 ---- */
  const put = composeUser(db, 'u1').data;
  put.users.u1.sleep['2026-08-01'] = [{ t: 'nap', bed: '13:00', wake: '13:30', mins: 30, quality: 4 }];
  const { replaceUser } = require('../mapper');
  replaceUser(db, 'u1', put);
  const after = composeUser(db, 'u1').data.users.u1.sleep;
  ok('M9 迁移后一天多段照常往返', JSON.stringify(after['2026-08-01']) ===
    JSON.stringify([{ t: 'nap', bed: '13:00', wake: '13:30', mins: 30, quality: 4 }]), JSON.stringify(after['2026-08-01']));
  db.close();
}

/* ---- 全新库（没有旧表）：只置标志，不建旧表、不产数据 ---- */
const fresh = path.join(dir, 'fresh.db');
let fdb = dbm.open(fresh);
ok('M10 新库无旧表可迁', !hasOld(fdb));
ok('M11 新库标志直接置 1（下次启动零开销）', flag(fdb) === 1 && rows(fdb).length === 0);
fdb.close();

console.log('---');
console.log(failed === 0 ? '全部通过:' + passed + ' 项断言(睡眠多段化一次性迁移)' : '通过 ' + passed + ',失败 ' + failed);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
process.exit(failed === 0 ? 0 : 1);
