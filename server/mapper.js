'use strict';
/* =====================================================
   单用户 状态树 ⇄ 关系表 双向转换(v4 账户隔离版)
   核心不变量:replaceUser(db, uid, X) 之后 composeUser(db, uid).data
   必须与 X 的本人数树深度相等(数组顺序、键"存在/缺失"都保真)。
   每用户独立 rev;个人食物/动作库整存 users.foods_json/exercises_json。
   老版本的全库替换(split/clearAll/compose)已删除——那正是
   "多人同时写互相覆盖"的根因,写路径只允许触碰自己那一份。
   ===================================================== */

/* 睡眠形状契约与前端共用同一份实现：normalizeSleepDay 负责脏元素/脏字段丢弃，
 * 见 public/js/sleep-shape.js 文件头 */
const { normalizeSleepDay, SLEEP_MAX_SEGS } = require('../public/js/sleep-shape.js');

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const BODY_KEYS = ['weight', 'chest', 'waist', 'hip', 'arm', 'thigh', 'bf'];

/* 带 user_id 外键的子表(删自己子树用;顺序无关,写事务内完成) */
/* 睡眠子表 = sleep_sessions（多段）；删账户靠 FK CASCADE 级联清理
 * v4.11：workout_sets 已随运动项拍平被删除，不再出现在本表（DELETE 不存在的表会 500） */
const USER_DATA_TABLES = [
  'habit_done', 'habits', 'water_records', 'sleep_sessions', 'body_records',
  'workout_items', 'workouts', 'plan_items', 'plan_defs',
  'meals', 'meal_days',
];

const nz = v => (v === undefined || v === null ? null : v);           // 写库：undefined → NULL
const jz = v => (v === undefined || v === null ? null : JSON.stringify(v));
const jsonParse = t => (t === null || t === undefined ? null : JSON.parse(t));
const put = (o, k, v) => { if (v !== null && v !== undefined) o[k] = v; }; // 读库：NULL → 键缺失

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

function userRev(db, uid) {
  const row = db.prepare('SELECT rev FROM users WHERE id = ?').get(uid);
  return row ? row.rev : null;
}

/* ---------- 注册建档:一条 users 行 + 个人库初值(系统库拷贝) ---------- */
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
      deleteUserData(db, uid);
      db.prepare(`UPDATE users SET name = ?, avatar = ?, color = ?, activity = ?, water_target = ?,
                  profile_json = ?, goal_json = ?, nutrition_json = ?, theme = ?, onboarded = ?,
                  foods_json = ?, exercises_json = ?, rev = ? WHERE id = ?`)
        .run(nz(u.name), nz(u.avatar), nz(u.color), nz(u.activity), nz(u.waterTarget),
          jz(u.profile), jz(u.goal), jz(u.nutrition),
          nz(data.theme) || 'light', data.onboarded ? 1 : 0,
          jz(shared.foods || []), jz(shared.exercises || []),
          nextRev, uid);
      insertUserData(db, uid, u);
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

