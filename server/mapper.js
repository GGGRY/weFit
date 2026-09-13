'use strict';
/* =====================================================
   单用户 状态树 ⇄ 关系表 双向转换(v4 账户隔离版)
   核心不变量:replaceUser(db, uid, X) 之后 composeUser(db, uid).data
   必须与 X 的本人数树深度相等(数组顺序、键"存在/缺失"都保真)。
   每用户独立 rev;个人食物/动作库整存 users.foods_json/exercises_json。
   老版本的全库替换(split/clearAll/compose)已删除——那正是
   "多人同时写互相覆盖"的根因,写路径只允许触碰自己那一份。

   v4.20 同步切片化：在「整树 PUT」之外增加**按片读写**——片 = (账户, date) 或账户级固定块，
   写只写脏片、CAS 按片、冲突只冲突同片。切片键语法与树上取写在 public/js/slices.js（两端共用）；
   本文件里的逐片 SQL 读写函数同时被「整树路径」与「切片路径」复用，保证两条路写出的形状一致。
   ===================================================== */

/* 睡眠形状契约与前端共用同一份实现：normalizeSleepDay 负责脏元素/脏字段丢弃，
 * 见 public/js/sleep-shape.js 文件头 */
const { normalizeSleepDay, SLEEP_MAX_SEGS } = require('../public/js/sleep-shape.js');
/* 同步切片契约（v4.20）同样与前端共用：切片键语法 / 树上取写 / 人话名见 public/js/slices.js */
const SLICES = require('../public/js/slices.js');

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
/* 身体指标列（顺序即写库列序，与前端 public/js/app.js 的 MEASURES 对位；新增指标两边同步加）
 * 2026-09-12 扩充：收缩压 sbp / 舒张压 dbp（mmHg）、空腹血糖 fbg / 餐后血糖 pbg（mmol/L）、静息心率 hr（bpm） */
const BODY_KEYS = ['weight', 'chest', 'waist', 'hip', 'arm', 'thigh', 'calf', 'bf',
                   'sbp', 'dbp', 'fbg', 'pbg', 'hr'];

/* 带 user_id 外键的子表(删自己子树用;顺序无关,写事务内完成) */
/* 睡眠子表 = sleep_sessions（多段）；删账户靠 FK CASCADE 级联清理
 * v4.11：workout_sets 已随运动项拍平被删除，不再出现在本表（DELETE 不存在的表会 500）
 * v4.20：user_slices 同样不在这里——整树写要**保留**切片版本表（见 replaceUser） */
const USER_DATA_TABLES = [
  'habit_done', 'habits', 'water_records', 'sleep_sessions', 'body_records',
  'workout_items', 'workouts',
  'meals', 'meal_days',
];

const nz = v => (v === undefined || v === null ? null : v);           // 写库：undefined → NULL
const jz = v => (v === undefined || v === null ? null : JSON.stringify(v));
const jsonParse = t => (t === null || t === undefined ? null : JSON.parse(t));
const put = (o, k, v) => { if (v !== null && v !== undefined) o[k] = v; }; // 读库：NULL → 键缺失
const asArray = v => (Array.isArray(v) ? v : []);
const asObject = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};

/* 客户端 PUT 的 data 需是"整树形状"(前端原样复用),但服务端只取本人那一份 */
function isValidUserState(s) {
  return !!s && typeof s === 'object'
    && s.users && typeof s.users === 'object' && !Array.isArray(s.users)
    && s.shared && typeof s.shared === 'object'
    && Array.isArray(s.shared.foods) && Array.isArray(s.shared.exercises);
}

/* 写入前的硬约束（数量级护栏）：返回错误码对象或 null。
 * 形状本身不在这里拒绝——normalizeSleepDay 清洗脏值；
 * 只有"一天几千段"这种灌库量级才显式 400（与系统库 LIB_MAX_ENTRIES 同一取向：
 * v4.3 审过一轮"静默截断会让客户端以为全存进去了"，所以宁可报错不静默丢）。
 * 只查本人那一份：树里其他用户的键服务端根本不写，不该让别人的脏数据堵死我的同步。 */
function validateUserData(data, uid) {
  const u = (data && data.users && data.users[uid]) || {};
  const sleep = u.sleep;
  if (sleep && typeof sleep === 'object' && !Array.isArray(sleep)) {
    for (const d of Object.keys(sleep)) {
      const v = sleep[d];
      if (Array.isArray(v) && v.length > SLEEP_MAX_SEGS) {
        return { error: 'sleep_too_many_segments', date: d, max: SLEEP_MAX_SEGS };
      }
    }
  }
  return null;
}

