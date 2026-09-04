'use strict';
/* =====================================================
   USERS JSON 树 ⇄ 关系表 双向转换
   核心不变量：split(db, X) 之后 compose(db).data 必须与 X 深度相等
   （数组顺序、对象键的"存在/缺失"都保真；profile/goal/nutrition
   等形状固定的小配置对象用 JSON 列整存整取，天然保真）。
   ===================================================== */

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const BODY_KEYS = ['weight', 'chest', 'waist', 'hip', 'arm', 'thigh', 'bf'];

const nz = v => (v === undefined || v === null ? null : v);           // 写库：undefined → NULL
const jz = v => (v === undefined || v === null ? null : JSON.stringify(v));
const jsonParse = t => (t === null || t === undefined ? null : JSON.parse(t));
const put = (o, k, v) => { if (v !== null && v !== undefined) o[k] = v; }; // 读库：NULL → 键缺失

function isValidState(s) {
  return !!s && typeof s === 'object'
    && s.users && typeof s.users === 'object' && !Array.isArray(s.users)
    && s.shared && typeof s.shared === 'object'
    && Array.isArray(s.shared.foods) && Array.isArray(s.shared.exercises);
}

function currentRev(db) {
  const row = db.prepare('SELECT rev FROM app WHERE id = 1').get();
  return row ? row.rev : 0;
}

