/* =====================================================
   weFit · 调试钩子（dev.js）—— 按需加载，不进用户路径
   由 app.js 的 startMain() 在 URL 命中 ?probe/?selftest/?ftest/?shot 时才注入（loadDev()）。
   为什么是普通脚本而不是 ES module：app.js 的 USERS/state/me 是顶层 let（进全局词法环境、
   不在 window 上），只有同作用域的 classic script 才读写得到它们。
   这里只有「演示数据 + 自测」两种东西；用户路径永远不解析本文件。
   ⚠️ ?selftest/?ftest/?shot 会用演示数据覆盖当前账户并同步到服务器（弹窗确认，&devok 跳过）。
===================================================== */

/* ---------- 演示数据的内联库（v4.16） ----------
 * 调试钩子 ?selftest / ?ftest / ?shot 需要一份「内容饱满」的个人库，页面才能渲染出卡片、图表与列表。
 * 这 14 条食物 / 11 个动作就是 seedRichMember() 按名字引用的那一份，营养值取自 v4.15 前的种子
 * （食物换血 USDA 321 条后名字已对不上：find 全部落空、continue 静默跳过，近 14 天餐食其实一条都没灌进去）。
 * 为什么内联而不复用 public/js/seed-data.json：那是**服务端**建系统库用的数据源，
 * 浏览器侧没必要为调试钩子下载 62KB——v4.16 起浏览器完全不加载种子数据本体（只留本文件的枚举常量）。 */
const DEMO_FOODS = [
  {name:'米饭', per100:{kcal:116, p:2.6, c:25.9, f:0.3}},
  {name:'鸡胸肉', per100:{kcal:118, p:22, c:0.6, f:3}},
  {name:'鸡蛋', per100:{kcal:143, p:12.6, c:0.9, f:9.5}},
  {name:'牛奶', per100:{kcal:65, p:3.3, c:4.9, f:3.6}},
  {name:'全麦面包', per100:{kcal:246, p:11, c:44, f:4}},
  {name:'燕麦片', per100:{kcal:367, p:13, c:61, f:7}},
  {name:'红薯', per100:{kcal:86, p:1.6, c:20, f:0.2}},
  {name:'香蕉', per100:{kcal:93, p:1.4, c:22, f:0.2}},
  {name:'苹果', per100:{kcal:53, p:0.4, c:13.7, f:0.2}},
  {name:'西兰花', per100:{kcal:34, p:2.8, c:4.3, f:0.4}},
  {name:'三文鱼', per100:{kcal:139, p:17.2, c:0, f:7.3}},
  {name:'瘦牛肉', per100:{kcal:125, p:20, c:0, f:4.6}},
  {name:'花生酱', per100:{kcal:600, p:25, c:20, f:50}},
  {name:'乳清蛋白粉', per100:{kcal:400, p:80, c:6, f:7}},
];
const DEMO_EXERCISES = [
  {name:'杠铃卧推', cat:'力量', muscle:'胸', mode:'reps'}, {name:'哑铃飞鸟', cat:'力量', muscle:'胸', mode:'reps'},
  {name:'引体向上', cat:'力量', muscle:'背', mode:'reps'}, {name:'杠铃划船', cat:'力量', muscle:'背', mode:'reps'}, {name:'坐姿划船', cat:'力量', muscle:'背', mode:'reps'},
  {name:'杠铃深蹲', cat:'力量', muscle:'腿', mode:'reps'}, {name:'腿举', cat:'力量', muscle:'腿', mode:'reps'}, {name:'罗马尼亚硬拉', cat:'力量', muscle:'腿', mode:'reps'},
  {name:'哑铃二头弯举', cat:'力量', muscle:'手臂', mode:'reps'},
  {name:'跑步', cat:'有氧', muscle:'全身', mode:'time'}, {name:'燃脂操课', cat:'课程', muscle:'全身', mode:'time'},
];
function demoFoodArr(){ return DEMO_FOODS.map((f,i)=>({id:'demo_f'+i, name:f.name, per100:Object.assign({}, f.per100), src:FOOD_SRC_SYS})); }
function demoExArr(){ return DEMO_EXERCISES.map((e,i)=>({id:'demo_e'+i, name:e.name, cat:e.cat, muscle:e.muscle, mode:e.mode})); }

