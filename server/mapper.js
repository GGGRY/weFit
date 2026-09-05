'use strict';
/* =====================================================
   单用户 状态树 ⇄ 关系表 双向转换(v4 账户隔离版)
   核心不变量:replaceUser(db, uid, X) 之后 composeUser(db, uid).data
   必须与 X 的本人数树深度相等(数组顺序、键"存在/缺失"都保真)。
   每用户独立 rev;个人食物/动作库整存 users.foods_json/exercises_json。
   老版本的全库替换(split/clearAll/compose)已删除——那正是
   "多人同时写互相覆盖"的根因,写路径只允许触碰自己那一份。
   ===================================================== */

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const BODY_KEYS = ['weight', 'chest', 'waist', 'hip', 'arm', 'thigh', 'bf'];

/* 带 user_id 外键的子表(删自己子树用;顺序无关,写事务内完成) */
const USER_DATA_TABLES = [
  'habit_done', 'habits', 'water_records', 'sleep_records', 'body_records',
  'workout_sets', 'workout_items', 'workouts', 'plan_items', 'plan_defs',
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

  /* 周计划：键是 "0".."6" */
  const pdefIns = db.prepare('INSERT INTO plan_defs(user_id, weekday, plan_id, name) VALUES (?,?,?,?)');
  const pitemIns = db.prepare(`INSERT INTO plan_items(user_id, weekday, seq, item_id, ex_id,
                               ex_name, muscle, sets, reps, weight) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const plans = u.plans || {};
  Object.keys(plans).forEach(key => {
    if (!/^[0-6]$/.test(key)) return;
    const wd = Number(key);
    const p = plans[key] || {};
    pdefIns.run(uid, wd, nz(p.id), nz(p.name));
    const items = Array.isArray(p.items) ? p.items : [];
    items.forEach((it, i) => pitemIns.run(uid, wd, i, nz(it.id), nz(it.exId), nz(it.exName),
      nz(it.muscle), nz(it.sets), nz(it.reps), nz(it.weight)));
  });

  /* 训练日志：workouts → items → sets（sets 用 item_seq 引用父项） */
  const wIns = db.prepare('INSERT INTO workouts(user_id, workout_id, seq, date, name, note) VALUES (?,?,?,?,?,?)');
  const wiIns = db.prepare('INSERT INTO workout_items(user_id, workout_id, seq, item_id, ex_id, ex_name, muscle) VALUES (?,?,?,?,?,?,?)');
  const wsIns = db.prepare('INSERT INTO workout_sets(user_id, workout_id, item_seq, seq, reps, weight) VALUES (?,?,?,?,?,?)');
  const workouts = Array.isArray(u.workouts) ? u.workouts : [];
  workouts.forEach((w, i) => {
    const wid = nz(w.id) || ('wk_seq_' + i); // 缺 id 时用序号兜底，避免主键为 NULL
    wIns.run(uid, wid, i, nz(w.date), nz(w.name), nz(w.note));
    const items = Array.isArray(w.items) ? w.items : [];
    items.forEach((it, j) => {
      wiIns.run(uid, wid, j, nz(it.id), nz(it.exId), nz(it.exName), nz(it.muscle));
      const sets = Array.isArray(it.sets) ? it.sets : [];
      sets.forEach((s, k) => wsIns.run(uid, wid, j, k, nz(s && s.reps), nz(s && s.weight)));
    });
  });

  /* 身体数据：date 非键（同日多条合法），指标可缺省 */
  const bIns = db.prepare(`INSERT INTO body_records(user_id, seq, date, weight, chest, waist,
                           hip, arm, thigh, bf) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const body = Array.isArray(u.body) ? u.body : [];
  body.forEach((r, i) => {
    const vals = BODY_KEYS.map(k => nz(r[k]));
    bIns.run(uid, i, nz(r.date) || '', ...vals);
  });

  const sIns = db.prepare('INSERT INTO sleep_records(user_id, date, bed, wake, mins, quality) VALUES (?,?,?,?,?,?)');
  const sleep = u.sleep || {};
  Object.keys(sleep).forEach(date => {
    const v = sleep[date] || {};
    sIns.run(uid, date, nz(v.bed), nz(v.wake), nz(v.mins), nz(v.quality));
  });

  const wtrIns = db.prepare('INSERT INTO water_records(user_id, date, cups) VALUES (?,?,?)');
  const water = u.water || {};
  Object.keys(water).forEach(date => wtrIns.run(uid, date, nz(water[date])));

  /* 习惯：done 只存有记录的日期（应用从不写 done:false） */
  const hIns = db.prepare('INSERT INTO habits(user_id, habit_id, seq, name, icon, color) VALUES (?,?,?,?,?,?)');
  const hdIns = db.prepare('INSERT INTO habit_done(user_id, habit_id, date) VALUES (?,?,?)');
  const habits = Array.isArray(u.habits) ? u.habits : [];
  habits.forEach((h, i) => {
    const hid = nz(h.id) || ('h_seq_' + i);
    hIns.run(uid, hid, i, nz(h.name), nz(h.icon), nz(h.color));
    const done = h.done || {};
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
      put(it, 'muscle', r.muscle); put(it, 'sets', r.sets); put(it, 'reps', r.reps); put(it, 'weight', r.weight);
      return it;
    });
    plans[String(d.weekday)] = p;
  }

  /* 训练日志 */
  const workouts = [];
  const wiAll = db.prepare('SELECT * FROM workout_items WHERE user_id = ? ORDER BY seq').all(uid);
  const wsAll = db.prepare('SELECT * FROM workout_sets WHERE user_id = ? ORDER BY item_seq, seq').all(uid);
  for (const w of db.prepare('SELECT * FROM workouts WHERE user_id = ? ORDER BY seq').all(uid)) {
    const o = {};
    put(o, 'id', w.workout_id); put(o, 'date', w.date); put(o, 'name', w.name); put(o, 'note', w.note);
    o.items = wiAll.filter(r => r.workout_id === w.workout_id).map(r => {
      const it = {};
      put(it, 'id', r.item_id); put(it, 'exId', r.ex_id); put(it, 'exName', r.ex_name); put(it, 'muscle', r.muscle);
      it.sets = wsAll.filter(s => s.workout_id === w.workout_id && s.item_seq === r.seq).map(s => {
        const set = {};
        put(set, 'reps', s.reps); put(set, 'weight', s.weight);
        return set;
      });
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

  /* 睡眠 / 饮水 */
  const sleep = {};
  for (const r of db.prepare('SELECT * FROM sleep_records WHERE user_id = ? ORDER BY date').all(uid)) {
    const v = {};
    put(v, 'bed', r.bed); put(v, 'wake', r.wake); put(v, 'mins', r.mins); put(v, 'quality', r.quality);
    sleep[r.date] = v;
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

module.exports = { isValidUserState, userRev, createUser, replaceUser, composeUser };