function clearAll(db) {
  /* 整体替换：全表清空后重灌。关闭外键避免删除顺序问题（事务内完成，失败即回滚） */
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    DELETE FROM habit_done; DELETE FROM habits; DELETE FROM water_records;
    DELETE FROM sleep_records; DELETE FROM body_records; DELETE FROM workout_sets;
    DELETE FROM workout_items; DELETE FROM workouts; DELETE FROM plan_items;
    DELETE FROM plan_defs; DELETE FROM meals; DELETE FROM meal_days;
    DELETE FROM exercises; DELETE FROM foods; DELETE FROM users; DELETE FROM app;
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

/* ---------- 写入：整树拆解 ---------- */
function split(db, USERS) {
  const nextRev = currentRev(db) + 1;
  db.exec('BEGIN IMMEDIATE');
  try {
    clearAll(db);
    insertAll(db, USERS, nextRev);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (e2) { /* 回滚失败不掩盖原始错误 */ }
    throw e;
  }
  return nextRev;
}

function insertAll(db, USERS, rev) {
  const appIns = db.prepare('INSERT INTO app(id, theme, onboarded, active_user_id, rev) VALUES (1, ?, ?, ?, ?)');
  appIns.run(nz(USERS.theme) || 'light', USERS.onboarded ? 1 : 0, nz(USERS.active), rev);

  const foodIns = db.prepare('INSERT INTO foods(id, seq, name, kcal, p, c, f) VALUES (?,?,?,?,?,?,?)');
  USERS.shared.foods.forEach((fo, i) => {
    const per = fo.per100 || {};
    foodIns.run(fo.id, i, nz(fo.name), nz(per.kcal), nz(per.p), nz(per.c), nz(per.f));
  });
  const exIns = db.prepare('INSERT INTO exercises(id, seq, name, muscle) VALUES (?,?,?,?)');
  USERS.shared.exercises.forEach((e, i) => exIns.run(e.id, i, nz(e.name), nz(e.muscle)));

  Object.keys(USERS.users).forEach((uid, uSeq) => {
    const u = USERS.users[uid] || {};
    insertUser(db, uid, uSeq, u);
  });
}

function insertUser(db, uid, uSeq, u) {
  db.prepare(`INSERT INTO users(id, seq, name, avatar, color, activity, water_target,
              profile_json, goal_json, nutrition_json) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(uid, uSeq, nz(u.name), nz(u.avatar), nz(u.color), nz(u.activity), nz(u.waterTarget),
      jz(u.profile), jz(u.goal), jz(u.nutrition));

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

/* ---------- 读出：整树重建 ---------- */
function compose(db) {
  const row = db.prepare('SELECT * FROM app WHERE id = 1').get();
  if (!row) return { rev: 0, data: null };

  const shared = {
    foods: db.prepare('SELECT * FROM foods ORDER BY seq').all().map(r => {
      const o = { id: r.id };
      put(o, 'name', r.name);
      const per = {};
      put(per, 'kcal', r.kcal); put(per, 'p', r.p); put(per, 'c', r.c); put(per, 'f', r.f);
      if (Object.keys(per).length) o.per100 = per;
      return o;
    }),
    exercises: db.prepare('SELECT * FROM exercises ORDER BY seq').all().map(r => {
      const o = { id: r.id };
      put(o, 'name', r.name); put(o, 'muscle', r.muscle);
      return o;
    }),
  };

  const users = {};
  for (const ur of db.prepare('SELECT * FROM users ORDER BY seq').all()) {
    const u = { id: ur.id };
    put(u, 'name', ur.name); put(u, 'avatar', ur.avatar); put(u, 'color', ur.color);
    put(u, 'activity', ur.activity); put(u, 'waterTarget', ur.water_target);
    put(u, 'profile', jsonParse(ur.profile_json));
    put(u, 'goal', jsonParse(ur.goal_json));
    put(u, 'nutrition', jsonParse(ur.nutrition_json));
    Object.assign(u, readUserData(db, ur.id));
    users[ur.id] = u;
  }

  const data = {
    theme: row.theme,
    onboarded: !!row.onboarded,
    shared,
    users,
    active: nz(row.active_user_id),
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
  const planItems = db.prepare('SELECT * FROM plan_items ORDER BY weekday, seq').all();
  for (const d of db.prepare('SELECT * FROM plan_defs WHERE user_id = ? ORDER BY weekday').all(uid)) {
    const p = {};
    put(p, 'id', d.plan_id); put(p, 'name', d.name);
    p.items = planItems.filter(r => r.user_id === uid && r.weekday === d.weekday).map(r => {
      const it = {};
      put(it, 'id', r.item_id); put(it, 'exId', r.ex_id); put(it, 'exName', r.ex_name);
      put(it, 'muscle', r.muscle); put(it, 'sets', r.sets); put(it, 'reps', r.reps); put(it, 'weight', r.weight);
      return it;
    });
    plans[String(d.weekday)] = p;
  }

  /* 训练日志 */
  const workouts = [];
  const wiAll = db.prepare('SELECT * FROM workout_items ORDER BY seq').all();
  const wsAll = db.prepare('SELECT * FROM workout_sets ORDER BY item_seq, seq').all();
  for (const w of db.prepare('SELECT * FROM workouts WHERE user_id = ? ORDER BY seq').all(uid)) {
    const o = {};
    put(o, 'id', w.workout_id); put(o, 'date', w.date); put(o, 'name', w.name); put(o, 'note', w.note);
    o.items = wiAll.filter(r => r.user_id === uid && r.workout_id === w.workout_id).map(r => {
      const it = {};
      put(it, 'id', r.item_id); put(it, 'exId', r.ex_id); put(it, 'exName', r.ex_name); put(it, 'muscle', r.muscle);
      it.sets = wsAll.filter(s => s.user_id === uid && s.workout_id === w.workout_id && s.item_seq === r.seq).map(s => {
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
  const hdAll = db.prepare('SELECT user_id, habit_id, date FROM habit_done').all();
  for (const h of db.prepare('SELECT * FROM habits WHERE user_id = ? ORDER BY seq').all(uid)) {
    const o = {};
    put(o, 'id', h.habit_id); put(o, 'name', h.name); put(o, 'icon', h.icon); put(o, 'color', h.color);
    o.done = {};
    hdAll.filter(r => r.user_id === uid && r.habit_id === h.habit_id).forEach(r => { o.done[r.date] = true; });
    habits.push(o);
  }

  return { meals, plans, workouts, body, habits, sleep, water };
}

module.exports = { isValidState, currentRev, split, compose };