/* 除 users 行外的全部子记录(与旧版 insertUser 的子表部分逐字段一致,保往返形状) */
function insertUserData(db, uid, u) {
  /* 饮食：meal_days 标记存在的日期；四餐次固定枚举，未知键忽略（应用不会产生） */
  const dayIns = db.prepare('INSERT INTO meal_days(user_id, date) VALUES (?,?)');
  const mealIns = db.prepare(`INSERT INTO meals(user_id, date, slot, seq, item_id, name,
                              kcal, p, c, f, g) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const meals = u.meals || {};
  Object.keys(meals).forEach(date => {
    dayIns.run(uid, date);
    const dm = meals[date] || {};
    SLOTS.forEach(slot => {
      const arr = Array.isArray(dm[slot]) ? dm[slot] : [];
      arr.forEach((it, i) => {
        const per = (it && it.per100) || {};
        mealIns.run(uid, date, slot, i, nz(it && it.id), nz(it && it.name),
          nz(per.kcal), nz(per.p), nz(per.c), nz(per.f), nz(it && it.g));
      });
    });
  });

  /* 周计划：键是 "0".."6"；项与日志项同形（力量 reps/weight，计时 mins/km，均可缺） */
  const pdefIns = db.prepare('INSERT INTO plan_defs(user_id, weekday, plan_id, name) VALUES (?,?,?,?)');
  const pitemIns = db.prepare(`INSERT INTO plan_items(user_id, weekday, seq, item_id, ex_id,
                               ex_name, cat, muscle, reps, weight, mins, km) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const plans = u.plans || {};
  Object.keys(plans).forEach(key => {
    if (!/^[0-6]$/.test(key)) return;
    const wd = Number(key);
    const p = plans[key] || {};
    pdefIns.run(uid, wd, nz(p.id), nz(p.name));
    const items = Array.isArray(p.items) ? p.items : [];
    items.forEach((it, i) => pitemIns.run(uid, wd, i, nz(it.id), nz(it.exId), nz(it.exName),
      nz(it.cat), nz(it.muscle), nz(it.reps), nz(it.weight), nz(it.mins), nz(it.km)));
  });

  /* 运动日志：workouts → items（v4.11 一次记录 = 一条汇总，没有逐组子表） */
  const wIns = db.prepare('INSERT INTO workouts(user_id, workout_id, seq, date, name, note) VALUES (?,?,?,?,?,?)');
  const wiIns = db.prepare(`INSERT INTO workout_items(user_id, workout_id, seq, item_id, ex_id,
                            ex_name, cat, muscle, reps, weight, mins, km) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const workouts = Array.isArray(u.workouts) ? u.workouts : [];
  workouts.forEach((w, i) => {
    const wid = nz(w.id) || ('wk_seq_' + i); // 缺 id 时用序号兜底，避免主键为 NULL
    wIns.run(uid, wid, i, nz(w.date), nz(w.name), nz(w.note));
    const items = Array.isArray(w.items) ? w.items : [];
    items.forEach((it, j) => wiIns.run(uid, wid, j, nz(it.id), nz(it.exId), nz(it.exName),
      nz(it.cat), nz(it.muscle), nz(it.reps), nz(it.weight), nz(it.mins), nz(it.km)));
  });

  /* 身体数据：date 非键（同日多条合法），指标可缺省 */
  const bIns = db.prepare(`INSERT INTO body_records(user_id, seq, date, weight, chest, waist,
                           hip, arm, thigh, bf) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const body = Array.isArray(u.body) ? u.body : [];
  body.forEach((r0, i) => {
    const r = (r0 && typeof r0 === 'object') ? r0 : {};   // 脏元素（null/标量）降级成空行，不抛 TypeError
    const vals = BODY_KEYS.map(k => nz(r[k]));
    bIns.run(uid, i, nz(r.date) || '', ...vals);
  });

  /* 睡眠：一天多段。形状裁决收在 sleep-shape.normalizeSleepDay（前端同一份）——
   * [null] / 标量 / 全空段 / 空数组 → 相应丢弃，脏值不会再把 INSERT 打成 500。
   * seq = 清洗后的下标，保证 GET 回来的数组与 PUT 的规范形状逐元素对齐。 */
  const sIns = db.prepare('INSERT INTO sleep_sessions(user_id, date, seq, t, bed, wake, mins, quality) VALUES (?,?,?,?,?,?,?,?)');
  const sleep = u.sleep || {};
  Object.keys(sleep).forEach(date => {
    const segs = normalizeSleepDay(sleep[date]) || [];
    segs.forEach((s, i) => sIns.run(uid, date, i, nz(s.t), nz(s.bed), nz(s.wake), nz(s.mins), nz(s.quality)));
  });

  const wtrIns = db.prepare('INSERT INTO water_records(user_id, date, cups) VALUES (?,?,?)');
  const water = u.water || {};
  Object.keys(water).forEach(date => wtrIns.run(uid, date, nz(water[date])));

  /* 习惯：done 只存有记录的日期（应用从不写 done:false） */
  const hIns = db.prepare('INSERT INTO habits(user_id, habit_id, seq, name, icon, color) VALUES (?,?,?,?,?,?)');
  const hdIns = db.prepare('INSERT INTO habit_done(user_id, habit_id, date) VALUES (?,?,?)');
  const habits = Array.isArray(u.habits) ? u.habits : [];
  habits.forEach((h0, i) => {
    const h = (h0 && typeof h0 === 'object') ? h0 : {};   // 同上：脏元素不抛错
    const hid = nz(h.id) || ('h_seq_' + i);
    hIns.run(uid, hid, i, nz(h.name), nz(h.icon), nz(h.color));
    const done = (h.done && typeof h.done === 'object') ? h.done : {};
    Object.keys(done).forEach(d => { if (done[d]) hdIns.run(uid, hid, d); });
  });
}

/* ---------- 读出:单人数树(前端 USERS 容器天然只含自己一位成员) ---------- */
function composeUser(db, uid) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!row) return { rev: 0, data: null };

  const shared = {
    foods: jsonParse(row.foods_json) || [],
    exercises: jsonParse(row.exercises_json) || [],
  };

  const u = { id: row.id };
  put(u, 'name', row.name); put(u, 'avatar', row.avatar); put(u, 'color', row.color);
  put(u, 'activity', row.activity); put(u, 'waterTarget', row.water_target);
  put(u, 'profile', jsonParse(row.profile_json));
  put(u, 'goal', jsonParse(row.goal_json));
  put(u, 'nutrition', jsonParse(row.nutrition_json));
  Object.assign(u, readUserData(db, uid));

  const data = {
    theme: row.theme || 'light',
    onboarded: !!row.onboarded,
    shared,
    users: { [uid]: u },
    active: uid,
  };
  return { rev: row.rev, data };
}