/* 单片值的类型契约（v4.20）：null/undefined = 删片，任何片都合法；其余按片类型收。
 * 类型不符显式 400：放进去只会写出一条读不回的形状（PUT≠GET 会让同步反复抖动）。
 * 形状细节（脏元素/多余键）不在这里拒——各写函数按老口径清洗。
 * 形状表来自 slices.js（唯一来源），返回值里一律带 `key`（客户端靠它把坏片挂起来跳过）。 */
function validateSliceValue(key, value) {
  const p = SLICES.parseSliceKey(key);
  if (!p) return { error: 'unknown_slice', key: key };
  if (value === null || value === undefined) return null;
  const t = SLICES.SLICE_VALUE_TYPE[p.kind];
  if (t === 'array' && !Array.isArray(value)) return { error: 'invalid_slice_value', key: key };
  if (t === 'object' && (typeof value !== 'object' || Array.isArray(value))) return { error: 'invalid_slice_value', key: key };
  if (t === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return { error: 'invalid_slice_value', key: key };
  if (p.kind === 'sleep' && value.length > SLEEP_MAX_SEGS) {
    return { error: 'sleep_too_many_segments', key: SLICES.sliceDayKey('sleep', p.date), date: p.date, max: SLEEP_MAX_SEGS };
  }
  return null;
}

function userRev(db, uid) {
  const row = db.prepare('SELECT rev FROM users WHERE id = ?').get(uid);
  return row ? row.rev : null;
}

/* ---------- 注册建档:一条 users 行 + 个人库初值(2026-09-12 起为空,不再拷系统库) ---------- */
function createUser(db, uid, info) {
  /* v4.3:去掉 seq——v4 起单账户单成员,该列从未被读写,已从新库 schema 移除(老库残留列走 DEFAULT) */
  db.prepare(`INSERT INTO users(id, name, avatar, color, activity, water_target,
              profile_json, goal_json, nutrition_json, rev, theme, onboarded,
              foods_json, exercises_json)
              VALUES (?,?,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,'light',0,?,?)`)
    .run(uid, nz(info && info.name),
      jz((info && info.library && info.library.foods) || []),
      jz((info && info.library && info.library.exercises) || []));
}

/* 老树里出现过的「逐日片」键（B1：整树写要替它们立墓碑）。
 * 只查承载日期的列，不做整树组装——整树写本来就重，这里必须是几条小查询。 */
function existingDaySliceKeys(db, uid) {
  const out = [];
  const add = (kind, rows) => rows.forEach(r => out.push(SLICES.sliceDayKey(kind, r.date)));
  add('meals', db.prepare('SELECT date FROM meal_days WHERE user_id = ? UNION SELECT date FROM meals WHERE user_id = ?').all(uid, uid));
  add('workouts', db.prepare('SELECT date FROM workouts WHERE user_id = ?').all(uid));
  add('sleep', db.prepare('SELECT DISTINCT date FROM sleep_sessions WHERE user_id = ?').all(uid));
  add('water', db.prepare('SELECT date FROM water_records WHERE user_id = ?').all(uid));
  add('habitdone', db.prepare('SELECT DISTINCT date FROM habit_done WHERE user_id = ?').all(uid));
  return out;
}

/* ---------- 写入:只替换本人子树 ---------- */
function deleteUserData(db, uid) {
  for (const t of USER_DATA_TABLES) db.prepare('DELETE FROM ' + t + ' WHERE user_id = ?').run(uid);
}

/* expectedRev:undefined/null = 盲写(离线回线首推场景);带值且过期 → rev_conflict */
function replaceUser(db, uid, data, expectedRev) {
  const cur = userRev(db, uid);
  if (cur === null) return { ok: false, error: 'no_user' };
  /* 树里必须携带本人那一份——防止客户端 id 错位时把空对象当"本人数据"清空子树 */
  if (!data.users || !Object.prototype.hasOwnProperty.call(data.users, uid)) {
    return { ok: false, error: 'no_self' };
  }
  if (expectedRev !== undefined && expectedRev !== null && expectedRev !== cur) {
    return { ok: false, error: 'rev_conflict', rev: cur };
  }
  const u = (data.users && data.users[uid]) || {};
  const shared = data.shared || {};
  const nextRev = cur + 1;
  /* 全表清空-重灌在本用户范围内进行;关闭外键避免删除顺序问题(事务内完成,失败即回滚) */
  /* v4.3：FK 恢复改放 finally——旧写法 BEGIN IMMEDIATE 本身抛错(写锁被占/IO 故障)时
   * 逃过 catch,共享连接的外键约束永久留在 OFF 状态,管理员删账户的级联清理随之失效。 */
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      /* B1：先取「旧树里出现过的逐日片」——必须在 deleteUserData 之前。
       * sliceManifest 只覆盖「用户切片表已有行」的片，而 v4.20 之前的老账户这张表是空的：
       * 老客户端整树删掉的那一天，在新树里没有、在表里也没有 → 没墓碑 → 按片客户端永远不知道
       * 这天被删了，之后还会以 rev 0 通过 CAS 把它复活回来。 */
      const oldDayKeys = existingDaySliceKeys(db, uid);
      deleteUserData(db, uid);
      /* users 行也走逐片写函数（writeProfile/writeLib）——整树路径与切片路径复用同一份列映射，
       * 不许各抄一份（AGENTS.md「规则只写一份」；抄两份必然漂移）。rev 单独更新。 */
      writeProfile(db, uid, {
        name: u.name, avatar: u.avatar, color: u.color, activity: u.activity, waterTarget: u.waterTarget,
        profile: u.profile, goal: u.goal, nutrition: u.nutrition,
        theme: data.theme, onboarded: data.onboarded,
        /* jz 而非 || []：键缺失与空数组必须分别保真（readProfile 侧用 put 对称还原） */
        homeOrder: u.homeOrder,
        /* 身体页隐藏项：同上（空数组 = 全部显示，与键缺失同义但形状各自保真） */
        bodyHidden: u.bodyHidden,
        /* 历史页图表卡拖动顺序：同 homeOrder */
        chartOrder: u.chartOrder,
      });
      writeLib(db, uid, shared);
      db.prepare('UPDATE users SET rev = ? WHERE id = ?').run(nextRev, uid);
      insertUserData(db, uid, u);
      /* 整树写：把「此前已知的全部片 + 新树里出现的片」一律抬到新全局 rev——
       * 让按片同步的客户端一定看得见这次变动（含「这片已经没了」：已删片必须保留行才抬得动） */
      const sliceKeys = Object.keys(sliceManifest(db, uid)).concat(oldDayKeys)
        .concat(SLICES.sliceKeysOf({ theme: data.theme, onboarded: data.onboarded, shared: shared,
          users: { [uid]: u }, active: uid }));
      setSliceRevs(db, uid, Array.from(new Set(sliceKeys)), nextRev);
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (e2) { /* 回滚失败不掩盖原始错误 */ }
      throw e;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
  return { ok: true, rev: nextRev };
}

/* =====================================================
   逐片 SQL 读写（v4.20）
   整树路径（insertUserData / readUserData）与切片路径（writeSliceValue / readSlice）
   **共用**下面这些小函数：两份各写一遍必然漂移（本项目在 seed-data、MUSCLES、
   睡眠形状上都踩过），共用才能保证「整树 PUT 的结果」＝「逐片 PUT 拼起来的结果」。
   ===================================================== */

/* ---------- 饮食：一天 = meal_days 标记（四槽全空也要能还原）+ meals 四槽条目 ---------- */
function deleteMealDay(db, uid, date) {
  db.prepare('DELETE FROM meals WHERE user_id = ? AND date = ?').run(uid, date);
  db.prepare('DELETE FROM meal_days WHERE user_id = ? AND date = ?').run(uid, date);
}
function writeMealDay(db, uid, date, dm) {
  deleteMealDay(db, uid, date);
  db.prepare('INSERT INTO meal_days(user_id, date) VALUES (?,?)').run(uid, date);
  const ins = db.prepare(`INSERT INTO meals(user_id, date, slot, seq, item_id, name,
                          kcal, p, c, f, g) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const o = asObject(dm);
  SLOTS.forEach(slot => {
    const arr = Array.isArray(o[slot]) ? o[slot] : [];
    arr.forEach((it, i) => {
      const per = (it && it.per100) || {};
      ins.run(uid, date, slot, i, nz(it && it.id), nz(it && it.name),
        nz(per.kcal), nz(per.p), nz(per.c), nz(per.f), nz(it && it.g));
    });
  });
}
function mealDayExists(db, uid, date) {
  return !!(db.prepare('SELECT 1 FROM meal_days WHERE user_id = ? AND date = ?').get(uid, date)
    || db.prepare('SELECT 1 FROM meals WHERE user_id = ? AND date = ? LIMIT 1').get(uid, date));
}
function readMealDay(db, uid, date) {
  const o = { breakfast: [], lunch: [], dinner: [], snack: [] };
  for (const r of db.prepare('SELECT * FROM meals WHERE user_id = ? AND date = ? ORDER BY slot, seq').all(uid, date)) {
    const per = {};
    put(per, 'kcal', r.kcal); put(per, 'p', r.p); put(per, 'c', r.c); put(per, 'f', r.f);
    const it = {};
    put(it, 'id', r.item_id); put(it, 'name', r.name);
    if (Object.keys(per).length) it.per100 = per;
    put(it, 'g', r.g);
    if (Array.isArray(o[r.slot])) o[r.slot].push(it);
  }
  return o;
}

/* ---------- 运动：一天一条（date 即身份），项在 workout_items ---------- */
/* seq 只用于保数组顺序：整树路径传数组下标；切片路径沿用旧 seq，新日期取 MAX+1（= 追加） */
function workoutSeq(db, uid, date) {
  const row = db.prepare('SELECT seq FROM workouts WHERE user_id = ? AND date = ?').get(uid, date);
  if (row) return row.seq;
  const mx = db.prepare('SELECT MAX(seq) AS m FROM workouts WHERE user_id = ?').get(uid);
  return (mx && mx.m !== null && mx.m !== undefined) ? mx.m + 1 : 0;
}
function deleteWorkoutDay(db, uid, date) {
  db.prepare('DELETE FROM workout_items WHERE user_id = ? AND date = ?').run(uid, date);
  db.prepare('DELETE FROM workouts WHERE user_id = ? AND date = ?').run(uid, date);
}
function writeWorkoutDay(db, uid, date, w0, seqOpt) {
  const w = asObject(w0);
  const seq = (seqOpt === undefined || seqOpt === null) ? workoutSeq(db, uid, date) : seqOpt;
  deleteWorkoutDay(db, uid, date);
  db.prepare('INSERT INTO workouts(user_id, date, seq, day_id, name) VALUES (?,?,?,?,?)')
    .run(uid, date, seq, nz(w.id), nz(w.name));
  const ins = db.prepare(`INSERT INTO workout_items(user_id, date, seq, item_id, ex_id,
                          ex_name, cat, muscle, reps, weight, mins, km, done)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  asArray(w.items).forEach((it, j) => ins.run(uid, date, j, nz(it && it.id), nz(it && it.exId),
    nz(it && it.exName), nz(it && it.cat), nz(it && it.muscle), nz(it && it.reps), nz(it && it.weight),
    nz(it && it.mins), nz(it && it.km), it && it.done ? 1 : 0));
}
function readWorkoutDay(db, uid, date) {
  const w = db.prepare('SELECT * FROM workouts WHERE user_id = ? AND date = ?').get(uid, date);
  if (!w) return undefined;
  const o = {};
  put(o, 'id', w.day_id); put(o, 'date', w.date); put(o, 'name', w.name);
  o.items = db.prepare('SELECT * FROM workout_items WHERE user_id = ? AND date = ? ORDER BY seq').all(uid, date).map(r => {
    const it = {};
    put(it, 'id', r.item_id); put(it, 'exId', r.ex_id); put(it, 'exName', r.ex_name);
    put(it, 'cat', r.cat); put(it, 'muscle', r.muscle);
    put(it, 'reps', r.reps); put(it, 'weight', r.weight); put(it, 'mins', r.mins); put(it, 'km', r.km);
    if (r.done) it.done = true;
    return it;
  });
  return o;
}

/* ---------- 身体：date 非键（同日多条合法），seq 是位置语义 → 整块读写，不拆日 ---------- */
function writeBody(db, uid, arr) {
  db.prepare('DELETE FROM body_records WHERE user_id = ?').run(uid);
  const ins = db.prepare(`INSERT INTO body_records(user_id, seq, date, ${BODY_KEYS.join(', ')})
                          VALUES (?,?,?,${BODY_KEYS.map(() => '?').join(',')})`);
  asArray(arr).forEach((r0, i) => {
    const r = asObject(r0);   // 脏元素（null/标量）降级成空行，不抛 TypeError
    ins.run(uid, i, nz(r.date) || '', ...BODY_KEYS.map(k => nz(r[k])));
  });
}
function readBody(db, uid) {
  return db.prepare('SELECT * FROM body_records WHERE user_id = ? ORDER BY seq').all(uid).map(r => {
    const o = { date: r.date };
    BODY_KEYS.forEach(k => put(o, k, r[k]));
    return o;
  });
}

/* ---------- 睡眠：一天多段。形状裁决收在 sleep-shape.normalizeSleepDay（前端同一份） ---------- */
function deleteSleepDay(db, uid, date) {
  db.prepare('DELETE FROM sleep_sessions WHERE user_id = ? AND date = ?').run(uid, date);
}
function writeSleepDay(db, uid, date, v) {
  deleteSleepDay(db, uid, date);
  const ins = db.prepare('INSERT INTO sleep_sessions(user_id, date, seq, t, bed, wake, mins, quality) VALUES (?,?,?,?,?,?,?,?)');
  (normalizeSleepDay(v) || []).forEach((s, i) => ins.run(uid, date, i, nz(s.t), nz(s.bed), nz(s.wake), nz(s.mins), nz(s.quality)));
}
function readSleepDay(db, uid, date) {
  const rows = db.prepare('SELECT * FROM sleep_sessions WHERE user_id = ? AND date = ? ORDER BY seq').all(uid, date);
  if (!rows.length) return undefined;
  return rows.map(r => {
    const s = {};
    put(s, 't', r.t); put(s, 'bed', r.bed); put(s, 'wake', r.wake); put(s, 'mins', r.mins); put(s, 'quality', r.quality);
    return s;
  });
}

/* ---------- 饮水：一天一个杯数 ---------- */
function deleteWaterDay(db, uid, date) {
  db.prepare('DELETE FROM water_records WHERE user_id = ? AND date = ?').run(uid, date);
}
function writeWaterDay(db, uid, date, cups) {
  deleteWaterDay(db, uid, date);
  db.prepare('INSERT INTO water_records(user_id, date, cups) VALUES (?,?,?)').run(uid, date, nz(cups));
}
function readWaterDay(db, uid, date) {
  const r = db.prepare('SELECT cups FROM water_records WHERE user_id = ? AND date = ?').get(uid, date);
  return r ? r.cups : undefined;
}

/* ---------- 习惯：定义（habits）与逐日打卡（habit_done）是两片 ---------- */
function habitIdsOf(list) {
  return asArray(list).map((h, i) => nz(h && h.id) || ('h_seq_' + i));
}
function readHabits(db, uid) {
  return db.prepare('SELECT * FROM habits WHERE user_id = ? ORDER BY seq').all(uid).map(h => {
    const o = {};
    put(o, 'id', h.habit_id); put(o, 'name', h.name); put(o, 'icon', h.icon); put(o, 'color', h.color);
    return o;
  });
}
function writeHabits(db, uid, arr) {
  const list = asArray(arr);
  const ids = habitIdsOf(list);
  db.prepare('DELETE FROM habits WHERE user_id = ?').run(uid);
  /* 孤儿打卡清理：只删「定义里已经没有的习惯」的打卡，**绝不整表清**——
   * 定义与打卡是两个片，改个习惯名不该顺手抹掉全部打卡记录（按片同步下那就是静默丢数据） */
  if (ids.length) {
    db.prepare('DELETE FROM habit_done WHERE user_id = ? AND habit_id NOT IN (' + ids.map(() => '?').join(',') + ')')
      .run(uid, ...ids);
  } else {
    db.prepare('DELETE FROM habit_done WHERE user_id = ?').run(uid);
  }
  const ins = db.prepare('INSERT INTO habits(user_id, habit_id, seq, name, icon, color) VALUES (?,?,?,?,?,?)');
  list.forEach((h0, i) => {
    const h = asObject(h0);
    ins.run(uid, ids[i], i, nz(h.name), nz(h.icon), nz(h.color));
  });
}
function deleteHabitDoneDay(db, uid, date) {
  db.prepare('DELETE FROM habit_done WHERE user_id = ? AND date = ?').run(uid, date);
}
function insertHabitDoneRow(db, uid, habitId, date) {
  db.prepare('INSERT OR REPLACE INTO habit_done(user_id, habit_id, date) VALUES (?,?,?)').run(uid, habitId, date);
}
function writeHabitDoneDay(db, uid, date, map) {
  deleteHabitDoneDay(db, uid, date);
  const o = asObject(map);
  Object.keys(o).forEach(hid => { if (o[hid]) insertHabitDoneRow(db, uid, hid, date); });
}
/* 只回「已定义习惯」的打卡——与整树读 readUserData 同一口径（两路读出必须同形状）。
 * 未定义习惯的孤儿行只是「定义还没到」时的暂存：定义一到就自然可见，不会丢，也不会在两路之间读出两个值。
 * 写入侧（writeHabitDoneDay）故意不过滤：客户端可能先推打卡、定义随后才到。 */
function readHabitDoneDay(db, uid, date) {
  const rows = db.prepare(`SELECT d.habit_id AS habit_id FROM habit_done d
                           WHERE d.user_id = ? AND d.date = ?
                             AND EXISTS (SELECT 1 FROM habits h
                                         WHERE h.user_id = d.user_id AND h.habit_id = d.habit_id)
                           ORDER BY d.habit_id`).all(uid, date);
  if (!rows.length) return undefined;
  const o = {};
  rows.forEach(r => { o[r.habit_id] = true; });   /* 按 habit_id 排序，与前端 slices.js 的规范序一致 */
  return o;
}

/* ---------- 账户片：profile（users 行全部列，一条 UPDATE）与 lib（个人库两份 JSON） ---------- */
function writeProfile(db, uid, v) {
  const o = asObject(v);
  db.prepare(`UPDATE users SET name = ?, avatar = ?, color = ?, activity = ?, water_target = ?,
              profile_json = ?, goal_json = ?, nutrition_json = ?, theme = ?, onboarded = ?,
              home_order_json = ?, body_hidden_json = ?, chart_order_json = ? WHERE id = ?`)
    .run(nz(o.name), nz(o.avatar), nz(o.color), nz(o.activity), nz(o.waterTarget),
      jz(o.profile), jz(o.goal), jz(o.nutrition),
      nz(o.theme) || 'light', o.onboarded ? 1 : 0,
      jz(o.homeOrder), jz(o.bodyHidden), jz(o.chartOrder), uid);
}
function readProfile(db, uid) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!row) return undefined;
  const v = { theme: row.theme || 'light', onboarded: !!row.onboarded };
  put(v, 'name', row.name); put(v, 'avatar', row.avatar); put(v, 'color', row.color);
  put(v, 'activity', row.activity); put(v, 'waterTarget', row.water_target);
  put(v, 'profile', jsonParse(row.profile_json));
  put(v, 'goal', jsonParse(row.goal_json));
  put(v, 'nutrition', jsonParse(row.nutrition_json));
  put(v, 'homeOrder', jsonParse(row.home_order_json));
  put(v, 'bodyHidden', jsonParse(row.body_hidden_json));
  put(v, 'chartOrder', jsonParse(row.chart_order_json));
  return v;
}
function writeLib(db, uid, v) {
  const o = asObject(v);
  db.prepare('UPDATE users SET foods_json = ?, exercises_json = ? WHERE id = ?')
    .run(jz(asArray(o.foods)), jz(asArray(o.exercises)), uid);
}
function readLib(db, uid) {
  const row = db.prepare('SELECT foods_json, exercises_json FROM users WHERE id = ?').get(uid);
  if (!row) return undefined;
  return { foods: jsonParse(row.foods_json) || [], exercises: jsonParse(row.exercises_json) || [] };
}

