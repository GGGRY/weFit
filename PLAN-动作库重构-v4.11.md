# 动作库重构:支持计时类运动(拟 v4.11)

> 状态:**方案已定稿,待用户定夺,未实施**(2026-09-06 规划)
> 已确认的决策:计时记录字段 = 总时长 + 可选距离;计时类按运动类型分类;历史页加每周运动时长图;实施时记为 v4.11。不做秒表、不做多段间歇(留二期)。

## Context

weFit 动作库目前只有 `{id, name, muscle}` 三个字段,所有动作都按「组×次数×重量」记录;「有氧」只是一个肌群标签,跑步/跳操/健身课这类以时间计的运动无法自然记录(只能硬填次数)。本次重构给动作引入**计数方式 `kind: 'reps' | 'time'`**,计时类按**运动类型**(跑步/骑行/游泳/跳操/课程/其他)分类,记录字段为**总时长(分钟)+ 可选距离(km)**;历史页新增**每周运动时长**图。存量数据全部兼容(旧记录仍按力量展示)。

## 数据模型

**库条目** `{id, name, kind, muscle}` — 沿用 `muscle` 字段名承载"类别"语义以最小化改动面:kind='reps' 时值是肌群(SEED_MUSCLES),kind='time' 时值是运动类型(新枚举 SEED_CATEGORIES)。缺 kind 的旧条目在读取咽喉处补:`muscle==='有氧' ? 'time' : 'reps'`。

**计划项** `{id, exId, exName, muscle, kind, sets, reps, weight}`(力量,原样)或 `{id, exId, exName, muscle, kind:'time', mins}`(计时,计划不含距离)。

**日志项** 力量:`{..., sets:[{reps,weight}]}` 原样不动;计时:`{..., kind:'time', mins, km?, sets:[]}`。**计时项保留空 `sets:[]` 是刻意设计** — 服务端 mapper 读出侧对每个 item 恒附 sets 键,不带该键会破坏"键存在/缺失保真"的核心不变量(server/mapper.js 文件头)。

## 一、单一数据源(seed-data.js)

- `public/js/seed-data.js`:新增 `SEED_CATEGORIES = ['跑步','骑行','游泳','跳操','课程','其他']`(与 SEED_MUSCLES 同样由 app.js/admin.html 共用的约定);`SEED_EXERCISES` 每条加 `kind`,「跑步机慢跑」改 kind:'time'/muscle:'跑步',补 3~4 条计时种子(户外跑步、帕梅拉跳操、动感单车、燃脂操课)。
- `public/js/app.js:83` 旁:仿 MUSCLES 兜底写法加 `CATEGORIES`;`seedExArr()`(app.js:101)带上 kind。

## 二、形状迁移(前端咽喉,幂等)

`app.js ensureUserIntact()`(仿睡眠 normalizeSleepDay 先例,不 bump 存储版本):
- `USERS.shared.exercises` 逐条:`e.kind !== 'time' && e.kind !== 'reps'` 时按 `muscle==='有氧'` 补 time/reps(time 类且 muscle 不在 CATEGORIES → 归'其他')。
- 计划项/日志项:缺 kind 一律视为 'reps'(存量全是 sets 形态,不猜测不改写)。

## 三、服务端

- `server/db.js`:`SCHEMA` 里 `workout_items` 加 `kind TEXT, mins REAL, km REAL`、`plan_items` 加 `kind TEXT, mins REAL`;`migrate()` 用现成的幂等 `addColumn()`(db.js:145)给存量库补列。
- `server/mapper.js`:`insertUserData` 的 wiIns/pitemIns 两条 INSERT 加列(经 `nz()`),`readUserData` 对 item 加 `put(it,'kind')/put(it,'mins')/put(it,'km')`(NULL→键缺失,保真)。
- `server/server.js sanitizeLibrary()`(:134 循环):保留 `kind`(白名单 'reps'/'time',非法值丢弃)。个人库是 JSON 整存(`users.exercises_json`),新字段天然保真,无需动。
- 测试:`server/test/fixture.json` 与 `roundtrip.test.js` 加计时条目/计时日志项/计时计划项断言往返保真;`admin.test.js` 补 sanitizeLibrary 的 kind 用例。

## 四、前端 UI(app.js)