/* ---------- 演示数据（v4.9 起仅供调试钩子 ?selftest/?ftest/?shot 灌数据，用户入口已移除） ---------- */
function demoData(){
  USERS.onboarded = true;
  const t = today();
  /* 演示库无条件装上（不再「库非空就沿用」）：下面的餐食/运动是按名字引用的，
   * 沿用真实库时 USA 321 条里根本没有「米饭/鸡胸肉」这些名字 → find 全落空、近 14 天餐食全空。
   * demoData 本来就是「覆盖当前账户」的钩子（弹窗已明示），要的就是一份已知、可复现的状态。 */
  USERS.shared.foods = demoFoodArr();
  USERS.shared.exercises = demoExArr();
  const foods = USERS.shared.foods, ex = USERS.shared.exercises;
  // 重置当前账户数据（保留名字/头像/颜色），灌入丰富演示数据
  const u = activeUser();
  Object.assign(u, freshUserData());
  seedRichMember(u, t, foods, ex);
  materialize();
  USERS.theme = state.theme;
  save(); go('home');
  toast('已载入演示数据');
}
function seedRichMember(u, t, foods, ex){
  const p = u.profile;
  p.currentKg = 71.2; p.height = 175; p.birthYear = 1992;
  u.goal = { mode:'cut' };
  u.activity = 1.375; u.waterTarget = 8;
  u.nutrition = calcNutritionFor(u);
  // 体重/围度：从 ~120 天前缓慢下降，围度每周一次
  let prev = 78.6;
  for(let i = 120; i >= 0; i -= 3){
    prev = round(prev + (Math.random() - 0.52) * 0.5, 1);
    prev = Math.min(79.4, Math.max(69.5, prev));
    u.body.push({ date: addDays(t, -i), weight: prev });
  }
  let waist = 88, chest = 100;
  for(let i = 119; i >= 0; i -= 7){
    waist = round(waist - (Math.random()*0.6 + 0.1), 1); waist = Math.max(80, waist);
    chest = round(chest + (Math.random()*0.3 - 0.05), 1); chest = Math.min(103, chest);
    u.body.push({ date: addDays(t, -i), waist, chest });
  }
  const lb1 = u.body[u.body.length-1];
  upsertOn(lb1, { weight:71.2, chest:round(chest,1), waist:round(waist,1), hip:round(waist*1.08,1), arm:33, thigh:56 });
  // 饮食：近 14 天
  const grams = { 米饭:180, 鸡胸肉:150, 鸡蛋:150, 牛奶:250, 全麦面包:120, 燕麦片:60, 红薯:200, 香蕉:100, 苹果:150, 西兰花:150, 三文鱼:120, 瘦牛肉:150, 花生酱:20, 乳清蛋白粉:30 };
  for(let i = 13; i >= 0; i--){
    const d = addDays(t, -i);
    u.meals[d] = { breakfast:[], lunch:[], dinner:[], snack:[] };
    const plan = [
      {slot:'breakfast', fs:['燕麦片','牛奶','香蕉','鸡蛋']},
      {slot:'lunch', fs:['米饭','鸡胸肉','西兰花','鸡蛋']},
      {slot:'dinner', fs:['红薯','三文鱼','西兰花']},
    ];
    plan.forEach(gp => {
      const cnt = 2 + Math.floor(Math.random()*2);
      for(let k=0; k<cnt; k++){
        const nm = gp.fs[Math.floor(Math.random()*gp.fs.length)];
        const fo = foods.find(x => x.name === nm);
        if(!fo) continue;
        u.meals[d][gp.slot].push(mealItem(fo, (grams[nm] || 100) * (0.7 + Math.random()*0.7)));
      }
    });
  }
  // 运动计划：周一推 / 周二跑 / 周三拉 / 周五腿（v4.11：项 = 总次数+重量 或 总时长+距离）
  const pushPlan = [['杠铃卧推',32,70],['哑铃飞鸟',36,12],['坐姿划船',30,45]];
  const pullPlan = [['引体向上',32,0],['杠铃划船',40,60],['哑铃二头弯举',36,14]];
  const legPlan  = [['杠铃深蹲',32,90],['腿举',36,140],['罗马尼亚硬拉',30,80]];
  /* v4.4:个人库可能被删过个别种子动作——查不到就跳过该项,不让 demoData 中途抛 TypeError
   * (旧版停在半演示态,随后任意保存会把残缺树推上服务器;餐食路径早已有同款守卫) */
  const toItems = list => list.flatMap(([nm,reps,weight]) => {
    const e = ex.find(x => x.name === nm); if(!e) return [];
    const it = { id:uid(), exId:e.id, exName:e.name, cat:e.cat, muscle:e.muscle, reps };
    if(weight) it.weight = weight;
    return [it];
  });
  const toTimeItems = list => list.flatMap(([nm,mins,km]) => {
    const e = ex.find(x => x.name === nm); if(!e) return [];
    const it = { id:uid(), exId:e.id, exName:e.name, cat:e.cat, muscle:e.muscle, mins };
    if(km) it.km = km;
    return [it];
  });
  /* 运动安排（v4.12：计划与记录同一集合，done 区分）——
   * 未来一周按「周一推 / 周二跑 / 周三拉 / 周五腿」安排，尚未打勾（= 计划） */
  const planByWd = {
    1: { name:'推日', items:toItems(pushPlan) },
    2: { name:'晨跑', items:toTimeItems([['跑步',30,5]]) },
    3: { name:'拉日', items:toItems(pullPlan) },
    5: { name:'腿日', items:toItems(legPlan) },
  };
  for(let i = 1; i <= 7; i++){
    const d = addDays(t, i), p = planByWd[weekday(d)];
    if(!p || !p.items.length) continue;
    u.workouts.push({ id:uid(), date:d, name:p.name, items:p.items });   /* done 缺省 = 未完成 */
  }
  // 运动记录：近 10 周 一三五力量 + 周二/周六有氧（计时项），全部已打勾
  const cycles = [
    {name:'推日 · 胸部', items:[['杠铃卧推',70,32],['哑铃飞鸟',12,36],['坐姿划船',45,30]]},
    {name:'拉日 · 背部', items:[['引体向上',0,32],['杠铃划船',60,40],['哑铃二头弯举',14,36]]},
    {name:'腿日 · 下肢', items:[['杠铃深蹲',90,32],['腿举',140,36],['罗马尼亚硬拉',80,30]]},
  ];
  const cardio = { 2: ['跑步', 5], 6: ['燃脂操课', 0] };   // 周二晨跑(带距离) / 周六操课(纯时长)
  let cursor = addDays(t, -69);
  while(cursor <= t){
    const wd = weekday(cursor);
    if([1,3,5].indexOf(wd) >= 0){
      const ci = [1,3,5].indexOf(wd);
      const items = cycles[ci].items.flatMap(([nm, baseW, baseRm]) => {
        const e = ex.find(x => x.name === nm); if(!e) return [];   /* v4.4:同 toItems 的空值守卫 */
        const prog = Math.floor((parseISO(t) - parseISO(cursor)) / (1000*60*60*24*14));
        const w = Math.max(0, Math.round(baseW + prog * 2 + Math.random()*2));
        const reps = baseRm + Math.floor(Math.random()*5);
        const it = { id:uid(), exId:e.id, exName:e.name, cat:e.cat, muscle:e.muscle, reps, done:true };
        if(w) it.weight = w;
        return [it];
      });
      if(items.length) u.workouts.push({ id:uid(), date:cursor, name:cycles[ci].name, items });
    } else if(cardio[wd]){
      const [nm, km0] = cardio[wd];
      const e = ex.find(x => x.name === nm);
      if(e){
        const it = { id:uid(), exId:e.id, exName:e.name, cat:e.cat, muscle:e.muscle, done:true, mins: (wd === 2 ? 30 : 45) + Math.round(Math.random()*8) };
        if(km0) it.km = Math.round((km0 + Math.random()) * 10) / 10;
        u.workouts.push({ id:uid(), date:cursor, name:(wd === 2 ? '晨跑' : '燃脂操课'), items:[it] });
      }
    }
    cursor = addDays(cursor, 1);
  }
  // 睡眠 30 天（多段：夜间为主，~40% 天数午后一段午睡、~10% 傍晚一段休息）+ 饮水 14 天 + 习惯
  for(let i = 29; i >= 0; i--){
    const d = addDays(t, -i);
    const bed = '23:'+String(Math.floor(Math.random()*3)).padStart(2,'0'), wake = '07:'+String(Math.floor(Math.random()*5)).padStart(2,'0');
    const segs = [{ t:'night', bed, wake, mins: sleepDur(bed, wake, 'night'), quality: Math.random()<0.6 ? 4 : (Math.random()<0.5?3:5) }];
    if(Math.random() < 0.4){ const nb = '12:'+ (i%2 ? '30' : '45'), nw = '13:'+ (i%2 ? '20' : '35');
      segs.push({ t:'nap', bed:nb, wake:nw, mins: sleepDur(nb, nw, 'nap'), quality: 3 + (i % 3) }); }
    if(Math.random() < 0.1){ const rb = '18:00', rw = '18:30';
      segs.push({ t:'rest', bed:rb, wake:rw, mins: sleepDur(rb, rw, 'rest'), quality: 4 }); }
    u.sleep[d] = segs;
  }
  for(let i = 13; i >= 0; i--){ u.water[addDays(t, -i)] = Math.round(4 + Math.random()*6); }
  u.habits.forEach((h, hi) => {
    for(let i = 0; i < 30; i++){
      const d = addDays(t, -i);
      if(hi === 1){ if([1,3,5].indexOf(weekday(d)) >= 0) h.done[d] = true; }
      else if(Math.random() < 0.82) h.done[d] = true;
    }
  });
  u.body.sort((a,b) => a.date < b.date ? -1 : 1);
  u.workouts.sort((a,b) => a.date < b.date ? -1 : 1);
}
function upsertOn(existing, patch){
  Object.keys(patch).forEach(k => { if(patch[k] !== undefined) existing[k] = patch[k]; });
}