/* 除 users 行外的全部子记录（整树路径；与旧版 insertUser 的子表部分逐字段一致，保往返形状） */
function insertUserData(db, uid, u) {
  /* 饮食：meal_days 标记存在的日期；四餐次固定枚举，未知键忽略（应用不会产生） */
  const meals = u.meals || {};
  Object.keys(meals).forEach(date => writeMealDay(db, uid, date, meals[date]));

  /* 运动安排（v4.12：计划与记录合并为一条）：一天一条，date 即身份；项与 v4.11 同形。
   * v4.12：done 在每一项上（1 = 已打勾），当天任一项打勾即视为该日已运动。
   * 缺 date 的条目无法定位到"哪一天"，同日重复又与主键冲突 —— 两者防御性跳过（客户端
   * normalizeWorkoutDays 做同一套清洗，两侧必须一致，否则 PUT≠GET 会让同步反复抖动）。 */
  const seen = new Set();
  asArray(u.workouts).forEach((w0, i) => {
    const w = asObject(w0);   // 脏元素降级成空行，让它走"缺 date → 跳过"
    const date = nz(w.date);
    if (date === null || seen.has(date)) return;
    seen.add(date);
    writeWorkoutDay(db, uid, date, w, i);   /* seq = 数组下标（保客户端数组顺序） */
  });

  /* 身体数据：date 非键（同日多条合法），指标可缺省 */
  writeBody(db, uid, u.body);

  /* 睡眠：一天多段；饮水的日期键原样落库 */
  const sleep = u.sleep || {};
  Object.keys(sleep).forEach(date => writeSleepDay(db, uid, date, sleep[date]));
  const water = u.water || {};
  Object.keys(water).forEach(date => writeWaterDay(db, uid, date, water[date]));

  /* 习惯：先落定义（顺带清孤儿打卡），再逐日写打卡（done 只存有记录的日期） */
  const habits = asArray(u.habits);
  writeHabits(db, uid, habits);
  const defIds = habitIdsOf(habits);
  habits.forEach((h0, i) => {
    const done = asObject(asObject(h0).done);
    Object.keys(done).forEach(date => { if (done[date]) insertHabitDoneRow(db, uid, defIds[i], date); });
  });
}