1. **动作库弹窗**(`openExLib` 区,:1550-1626):新增表单加「计数方式」下拉(reps/time),类别下拉随 kind 在 MUSCLES/CATEGORIES 间切换;列表分「🏋️ 力量动作」「⏱ 计时动作」两区各自分组;`importExerciseFromSys()`(:1217)带上 kind;`paintSysLib` 按 kind+类别分组(未知类别兜'其他',仿 :1607 现写法)。
2. **管理后台**(`public/admin.html` :269-291):新动作表单加计数方式选择(time 时肌群下拉换成运动类型下拉,枚举引 seed-data.js 的 SEED_CATEGORIES),列表行显示 kind 标记。
3. **动作选择器** `openExercisePicker()`(:1540):两个分组区「力量动作 / 计时动作」。
4. **运动记录弹窗** `openWorkoutDlg()`(:1438):
   - 行编辑按 kind 分叉:计时行 = 分钟输入 + 快捷档 chips(15/30/45/60)+ 可选公里输入;力量行不动。删除 :1502 的 `muscle==='有氧' ? 0 : 40` 临时 hack,改由 kind 决定初始行形态。
   - 保存收拢::1513-1517 的过滤对计时项改为要求 `mins>0`;自动入库存(:1522-1527)时新条目带上 kind。
   - 从周计划导入 `importPlan()`(:1443):计时项映射为 `{kind:'time', mins}`。
5. **计划编辑器** `openPlanEditor()`(:1340):选到计时动作时该行组/次/重量输入换成时长(分钟)输入;计划卡渲染(:1326)与概览今日运动卡(:1021)对计时行显示「45 分钟」。
6. **日志列表** `renderWorkoutList()`(:1409):计时项 sub 行显示「45 分钟 · 5.2 km」,muscle 首字图标显示保持现逻辑。
7. **统计防污 + 新图**:
   - `wkVolume()`(:586)只累加 `s.reps && s.weight` 的组(计时项空 sets 天然安全,双保险);`bestOfSets/isPR`(:566-585)已有 `!s.weight` 跳过与 `s.reps||0` 兜底,复核即可。
   - 仿 `weeklyVolumes()`(:2454)新增 `weeklyMinutes(12)`(Σ 计时项 mins),历史页 c4「每周运动容量」下方加卡「每周运动时长 · 近12周 · 分钟」,复用 `barChartSVG`。
8. **ftest/selftest**(:2516 workoutCore 加计时项不污染容量断言;:2517 workoutDlg 补一条计时保存链路;`seedRichMember` 顺手加两条计时日志让 selftest 渲染到新形态)。

## 五、文档(AGENTS.md 要求)

- `CHANGELOG.md`:新增 **v4.11(2026-09-06)** 段 — 按版本规则把本批「未标版号」改动(动作库入口迁移 / 身体页首卡 / 间距修复等)一并归类,再加本次重构正文;文件头版本规则不动。
- `MEMO.md`:动作库/运动记录数据模型、服务端表列现状、历史页图表清单更新为重构后状态。
- `README.md`:功能介绍补计时运动与动作库两区分组。
- `PLANS.md`:一期完成后打勾;二期候选记「秒表计时、多段间歇、距离汇总」。

## 验证

1. `cd server && node --test test/`(或 package.json 里的 test 脚本)全绿,重点看往返保真用例。
2. **部署顺序(项目记忆规矩)**:停服务 → 起服务 → 全端强刷,严禁新旧进程混跑(避免复现 09-06 睡眠记录覆盖丢失事故)。
3. 浏览器开 `?selftest`、`?ftest` 调试钩子全 ok。
4. 手动链路:设置→动作库新增「跳舞操(计时/课程)」→ 从系统库挑入计时动作(确认 kind 保住)→ 运动页记录:选计时动作填 40 分钟+5km 保存 → 日志/概览/计划显示正确 → 刷新页面与换浏览器登录同账户,确认同步往返无字段丢失;再验一条力量记录(卧推 4×8@60)不受影响;admin 后台增删计时动作、普通用户挑入。
5. 历史页:周时长图数值 = Σ 当周计时分钟;力量容量图与 PR 角标不含计时项。

## 二期候选(本次不做)

- 记录弹窗内置秒表(开始/暂停/落数)
- 多段间歇(HIIT 8×20s,sets 改 [{mins}] 数组)
- 距离按周汇总、配速计算(分钟/km)