function runSelfTest(){
  const errs = [];
  try {
    demoData();
    /* v4.15：数据管理下的两个子页面也进冷渲染冒烟（它们不在 NAV 里，但同样是 go() 能到达的页） */
    const views = ['home','diet','train','body','stats','settings','foodlib','exlib'];
    views.forEach(v => {
      try { curView = v; rebuildNav(); renderView(); errs.push(v + ':ok'); }
      catch(e){ errs.push(v + ':ERR ' + e.message); }
    });
    const audit = [];
    const vid = $('#view');
    audit.push('viewLen=' + (vid ? vid.innerHTML.length : -1));
    audit.push('svgs=' + document.querySelectorAll('#view svg').length);
    audit.push('rects=' + document.querySelectorAll('#view rect').length);
    audit.push('paths=' + document.querySelectorAll('#view path').length);
    audit.push('circles=' + document.querySelectorAll('#view circle').length);
    ['st_weight','st_cal','st_macro','st_vol'].forEach(id => {
      const el = $('#' + id);
      audit.push(id + '_svg=' + (el && el.innerHTML.indexOf('<svg') >= 0 ? 'y' : 'n') + (el ? '_len=' + el.innerHTML.length : ''));
    });
    audit.push('tiles=' + document.querySelectorAll('#view .tile').length);
    const box = document.createElement('pre');
    box.id = 'selftest';
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;background:#fff;color:#c00;padding:10px;font:12px monospace;max-width:90vw;white-space:pre-wrap';
    box.textContent = errs.join('\n') + '\n---AUDIT---\n' + audit.join('\n');
    document.body.appendChild(box);
  } catch(e2){ const box = document.createElement('pre'); box.id='selftest'; box.textContent='FATAL ' + e2.message; document.body.appendChild(box); }
}
function runFTest(){
  const L = [];
  const _preState = JSON.stringify(USERS);   /* adoptRoundtrip 用例会改写内存态，测试后须恢复，避免污染共享服务器数据 */
  function T(name, fn){ try { fn(); L.push(name + ':ok'); } catch(e){ L.push(name + ':ERR ' + e.message); } }
  T('mealAdd', () => { const b4 = dayTotals(today()).kcal; addMealItem(today(), 'lunch', mealItem(state.foods[1], 150)); if(dayTotals(today()).kcal <= b4) throw new Error('kcal-not-increased'); });
  T('upsertBody', () => { const b4 = state.body.length; upsertBody({ date: today(), weight: 70.5, waist: 86 }); const lb = bodyLatest(); if(!lb || lb.weight !== 70.5) throw new Error('latest-wrong'); });
  T('water', () => { state.water[today()] = (state.water[today()] || 0) + 1; if(waterFor(today()) < 1) throw new Error('water-fail'); });
  T('sleep', () => { state.sleep[today()] = [{ t:'night', bed:'23:00', wake:'07:30', mins:510, quality:5 }, { t:'nap', bed:'13:00', wake:'13:30', mins:30, quality:4 }];
    if(sleepTotalMins(today()) !== 540 || sleepSessions(today()).length !== 2) throw new Error('sleep-fail'); });
  T('sleepJunkShape', () => { const u = { sleep: { '2020-01-01': [null, {t:'nap', mins:30}], '2020-01-02': [], '2020-01-03': 'x', '2020-01-04': {}, '2020-01-05': [{t:'meditation', mins:'30'}] } };
    ensureUserIntact(u);   // v4.7：脏元素/空数组/标量/空对象都得洗掉，与服务端 mapper 同一套规则（sleep-shape.js）
    if(JSON.stringify(u.sleep) !== JSON.stringify({ '2020-01-01': [{t:'nap', mins:30}], '2020-01-05': [{t:'meditation'}] })) throw new Error('junk-clean-fail ' + JSON.stringify(u.sleep)); });
  T('sleepDurSameMinute', () => { if(sleepDur('13:00','13:00','nap') !== 0) throw new Error('nap-not-zero');
    if(sleepDur('23:00','23:00','night') !== 1440) throw new Error('night-not-full');
    if(sleepDur('23:00','07:00','night') !== 480) throw new Error('cross-midnight-wrong'); });
  T('habit', () => { const h = state.habits[0]; h.done[today()] = true; if(habitStreak(h, today()) < 1) throw new Error('streak-fail'); });
  T('aimMode', () => { const tdee = bmrOf(state.profile) * state.activity; openNutritionEditor(); const b = curDialog.box; $('#ne_mode', b).value = 'bulk'; $('#ne_save', b).click(); if(state.goal.mode !== 'bulk') throw new Error('aim-not-saved'); if(state.nutrition.kcal !== Math.round(tdee + GOAL_ADJ.bulk)) throw new Error('aim-calc-wrong'); });
  T('mealDialog', () => {
    /* v4.15（2026-09-12）记录饮食三 tab：「新增」全字段 + 勾选入库 → 「我的库」选中后只填克数。
     * 测试用刚入库的那条食物，账户个人库为空也能跑；结束就地复位，不污染真实数据。 */
    dietDate = today(); renderDiet();
    /* 先洗掉历史 residue（上一次跑到一半异常退出时留下的），再取快照 */
    USERS.shared.foods = USERS.shared.foods.filter(f => f.name !== '测试餐'); state.foods = USERS.shared.foods;
    const bakMeals = JSON.stringify(state.meals[today()] || null), bakFoods = JSON.stringify(USERS.shared.foods);
    const before = dayTotals(today()).kcal, nFoods = state.foods.length;
    addMealDialog(today(), 'dinner');
    let b = curDialog.box;
    if(['mine','sys','new'].some(t => b.innerHTML.indexOf('data-mtab="' + t + '"') < 0)) throw new Error('three-tabs-missing');
    $$('[data-mtab="new"]', b)[0].click();
    $('#mi_name', b).value = '测试餐'; $('#mi_kcal', b).value = 100; $('#mi_p', b).value = 10; $('#mi_c', b).value = 10; $('#mi_f', b).value = 5; $('#mi_g', b).value = 200;
    $('#mi_savefood', b).checked = true; $('#mi_save', b).click();
    if(dayTotals(today()).kcal <= before) throw new Error('meal-dialog-not-saved');
    if(state.foods.length !== nFoods + 1 || state.foods[nFoods].name !== '测试餐') throw new Error('savefood-not-imported');
    if(state.foods[nFoods].src !== FOOD_SRC_USER) throw new Error('savefood-src-wrong');
    addMealDialog(today(), 'snack');
    b = curDialog.box;
    if(mdTab !== 'mine') throw new Error('should-open-at-mine-tab');
    /* 候选只渲染前 40 条，先搜一下再点（真库里条目多，不能赌它在首屏） */
    const q = $('#mi_q', b); q.value = '测试餐'; q.dispatchEvent(new Event('input', { bubbles: true }));
    if(mdQuery !== '测试餐') throw new Error('mine-tab-search-not-bound');
    $$('[data-mypick="' + state.foods[nFoods].id + '"]', b)[0].click();
    if($('#mi_save_wrap', b).style.display !== 'none') throw new Error('mine-tab-should-hide-savefood');
    $('#mi_g', b).value = 50; $('#mi_save', b).click();
    const snack = dayMeals(today()).snack || [];
    const it = snack[snack.length - 1];
    if(!it || it.g !== 50 || Math.round(itemMacro(it).kcal) !== 50) throw new Error('mine-tab-not-saved');
    /* 新增 tab 填了库里已有的名字：不能静默跳过入库——勾选行换成「已有」提示 */
    addMealDialog(today(), 'dinner', { tab: 'new' });
    b = curDialog.box;
    $('#mi_name', b).value = '测试餐'; $('#mi_savefood', b).checked = true;
    $('#mi_name', b).dispatchEvent(new Event('input', { bubbles: true }));
    if($('#mi_save_wrap', b).style.display !== 'none') throw new Error('owned-name-should-hide-checkbox');
    if($('#mi_savefood', b).checked !== false) throw new Error('owned-name-should-uncheck');
    if($('#mi_owned', b).style.display === 'none') throw new Error('owned-name-should-tip');
    if($('#mi_owned', b).textContent.indexOf('已有') < 0 || $('#mi_owned', b).textContent.indexOf('测试餐') < 0) throw new Error('owned-tip-text-wrong');
    $('#mi_name', b).value = '新名字菜'; $('#mi_name', b).dispatchEvent(new Event('input', { bubbles: true }));
    if($('#mi_save_wrap', b).style.display === 'none' || $('#mi_owned', b).style.display !== 'none') throw new Error('fresh-name-should-show-checkbox');
    $('#mi_name', b).value = ''; $('#mi_name', b).dispatchEvent(new Event('input', { bubbles: true }));
    if($('#mi_save_wrap', b).style.display !== 'none') throw new Error('empty-name-should-hide-checkbox');
    closeDialog();
    /* 编辑已简化（v4.15：只改克数）：editMealDialog 预填原克数、不写库、不开放改营养 */
    editMealDialog(today(), it.id);
    if(curDialog.box.innerHTML.indexOf('id="mi_name"') >= 0) throw new Error('edit-should-not-expose-nutrition');
    $('#me_g', curDialog.box).value = 80; $('#me_save', curDialog.box).click();
    if(findMealItem(today(), it.id).g !== 80) throw new Error('edit-g-not-saved');
    USERS.shared.foods = JSON.parse(bakFoods); state.foods = USERS.shared.foods;
    if(bakMeals === 'null') delete state.meals[today()]; else state.meals[today()] = JSON.parse(bakMeals);
    save();
  });
  T('workoutCore', () => {
    const before = state.workouts.length;
    /* 用未被占用的日期，别撞上真实数据里今天已有的那条 */
    let d = addDays(today(), 1);
    for(let i = 0; i < 400 && workoutForDate(d); i++) d = addDays(d, 1);
    const ex0 = state.exercises[0];
    state.workouts.push({ id:'wt_core', date:d, name:'测试', items:[
      { id:'wt_c1', exId:ex0.id, exName:ex0.name, cat:'力量', muscle:'胸', reps:32, weight:60, done:true },
      { id:'wt_c2', exName:'测试跑步', cat:'有氧', muscle:'全身', mins:30, km:5 },
    ] });
    const w = workoutForDate(d);
    if(itemVolume(w.items[1]) !== 0) throw new Error('time-item-polluted-volume');
    /* v4.12：统计只算已打勾的项（完成的最小单位是项） */
    if(wkVolume(w) !== 1920 || wkMinutes(w) !== 0 || wkDistance(w) !== 0) throw new Error('done-only-sum-wrong');
    if(planVolume(w) !== 1920 || planMinutes(w) !== 30) throw new Error('plan-sum-wrong');
    if(doneCount(w) !== 1 || !isDone(w) || allDone(w)) throw new Error('progress-wrong');
    toggleItemDone('wt_core', 'wt_c2');
    if(!allDone(w) || wkMinutes(w) !== 30 || wkDistance(w) !== 5 || doneCount(w) !== 2) throw new Error('toggle-item-wrong');
    /* PR 只跟更早、已打勾的项比：未来安排与未打勾项都不算。合成 exId 避开真实历史 */
    state.workouts.push({ id:'wt_plan_pr', date:addDays(d, 3), name:'未来安排', items:[
      { id:'wt_p1', exId:ex0.id, exName:ex0.name, cat:'力量', muscle:'胸', reps:1, weight:99999 } ] });
    const pr = isPRItem({ exId:'__selftest_ex__', weight:200, reps:1 }, d);
    if(!pr.wPR) throw new Error('pr-false');
    state.workouts = state.workouts.filter(x => x.id !== 'wt_plan_pr' && x.id !== 'wt_core');
    if(state.workouts.length !== before) throw new Error('not-cleaned');
  });
  T('itemDlg', () => {
    /* 逐项添加：三 tab 录入（名称与「计次 / 计时」方式由选中条目/新增表单决定）→
     * 同日再加一项 → 改一项保 done → 逐项删到空那天回收。
     * 个人库可能为空（v4.15 起新账户默认空库）：优先点「我的库」第一条，空了就走「新增」手填 */
    let d = addDays(today(), 1);
    for(let i = 0; i < 400 && workoutForDate(d); i++) d = addDays(d, 1);
    const before = state.workouts.length;
    function pickFirst(){
      const box = $$('.overlay').slice(-1)[0];
      const row = $('[data-mypick]', box);
      if(row){ row.click(); return box; }
      const newTab = $('[data-ittab="new"]', box);
      if(!newTab) throw new Error('no-tab-new');
      newTab.click();
      const nameEl = $('#it_new_name', box);
      if(!nameEl) throw new Error('no-new-name');
      nameEl.value = '自测动作' + (state.exercises.length + 1);
      nameEl.dispatchEvent(new Event('input', { bubbles:true }));   /* 触发 applyPick → 画出数值区 */
      return box;
    }
    openItemDlg(d);
    let box = pickFirst();
    const isTime = !!$('#it_mins', box);                 /* 方式由库条目自动设定 */
    /* 起步值由 defaultForMode 补上：计时 20 分钟 / 计次 30 次 */
    if(isTime ? $('#it_mins', box).value !== String(DEFAULT_MINS) : $('#it_reps', box).value !== String(DEFAULT_REPS)) throw new Error('default-not-applied');
    if(isTime) $('#it_mins', box).value = '30'; else $('#it_reps', box).value = '12';
    $('#it_save', box).click();
    let day = workoutForDate(d);
    if(!day || day.items.length !== 1) throw new Error('item-not-added');
    const it0 = day.items[0];
    if(!it0.exId) throw new Error('must-come-from-library');
    if(isTime ? it0.mins !== 30 : it0.reps !== 12) throw new Error('value-not-saved');
    if(state.workouts.length !== before + 1) throw new Error('day-not-created');
    /* 同日再点「＋ 添加运动」是再加一项，不是覆盖整天 */
    openItemDlg(d);
    box = pickFirst();
    if($('#it_mins', box)) $('#it_mins', box).value = '20'; else $('#it_reps', box).value = '8';
    $('#it_save', box).click();
    day = workoutForDate(d);
    if(day.items.length !== 2) throw new Error('second-item-not-appended');
    /* 逐项编辑：预填旧值，改数值后保留 done 与位置 */
    toggleItemDone(day.id, it0.id);
    openItemDlg(d, it0.id);
    box = $$('.overlay'); box = box[box.length-1];
    if($('#it_mins', box)) $('#it_mins', box).value = '25'; else $('#it_reps', box).value = '15';
    $('#it_save', box).click();
    day = workoutForDate(d);
    const edited = day.items.find(x => x.id === it0.id);
    if(!edited || day.items.length !== 2) throw new Error('edit-item-gone');
    if(edited.done !== true) throw new Error('edit-lost-done');
    if(edited.reps !== 15 && edited.mins !== 25) throw new Error('edit-value-wrong');
    /* 逐项删除：删掉最后一项时那天整条消失（delItem 带确认框，自测里临时替掉，别把调试钩子卡住） */
    const _confirm = window.confirm; window.confirm = () => true;
    try {
      delItem(d, day.items[1].id);
      if(!workoutForDate(d) || workoutForDate(d).items.length !== 1) throw new Error('del-item-wrong');
      delItem(d, day.items[0].id);
      if(workoutForDate(d) || state.workouts.length !== before) throw new Error('empty-day-not-dropped');
    } finally { window.confirm = _confirm; }
  });
  T('merge', () => {
    /* v4.12：完成的最小单位是「项」——勾一项这天就算已运动；全勾 = 全部完成 */
    let d = addDays(today(), 2);
    for(let i = 0; i < 400 && workoutForDate(d); i++) d = addDays(d, 1);
    const day = { id:'wt_merge', date:d, name:'合并测试', items:[
      { id:'wt_m1', exName:'动作一', reps:10 }, { id:'wt_m2', exName:'动作二', reps:10 } ] };
    state.workouts.push(day);
    if(isDone(day) || doneCount(day) !== 0) throw new Error('should-start-empty');
    if(workoutsByDone(false).indexOf(day) < 0) throw new Error('not-in-pending');
    toggleItemDone('wt_merge', 'wt_m1');
    if(!isDone(day) || doneCount(day) !== 1 || allDone(day)) throw new Error('first-item-wrong');
    if(workoutsByDone(true).indexOf(day) < 0) throw new Error('not-in-done');
    toggleItemDone('wt_merge', 'wt_m2');
    if(!allDone(day) || doneCount(day) !== 2) throw new Error('all-wrong');
    toggleItemDone('wt_merge', 'wt_m1');
    toggleItemDone('wt_merge', 'wt_m2');
    if(isDone(day)) throw new Error('clear-all-wrong');
    state.workouts = state.workouts.filter(x => x.id !== 'wt_merge');
  });
  T('workoutShape', () => {
    /* ① 天级 done 下放到项；② v4.11 树（有 plans）里原 workouts 都是已完成的日志；
     * ③ sets 旧项/同日/无日期丢弃 */
    const down = { workouts: [
      { date:'2026-03-01', done:true, items:[{ exName:'A', reps:1 }, { exName:'B', reps:1 }] },
      { date:'2026-03-02', items:[{ exName:'C', reps:1 }], done:false },
    ] };
    normalizeWorkoutDays(down);
    if(down.workouts[0].done !== undefined || down.workouts[0].items.some(it => !it.done)) throw new Error('downshift ' + JSON.stringify(down.workouts[0]));
    if(down.workouts[1].items[0].done !== undefined) throw new Error('false-should-drop ' + JSON.stringify(down.workouts[1]));
    const u = { plans:{ '1':{ items:[] } }, workouts: [
      { date:'2026-01-01', note:'旧', items:[{ exName:'旧', sets:[{ reps:8, weight:60 }] }, { exName:'留', reps:1 }] },
      { date:'2026-01-02', items:[{ exName:'新', reps:10 }] },
      { date:'2026-01-02', items:[{ exName:'重复', reps:5 }] },
      { items:[{ exName:'无日期', reps:5 }] },
    ] };
    normalizeWorkoutDays(u);
    if(u.plans !== undefined) throw new Error('plans-not-dropped');
    if(u.workouts.length !== 2) throw new Error('kept=' + u.workouts.length + ' ' + JSON.stringify(u.workouts));
    if(u.workouts[0].items.length !== 1 || u.workouts[0].items[0].done !== true) throw new Error('sets-drop ' + JSON.stringify(u.workouts[0]));
    if(u.workouts[1].items[0].done !== true) throw new Error('v411-backfill ' + JSON.stringify(u.workouts[1]));
    legacyShapeCleaned = false;   /* 别把测试里的清洗标记留给真实启动路径 */
  });
  T('charts', () => { const s1 = lineChartSVG({ points:[{x:'2026-01-01',y:1},{x:'2026-01-02',y:3}], color:CX.brand }); if(s1.indexOf('<svg') < 0) throw new Error('line-no-svg'); const s2 = groupedBarSVG({ days:['2026-01-01','2026-01-02'], series:[{label:'a', color:CX.c1, data:[1,2]}] }); if(s2.indexOf('<rect') < 0) throw new Error('bar-no-rect'); });
  T('selfTree', () => {
    /* v4:任何时刻树里只有本账户一位成员 */
    if(userCount() !== 1) throw new Error('should-have-1-user');
    const sid = selfUid();
    if(sid && Object.keys(USERS.users)[0] !== sid) throw new Error('uid-mismatch');
  });
  T('adoptRoundtrip', () => {
    const snap = JSON.parse(JSON.stringify(USERS));
    if(!adoptRaw(snap)) throw new Error('v4-adopt-fail');
    normalizeSelfTree(); materialize();
    if(userCount() !== 1) throw new Error('count-should-be-1');
    if(!USERS.shared.foods.length) throw new Error('shared-seed-missing');
  });
  /* 恢复测试前状态并落盘推送，防止 adoptRoundtrip 的内存态改动污染服务器 */
  if(adoptRaw(JSON.parse(_preState))){ materialize(); save(); }
  const box = document.createElement('pre');
  box.id = 'selftest';
  box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;background:#fff;color:#0a0;padding:10px;font:12px monospace;max-width:90vw;white-space:pre-wrap';
  box.textContent = L.join('\n');
  document.body.appendChild(box);
}