/* ---------- 读出:单人数树(前端 USERS 容器天然只含自己一位成员) ---------- */
function composeUser(db, uid) {
  const row = db.prepare('SELECT rev FROM users WHERE id = ?').get(uid);
  if (!row) return { rev: 0, data: null };
  /* users 行的列映射同样复用逐片读函数（readProfile/readLib），与整树写一一对称 */
  const prof = readProfile(db, uid) || {};
  const lib = readLib(db, uid) || { foods: [], exercises: [] };

  const u = { id: uid };
  ['name', 'avatar', 'color', 'activity', 'waterTarget', 'profile', 'goal', 'nutrition',
   'homeOrder', 'bodyHidden', 'chartOrder'].forEach(k => put(u, k, prof[k]));
  Object.assign(u, readUserData(db, uid));

  const data = {
    theme: prof.theme || 'light',
    onboarded: !!prof.onboarded,
    shared: { foods: lib.foods, exercises: lib.exercises },
    users: { [uid]: u },
    active: uid,
  };
  return { rev: row.rev, data };
}

function readUserData(db, uid) {
  /* 饮食 */
  const meals = {};
  for (const r of db.prepare(`SELECT date FROM meal_days WHERE user_id = ?
                              UNION SELECT date FROM meals WHERE user_id = ? ORDER BY date`).all(uid, uid)) {
    meals[r.date] = readMealDay(db, uid, r.date);
  }

  /* 运动安排（v4.12：计划与记录同一条，done 在每一项上） */
  const workouts = db.prepare('SELECT date FROM workouts WHERE user_id = ? ORDER BY seq').all(uid)
    .map(r => readWorkoutDay(db, uid, r.date));

  /* 身体 / 睡眠（多段数组，date+seq 保序） / 饮水 */
  const body = readBody(db, uid);
  const sleep = {};
  for (const r of db.prepare('SELECT DISTINCT date FROM sleep_sessions WHERE user_id = ? ORDER BY date').all(uid)) {
    sleep[r.date] = readSleepDay(db, uid, r.date);
  }
  const water = {};
  for (const r of db.prepare('SELECT date FROM water_records WHERE user_id = ? ORDER BY date').all(uid)) {
    water[r.date] = readWaterDay(db, uid, r.date);
  }

  /* 习惯：定义 + 打卡（打卡一次性取全再按 id 分组，习惯数很少） */
  const habits = readHabits(db, uid);
  const doneBy = {};
  for (const r of db.prepare('SELECT habit_id, date FROM habit_done WHERE user_id = ?').all(uid)) {
    (doneBy[r.habit_id] = doneBy[r.habit_id] || {})[r.date] = true;
  }
  habits.forEach(h => { h.done = doneBy[h.id] || {}; });

  return { meals, workouts, body, habits, sleep, water };
}