function readUserData(db, uid) {
  /* 饮食 */
  const meals = {};
  for (const d of db.prepare('SELECT date FROM meal_days WHERE user_id = ?').all(uid)) {
    meals[d.date] = { breakfast: [], lunch: [], dinner: [], snack: [] };
  }
  for (const r of db.prepare('SELECT * FROM meals WHERE user_id = ? ORDER BY date, slot, seq').all(uid)) {
    if (!meals[r.date]) meals[r.date] = { breakfast: [], lunch: [], dinner: [], snack: [] };
    const per = {};
    put(per, 'kcal', r.kcal); put(per, 'p', r.p); put(per, 'c', r.c); put(per, 'f', r.f);
    const it = {};
    put(it, 'id', r.item_id); put(it, 'name', r.name);
    if (Object.keys(per).length) it.per100 = per;
    put(it, 'g', r.g);
    if (Array.isArray(meals[r.date][r.slot])) meals[r.date][r.slot].push(it);
  }

  /* 周计划 */
  const plans = {};
  const planItems = db.prepare('SELECT * FROM plan_items WHERE user_id = ? ORDER BY weekday, seq').all(uid);
  for (const d of db.prepare('SELECT * FROM plan_defs WHERE user_id = ? ORDER BY weekday').all(uid)) {
    const p = {};
    put(p, 'id', d.plan_id); put(p, 'name', d.name);
    p.items = planItems.filter(r => r.weekday === d.weekday).map(r => {
      const it = {};
      put(it, 'id', r.item_id); put(it, 'exId', r.ex_id); put(it, 'exName', r.ex_name);
      put(it, 'cat', r.cat); put(it, 'muscle', r.muscle);
      put(it, 'reps', r.reps); put(it, 'weight', r.weight); put(it, 'mins', r.mins); put(it, 'km', r.km);
      return it;
    });
    plans[String(d.weekday)] = p;
  }

  /* 运动日志（v4.11：项即汇总，一次记录一行） */
  const workouts = [];
  const wiAll = db.prepare('SELECT * FROM workout_items WHERE user_id = ? ORDER BY seq').all(uid);
  for (const w of db.prepare('SELECT * FROM workouts WHERE user_id = ? ORDER BY seq').all(uid)) {
    const o = {};
    put(o, 'id', w.workout_id); put(o, 'date', w.date); put(o, 'name', w.name); put(o, 'note', w.note);
    o.items = wiAll.filter(r => r.workout_id === w.workout_id).map(r => {
      const it = {};
      put(it, 'id', r.item_id); put(it, 'exId', r.ex_id); put(it, 'exName', r.ex_name);
      put(it, 'cat', r.cat); put(it, 'muscle', r.muscle);
      put(it, 'reps', r.reps); put(it, 'weight', r.weight); put(it, 'mins', r.mins); put(it, 'km', r.km);
      return it;
    });
    workouts.push(o);
  }

  /* 身体 */
  const body = db.prepare('SELECT * FROM body_records WHERE user_id = ? ORDER BY seq').all(uid).map(r => {
    const o = { date: r.date };
    BODY_KEYS.forEach(k => put(o, k, r[k]));
    return o;
  });

  /* 睡眠（多段数组，date+seq 保序） / 饮水 */
  const sleep = {};
  for (const r of db.prepare('SELECT * FROM sleep_sessions WHERE user_id = ? ORDER BY date, seq').all(uid)) {
    const s = {};
    put(s, 't', r.t); put(s, 'bed', r.bed); put(s, 'wake', r.wake); put(s, 'mins', r.mins); put(s, 'quality', r.quality);
    if (!sleep[r.date]) sleep[r.date] = [];
    sleep[r.date].push(s);
  }
  const water = {};
  for (const r of db.prepare('SELECT date, cups FROM water_records WHERE user_id = ? ORDER BY date').all(uid)) {
    water[r.date] = r.cups;
  }

  /* 习惯 */
  const habits = [];
  const hdAll = db.prepare('SELECT habit_id, date FROM habit_done WHERE user_id = ?').all(uid);
  for (const h of db.prepare('SELECT * FROM habits WHERE user_id = ? ORDER BY seq').all(uid)) {
    const o = {};
    put(o, 'id', h.habit_id); put(o, 'name', h.name); put(o, 'icon', h.icon); put(o, 'color', h.color);
    o.done = {};
    hdAll.filter(r => r.habit_id === h.habit_id).forEach(r => { o.done[r.date] = true; });
    habits.push(o);
  }

  return { meals, plans, workouts, body, habits, sleep, water };
}

module.exports = { isValidUserState, validateUserData, userRev, createUser, replaceUser, composeUser };