/* ---------- 钩子总入口 ----------
 * 返回 true = 已接管（调用方直接 return）；false = 不是调试 URL，调用方按真实数据进入。
 * 语义与拆分前一致：?probe 不打确认门（只读摘要）；三个会改数据的钩子共用同一门卫，
 * 确认/取消后都把查询串剥掉（&devok 常驻 URL 会让每次刷新静默重置）。 */
function devHandle(qs, opts){
  const offlineBoot = !!(opts && opts.offlineBoot);
  const shotView = (opts && opts.shotView) || null;
  const dropQs = () => history.replaceState(null, '', location.pathname);
  const enterReal = () => {   /* 取消/无效：剥钩子，按真实数据正常进入 */
    dropQs();
    if(offlineBoot){ srv.online = false; toast('服务器离线：正显示本机缓存，恢复后自动补同步', true); }
    if(!USERS.onboarded){ showOnboard(); }
    go(readView());
  };
  if(qs.has('probe')){
    const u = activeUser();
    const pre = document.createElement('pre');
    pre.id = 'selftest';
    pre.textContent = JSON.stringify({ user:activeUser().name, uid:selfUid(), role:me&&me.role, kg:u.profile.currentKg, body:u.body.length, foods:USERS.shared.foods.length, ex:USERS.shared.exercises.length, theme:USERS.theme, onboarded:!!USERS.onboarded });
    document.body.appendChild(pre);
    return true;
  }
  const isDevUrl = qs.has('selftest') || qs.has('ftest') || shotView !== null;
  if(!isDevUrl) return false;
  /* v4.4 统一门卫：?selftest 同样会覆盖并推送演示数据（v4.3 只挡了 ?ftest/?shot，selftest 先于
   * 确认块直接执行 = 漏网）；先校验 ?shot 目标视图再动数据（旧版先 demoData 后校验，
   * 拼错的视图名照样清空账户）。 */
  if(!qs.has('devok') && !confirm('这是调试链接：将用演示数据覆盖当前账户的全部数据，并自动同步到服务器（真实数据会丢失）。\n\n【确定】继续调试\n【取消】按真实数据正常进入')){
    enterReal();
    return true;
  }
  if(qs.has('ftest')){ demoData(); runFTest(); }
  else if(qs.has('selftest')){ runSelfTest(); }   /* runSelfTest 内部会先载入演示数据 */
  else if(!shotView || !NAV.some(n => n.id === shotView)){
    toast('未知的调试视图 ?shot=' + (shotView || '') + '（可选：' + NAV.map(n => n.id).join('/') + '）——未改动任何数据', true);
    enterReal();
    return true;
  } else {
    demoData(); go(shotView);
  }
  dropQs();
  return true;
}
window.__devHooks = { handle: devHandle };