/* =====================================================
   切片 API 落库层（v4.20）
   rev 语义：`user_slices.rev` = 该片最后一次改动时的**全局 users.rev**（单调，不做独立计数器）。
   读片返回 undefined = 该片不存在；写片 value 为 null/undefined = 删片。
   ===================================================== */
function sliceRev(db, uid, key) {
  const r = db.prepare('SELECT rev FROM user_slices WHERE user_id = ? AND slice = ?').get(uid, key);
  return r ? r.rev : 0;
}
function sliceManifest(db, uid) {
  const out = {};
  for (const r of db.prepare('SELECT slice, rev FROM user_slices WHERE user_id = ?').all(uid)) out[r.slice] = r.rev;
  return out;
}
/* 片版本一律抬到 rev；**已删片也保留行**（缺行 = 0，会让客户端判不出「服务器删了这片」） */
function setSliceRevs(db, uid, keys, rev) {
  const up = db.prepare('INSERT OR REPLACE INTO user_slices(user_id, slice, rev) VALUES (?,?,?)');
  for (const k of keys) up.run(uid, k, rev);
}
function readSlice(db, uid, key) {
  const p = SLICES.parseSliceKey(key);
  if (!p) return undefined;
  switch (p.kind) {
    case 'profile': return readProfile(db, uid);
    case 'lib': return readLib(db, uid);
    case 'body': return readBody(db, uid);
    case 'habits': return readHabits(db, uid);
    case 'meals': return mealDayExists(db, uid, p.date) ? readMealDay(db, uid, p.date) : undefined;
    case 'workouts': return readWorkoutDay(db, uid, p.date);
    case 'sleep': return readSleepDay(db, uid, p.date);
    case 'water': return readWaterDay(db, uid, p.date);
    case 'habitdone': return readHabitDoneDay(db, uid, p.date);
  }
  return undefined;
}
function writeSliceValue(db, uid, key, value) {
  const p = SLICES.parseSliceKey(key);
  if (!p) return false;
  const del = value === undefined || value === null;
  switch (p.kind) {
    case 'profile': writeProfile(db, uid, del ? {} : value); return true;   /* profile 片恒在场：清空即整列置空 */
    case 'lib': writeLib(db, uid, del ? {} : value); return true;
    case 'body': writeBody(db, uid, del ? [] : value); return true;
    case 'habits': writeHabits(db, uid, del ? [] : value); return true;
    case 'meals': if (del) deleteMealDay(db, uid, p.date); else writeMealDay(db, uid, p.date, value); return true;
    case 'workouts': if (del) deleteWorkoutDay(db, uid, p.date); else writeWorkoutDay(db, uid, p.date, value); return true;
    case 'sleep': if (del) deleteSleepDay(db, uid, p.date); else writeSleepDay(db, uid, p.date, value); return true;
    case 'water': if (del) deleteWaterDay(db, uid, p.date); else writeWaterDay(db, uid, p.date, value); return true;
    case 'habitdone': if (del) deleteHabitDoneDay(db, uid, p.date); else writeHabitDoneDay(db, uid, p.date, value); return true;
  }
  return false;
}

/* 批量写片（客户端一次编辑可能脏多片：batched，整批原子）。
 * entries: [{key, value, rev}]，rev 缺省/null = 盲写（离线回线首推 / 用户明确选择覆盖）。
 * CAS 先全检：任一片版本对不上就**一片都不写**，把冲突片当前的值一并带回去（客户端据此裁决，
 * 不必再发一次 GET）。 */
function writeSlices(db, uid, entries) {
  const cur = userRev(db, uid);
  if (cur === null) return { ok: false, error: 'no_user' };
  const conflicts = {};
  for (const e of entries) {
    if (e.rev === undefined || e.rev === null) continue;
    const r = sliceRev(db, uid, e.key);
    if (r !== e.rev) {
      const v = readSlice(db, uid, e.key);
      conflicts[e.key] = { rev: r, value: v === undefined ? null : v };
    }
  }
  if (Object.keys(conflicts).length) {
    return { ok: false, error: 'rev_conflict', rev: cur, conflicts: conflicts };
  }
  const nextRev = cur + 1;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET rev = ? WHERE id = ?').run(nextRev, uid);
    for (const e of entries) {
      /* 校验放行、写函数却没落地 = 静默丢数据（还会抬 rev 让别端以为存好了）：
       * 漏把新 kind 接进 writeSliceValue 的 switch 时，这里必须炸出来而不是悄悄回 200 */
      if (!writeSliceValue(db, uid, e.key, e.value)) throw new Error('unhandled slice kind: ' + e.key);
    }
    setSliceRevs(db, uid, entries.map(e => e.key), nextRev);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (e2) { /* 回滚失败不掩盖原始错误 */ }
    throw err;
  }
  const slices = {};
  entries.forEach(e => { slices[e.key] = nextRev; });
  return { ok: true, rev: nextRev, slices: slices };
}

module.exports = {
  isValidUserState, validateUserData, validateSliceValue, isValidSliceKey: SLICES.isValidSliceKey,
  userRev, createUser, replaceUser, composeUser,
  sliceRev, sliceManifest, setSliceRevs, readSlice, writeSliceValue, writeSlices,
};
