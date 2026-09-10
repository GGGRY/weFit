# 动作库重构（v4.11）：通用运动库（洁净起点版）

> 状态：**✅ 已实施（v4.11，2026-09-10）**
> 实施说明：本方案四批全部落地。与稿子的两处差异——① 计时快捷档 15/30/45/60 只加在「记录运动」弹窗（周计划行仍为裸输入）；② `itemMode` 不回退 `libMode(exId)`，只按 mins/km 判定。另：破坏性重置加固为事务 + bump 各账户 rev，客户端 `adoptRaw` 增加旧形状清洗兜底（2026-09-10 复审补丁）。
> 前三次修正：① 重写旧稿 → ② 归类三层 `cat › muscle › name` → ③ 取消分段、只记总次数/总时长 → ④ **本版：旧运动数据整体作废，删除存储层的数组容器，全链路拍平**。
> 核心：**归类三层（cat › muscle › name）+ 计数轴（mode）+ 计划项与日志项同形**。

---

## 0. 问题诊断：现有模型卡在哪

现在一个动作 = `{id, name, muscle}`，一次完成 = `sets:[{reps, weight}]`。不是"字段少了两个"，而是**归类与计数被压成一根轴、计数方式被写死在列里**：

| # | 症状 | 位置 |
|---|---|---|
| 1 | 归类与计数合一：`muscle` 枚举里塞了「有氧」，于是「跑步」只能算一块肌肉，「平板支撑」明明按秒计却只能填次数 | `seed-data.js:9` |
| 2 | 时长/距离无处安放：`workout_sets` 只有 `reps, weight` | `db.js:71-92` |
| 3 | 保存路径会把计时记录整条丢掉：收拢时 `filter(s => s.reps > 0)` 对「只填了 40 分钟」判 false | `app.js:1510-1511` |
| 4 | 统计会被计时数据污染成 `NaN`：`v += s.weight * s.reps` → 整张容量图显示 `NaN kg` | `app.js:586` |
| 5 | 「组×次」硬编码在 10+ 处，`sets` 一词在 `app.js` 出现 **36 次** | 见 §5 清单 |
| 6 | 靠动作名猜语义：`m.muscle==='有氧' ? 0 : 40` | `app.js:1498` |
| 7 | 计划项 `{sets,reps,weight}` 与日志项 `{sets:[{reps,weight}]}` **形状不同**，导入要写展开逻辑，渲染要写两套 | `app.js:1442` |

关键认识：**「是什么」（大类/部位）、「叫什么」（项目名）、「怎么计数」（计次/计时）是三件独立的事**。卧推是"力量 · 胸 · 杠铃卧推 · 计次"，跑步是"有氧 · 全身 · 跑步 · 计时"，平板支撑是"力量 · 核心 · 平板支撑 · **计时**"。

---

## 1. 设计目标与硬不变量

**目标**
- G1 一个库同时容纳：力量（次数×重量）、自重（次数）、静力（时长）、有氧（时长＋可选距离）、课程（时长）。
- G2 新增一种计数维度（心率、RPE、坡度、配速）= **加一列**，不改形状、不改统计骨架。
- G3 记录界面按动作性质自动变形：选中跑步就是「时长 + 距离」，选中卧推就是「次数 + 重量」。
- G4 **一次记录 = 一条汇总**，没有组、没有段、没有嵌套输入（用户裁定）。
- G5 **计划项与日志项同形**：一个行编辑器、一个渲染函数、导入即复制。

**不变量**
- I1 单用户树 PUT→GET 深度相等（`server/mapper.js` 文件头）：数组顺序与**键的存在/缺失**都要保真（`put()`/`nz()` 的 NULL↔缺键约定）。`reps`/`weight`/`mins`/`km` 均可缺。
- I2 服务端**不注入默认值**：库的形状由种子与客户端保证，服务端只做白名单校验。
- I3 **运动数据整体重置**（用户裁定 2026-09-06）：旧运动计划、运动日志、个人动作库作废；**饮食、身体、睡眠、饮水、习惯、账户、食物库零影响**（见 §3）。
- I4 零依赖：不加 npm 包、不加构建工具（`server/test/` 除外）。
- I5 破坏性迁移**一次性且可判定**：判据明确、幂等、备份先行、绝不静默复发（见 §3）。

---

## 2. 数据模型

### 2.1 三种形状（其实只有两种）

```js
// ① 库条目：动作是什么 + 它默认怎么计数
{ id, name:'杠铃卧推'|'跑步'|…,                    // 具体项目
  cat:'力量'|'有氧'|'课程'|'球类'|'柔韧'|'其他',    // 大类（表格里的一列）
  muscle:'胸'|…|'核心'|'全身'|'其他',               // 部位：力量类是肌群，其余默认「全身」
  mode:'reps'|'time' }                             // 计数轴（与 cat 正交）

// ②③ 计划项 === 日志项（同形；日志头 {id,date,name,note?,items:[…]} 不变）
{ id, exId, exName, cat, muscle, reps?, weight?, mins?, km? }
```

| 场景 | 用户填 | 存下来的项 |
|---|---|---|
| 卧推（合计 32 次 @60kg） | 次数 `32` / 重量 `60` | `{cat:'力量', muscle:'胸', reps:32, weight:60}` |
| 引体向上（合计 30 次，自重） | 次数 `30` / 重量留空 | `{cat:'力量', muscle:'背', reps:30}` |
| 户外跑 32 分钟 5.2km | 时长 `32` / 距离 `5.2` | `{cat:'有氧', muscle:'全身', mins:32, km:5.2}` |
| 燃脂操课 45 分钟 | 时长 `45` | `{cat:'课程', muscle:'全身', mins:45}` |
| 平板支撑 90 秒 | 时长 `1.5` | `{cat:'力量', muscle:'核心', mins:1.5}` |

**字段语义**：`reps` 总次数 · `weight` kg（缺 = 自重）· `mins` 分钟（REAL，支持小数表达秒级：1.5 = 90 秒）· `km` 公里。
**校验**：力量行要求 `reps > 0`；计时行要求 `mins > 0 || km > 0`。空项一律丢弃。

**`cat`/`muscle` 是写入时的快照**：日志项自包含（库里改名、改分类、删条目都不影响历史记录），这是现有 `exName/muscle` 的既有行为。

### 2.2 拍平：删掉 `sets` 数组（本版核心简化）

旧稿为了迁就存量数据，让 `sets` 数组既当"组"又当"段"容器。既然旧运动数据作废（I3），这层容器就没有存在理由：

| | 拍平（本版） | 保留数组（旧稿） |
|---|---|---|
| `app.js` 里的 `sets` 引用 | **0 处**（可由 `grep -c sets` 直接验收） | 36 处 |
| mapper | `put(it,'reps')` 平铺读写 | 循环插 `workout_sets` 子表 |
| 计划 ↔ 日志 | 同形，导入即复制，共用渲染 | 两种形状，要写展开/折算 |
| 「一次一条汇总」 | 与结构一致 | 结构仍是多段，语义错位 |
| 统计 | `Σ weight×reps` 直接遍历 items | 两层循环 |

**连带删除**：
1. **估算 1RM 必须移除**：现有 `bestOfSets` 用 `weight × (1 + reps/30)`，公式前提是 `reps = 单组次数`；现在 `reps = 总次数`（32），代进去会得出 2 倍体重的荒谬值。保留**最大重量 PR（🏆 / `wPR`）**；日志行上的「PR 刷新」`rPR` 文字角标一并删除。
2. **`workout_sets` 表删除**（不再建表，见 §3）。
3. **计划项不再有组数**：计划编辑器只剩「次数 / 重量」或「时长 / 距离」。

### 2.3 归类三层：`cat` › `muscle` › `name`

| 字段 | 管什么 | 取值 | 必填性 |
|---|---|---|---|
| `cat` | **大类** | 力量 / 有氧 / 课程 / 球类 / 柔韧 / 其他 | 必填 |
| `muscle` | **部位**（力量类=肌群；其余=「全身」） | 胸 / 背 / 腿 / 肩 / 手臂 / 核心 / 全身 / 其他 | 必填；其余大类默认 `全身`，也可改（骑行→腿） |
| `name` | **具体做了什么** | 杠铃卧推 / 跑步 / 帕梅拉跳操 / 羽毛球… | 必填 |
| `mode` | **怎么计数**（另一根轴） | `reps` 计次 / `time` 计时 | 必填 |

**库列表一律平铺成表格**（2026-09-06 用户裁定）：`cat`/`muscle` 只是表格里的两列，不是两级标题，任何界面都不再出现分组树。默认按 `大类 → 部位 → 名称` 排序：

| 名称 | 分类 | 方式 | |
|---|---|---|---|
| 杠铃卧推 | 力量 · 胸 | 计次 | 🗑 |
| 引体向上 | 力量 · 背 | 计次 | 🗑 |
| 平板支撑 | 力量 · 核心 | ⏱ 计时 | 🗑 |
| 跑步 | 有氧 · 全身 | ⏱ 计时 | 🗑 |
| 帕梅拉跳操 | 课程 · 全身 | ⏱ 计时 | 🗑 |
| 羽毛球 | 球类 · 全身 | ⏱ 计时 | 🗑 |

四条关键性质：

1. **「力量」讲的是"是什么"，不是"怎么计数"**：平板支撑 = `cat:'力量', muscle:'核心', mode:'time'` —— 仍是力量动作，只是按秒记。所以 `mode` **不能**从 `cat` 反推，必须显式存（`cat` 只给默认值，见 §2.4）。
2. **非力量类的 `muscle` 默认「全身」，它只是表格里的一格文案**（以及将来的部位统计依据），不承担"书架"职责——平铺列表里根本不存在"有氧 › 全身 › 跑步"这种只有一组的层级问题。
3. **首字徽标**：力量行取 `muscle` 首字（胸/背/腿…），其余行取 **`name` 首字**（跑/骑/游）——「全身」「有氧」的首字没有信息量。
4. **一次性命名不需要新库条目**：运动记录头本来就有 `name` 字段（"晨跑"/"周三晚操课"），用不着为每次跑步建库条目。

### 2.4 枚举（`public/js/seed-data.js` 单一数据源）

```js
const SEED_CATS = ['力量','有氧','课程','球类','柔韧','其他'];                    // 大类 cat
const SEED_MUSCLES = ['胸','背','腿','肩','手臂','核心','全身','其他'];           // 部位 muscle
const SEED_MODES = ['reps','time'];
const SEED_MODE_DEFAULT   = { '力量':'reps', '有氧':'time', '课程':'time',
                              '球类':'time', '柔韧':'time', '其他':'reps' };      // 表单默认值
const SEED_MUSCLE_DEFAULT = { '力量':'胸' };                                     // 其余大类 → '全身'
```

- **`SEED_MUSCLES` 去掉 `有氧`**（它现在是大类），**加上 `全身`**。
- **默认值只是预选，不是约束**：选「有氧」也能把骑行标成 `腿`，选「计时」也能是 `核心`（平板支撑）。
- **`其他` 在大类与部位里各有一个**（前者=不属于任何大类的动作，后者=说不清练哪里的动作）；两者不同框出现，实现时别混用同一个常量。

**种子动作**：每条带 `cat`/`muscle`/`mode`；`跑步机慢跑` → `{cat:'有氧', muscle:'全身', mode:'time'}`；`平板支撑` → `{cat:'力量', muscle:'核心', mode:'time'}`；新增计时种子 **跑步、骑行、游泳、跳绳、椭圆机、帕梅拉跳操、燃脂操课、羽毛球** 等。

### 2.5 存储结构（表直接列化）

```sql
plan_items   (user_id, weekday, seq, item_id, ex_id, ex_name, cat, muscle,
              reps REAL, weight REAL, mins REAL, km REAL, PRIMARY KEY(user_id, weekday, seq))
workout_items(user_id, workout_id, seq, item_id, ex_id, ex_name, cat, muscle,
              reps REAL, weight REAL, mins REAL, km REAL, PRIMARY KEY(user_id, workout_id, seq))
-- workout_sets 取消（不再建表）
```
`workouts` / `plan_defs` 表结构不变。`deleteUserData` 的 `USER_DATA_TABLES` 必须去掉 `'workout_sets'`，否则会 DELETE 不存在的表而运行时报错。

---

## 3. 破坏性重置（用户裁定：旧运动数据整体作废）

### 3.1 删除范围

| 删除 | 保留 |
|---|---|
| `plan_defs`、`plan_items`（全部周计划） | `meals`、`meal_days`、食物库（`foods_json`、`system_json.foods`） |
| `workouts`、`workout_items`、`workout_sets`（全部运动日志） | `body_records`、`sleep_sessions`、`water_records`、`habits`、`habit_done` |
| `users.exercises_json`（个人动作库，置 NULL 由客户端以新种子重建） | `accounts`、`sessions`、`users` 其余列（profile/goal/nutrition/theme…） |
| `app.system_json.exercises`（系统库的动作部分 → 新种子） | `app.system_json.foods` |

### 3.2 执行方式（一次性、可判定、幂等）

**判据**：`workout_sets` 表**只存在于旧结构**（新 SCHEMA 不再建它）——它的存在即"这是旧库"。

`server/db.js` 的 `open()` 里，在 `db.exec(SCHEMA)` **之前**插入：

```js
/* v4.11 破坏性重置：旧运动数据结构整体作废（用户裁定 2026-09-06）。
   判据 = workout_sets 存在（新结构不再建该表）→ 天然幂等，绝不复发。 */
function wipeLegacyWorkout(db) {
  if (!tableExists(db, 'workout_sets')) return false;
  ['workout_items','workout_sets','workouts','plan_items','plan_defs']
    .forEach(t => db.exec('DROP TABLE IF EXISTS ' + t));
  db.exec('UPDATE users SET exercises_json = NULL');            // 个人动作库作废
  const row = db.prepare('SELECT system_json FROM app WHERE id = 1').get();
  let sys = {}; try { sys = JSON.parse(row.system_json) || {}; } catch (e) {}
  db.prepare('UPDATE app SET system_json = ? WHERE id = 1')
    .run(JSON.stringify({ foods: sys.foods || [], exercises: seedLibrary().exercises }));  // 只换动作
  return true;
}
```
随后 `db.exec(SCHEMA)` 用新的 `CREATE TABLE IF NOT EXISTS` 建出拍平后的两张表。返回值 `true` 时在启动日志打印一行醒目提示（"已重置旧运动数据"）。

> 实施版加固（2026-09-10 复审）：① 整段包括在 `BEGIN IMMEDIATE`/`COMMIT` 事务里（中途崩溃不会留下「判据已消失、重置只做一半」）；② 额加 `UPDATE users SET rev = rev + 1`——各端脏缓存会被 `converge` 拦成人工裁决，不再静默回推旧形状；③ 客户端 `adoptRaw` 另有旧形状清洗兜底（带 `sets` 的项丢弃、旧个人库整份换新种子），堵住「本机为准」与导入旧备份两条路径。

**备份先行（实施第一步，不可省）**：
```bash
cp server/data/jjhealth.db server/data/jjhealth.db.bak-<日期>-exlib-refactor
```
**不手写 SQL 动用户库**——重置只经由 `db.js` 的启动迁移通道发生。

### 3.3 重置后的一致性

- 客户端 `adoptRaw` 见 `shared.exercises` 为空即用 `seedExArr()` 填充，下次保存写回服务端 ✓
- `plan_defs`/`plan_items`/`workouts`/`workout_items` 重新建表后为空 → 运动页显示空态 ✓
- 多账户：重置对所有账户生效（表级 DROP + 全表 UPDATE）✓

---

## 4. 服务端改动

| 文件 | 改动 |
|---|---|
| `server/db.js` | SCHEMA：`plan_items`/`workout_items` 重定义为拍平版（§2.5），删除 `workout_sets` 建表；`open()` 里 `SCHEMA` 之前调用 `wipeLegacyWorkout()`；`USER_DATA_TABLES` 去掉 `'workout_sets'`；`migrate()` 的 `addColumn` 列表里与运动相关的旧条目清理（新结构一次建好，不再需要补列） |
| `server/mapper.js` | `insertUserData`：`pitemIns`/`wiIns` 都插 `(…, cat, muscle, reps, weight, mins, km)`；**删除 `wsIns` 与 `workout_sets` 相关代码**。`readUserData`：计划项与日志项都按 `put(it,'reps'/'weight'/'mins'/'km')` 平铺读写；**删除 `it.sets = […]` 那段恒写逻辑** |
| `server/seed.js` | `seedLibrary`/`copyLibrary` 携带 `cat`/`muscle`/`mode`（`copyLibrary` 现在只拷 `muscle`，改为三者都拷） |
| `server/server.js` | `sanitizeLibrary`（`:133`）：保留 `cat`（白名单 `SEED_CATS`）、`muscle`（白名单 `SEED_MUSCLES`）、`mode`（白名单 `SEED_MODES`，非法值丢弃）；均 `trim().slice(0,20)` |

不变（刻意的）：个人库/系统库仍是 JSON 整存；API 仍是整树 PUT/GET；`validateUserData` 不用动。

---

## 5. 前端改动（锚点以当前 HEAD 为准）

### 5.1 新公共层（一处定义全局复用）

```js
function itemMode(it){ return (it.mins != null || it.km != null) ? 'time' : (libMode(it.exId) || 'reps'); }
function itemVolume(it){ return (it.weight||0) * (it.reps||0); }      // NaN 防线
function fmtItem(it)   // 力量："32 次 @60kg" / "30 次 · 自重"
                       // 计时："30 分钟 · 5 km" / "45 分钟" / <1 分钟 → "90 秒"
function itemSub(it)   // 副标题：it.muscle || it.cat || ''
function itemBadge(it) // 首字徽标：计时取 exName 首字（跑/骑/游），力量取 muscle 首字（胸/背）
function planLines(it) // 计划卡/概览卡共用的一行文案（= fmtItem）

// 库列表：三处（我的库 / 系统库 / 选择器）共用同一个平铺表格渲染
function libSort(arr)               // 按 大类(SEED_CATS 序) → 部位(SEED_MUSCLES 序) → 名称 排序
function libTableHTML(rows, opts)   // 列：名称 | 分类(`大类 · 部位`) | 方式(计次/⏱计时) | 操作
                                    // opts.action 决定操作列：🗑 删除 / ＋我的库 / 已有 / 选
```

### 5.2 逐点清单（`sets` 引用从 36 处 → 0 处）

| 位置 | 现状 | 改法 |
|---|---|---|
| `exHistory` `:563` | 存 `{date, sets}` | 直接引用 `it`（`exHistory` 目前只被 PR 逻辑用，随 1RM 一起简化） |
| `bestOfSets` `:566` / `isPR` `:574` | 返回 `rm1`，`isPR` 给 `wPR`+`rPR` | 改名 `bestOf(items)`，**删 `rm1`/`rPR`**，只保留最大重量 PR |
| `wkVolume` `:586` | `it.sets.forEach(s => v += s.weight*s.reps)` | `Σ itemVolume(it)`；新增 `wkMinutes(w)`、`wkDistance(w)` |
| `demoData` `:692-716` | 造多组 `sets` | 按新形状造（调试钩子，顺带覆盖计时条目） |
| 概览今日运动卡 `:1019` | `it.sets+'×'+it.reps` | 走 `fmtItem`；副标题走 `itemSub()` |
| `renderPlans` `:1322` | 同上 | 走 `fmtItem` |
| `openPlanEditor` `:1336` | 5 列：动作/组数/次数/重量/× | 4 列：动作/`[次数][kg]` 或 `[分钟][km]`/×；**删组数输入**；与记录弹窗**共用行编辑器** |
| `renderWorkoutList` `:1397` | 逐段文案 + 「PR 刷新」角标 | 走 `fmtItem`；卡头 `容量 X kg`，有计时项时追加 `· 时长 Y 分钟`；删 `rPR` 角标 |
| `openWorkoutDlg` `:1434` | 每组一个「次数×kg」芯片 + 「＋组」 | 行内只剩一组输入：力量 `[总次数][kg]`（留空=自重）；计时 `[总时长]` + 快捷档 `15/30/45/60` + `[距离 km]`。删「＋组」按钮、删 `:1498` 猜重量 hack；收拢过滤改为"至少一字段 > 0"；`importPlan` `:1439` 改为**直接复制**计划项 |
| `openExercisePicker` `:1536` | 按 `muscle` 分组渲染 | 改为**平铺表格**（同一个 `libTableHTML`，操作列 = 「选」）；回调带 `cat/muscle/mode` |
| `openExLib`/`renderExLibMine` `:1547-1592` | 按 `MUSCLES` 分组渲染；新动作只有"肌群"下拉 | **平铺表格**（操作列 = 🗑）；新动作表单 = 名称 + 大类 + 部位（默认 `SEED_MUSCLE_DEFAULT[大类]`）+ 记录方式（默认 `SEED_MODE_DEFAULT[大类]`） |
| `paintSysLib` `:1601` | 同上 | **平铺表格**（操作列 = 「＋我的库」/「已有」）；`importExerciseFromSys` `:1213` 携带 `cat`+`muscle`+`mode` |
| 行内下拉 `exOpts` `:1342`/`:1447` | `<optgroup>` 按 `muscle` | 按 `大类 › 名称` 排序；optgroup 只保留**大类一级**（原生 `<select>` 显示不了列，分组仅作排序分隔）。想彻底平铺就去掉 optgroup，一行的事 |
| `public/css/style.css` | 无表格样式 | 新增 `.libtable` 一小块：表头小字 muted、行高 ~34px、行分隔线、操作列右对齐。**不引入任何新依赖**（AGENTS.md 硬约束） |
| 自动入库存 `:1518-1524` | `{id,name,muscle}` | `{id,name,cat:it.cat\|\|'其他', muscle:it.muscle\|\|'其他', mode:itemMode(it)}`，新 id/cat 回填该行 |
| `seedExArr` `:101` / `MUSCLES` `:83` | 只带 `muscle` | 带三件套；`MUSCLES` 常量改为引用 `SEED_CATS`/`SEED_MUSCLES`/`SEED_MODES` |
| `public/admin.html` `:269-291` | 名称 + 肌群下拉 + 列表显分类 | 加大类与记录方式下拉，部位默认随大类；列表行显 `大类 · 部位 · 计次/计时` |

### 5.3 统计与图表

- 容量 = `Σ weight×reps`（NaN 防线 `itemVolume`）；时长 = `Σ mins`；距离 = `Σ km`。三张口径互不污染。
- 新增 `weeklyMinutes(weeks)`/`weeklyDistance(weeks)`，与 `weeklyVolumes()`（`:2450`，`mondayOf` 分周）同构复用。
- 历史页 `renderStats`（`:2382` 卡片区）在「每周运动容量」下方插入「每周运动时长 · 近12周 · 分钟」，复用 `barChartSVG`；周内距离作为 tooltip 副信息。
- `barChartSVG` `:2293` 的 tooltip 现为 `p.x + ' · ' + fmtVal(p.y)`，加一行可选 `p.tip` 覆盖（向后兼容）。

### 5.4 自检钩子

- `T('workoutCore')` `:2512` 重写：新形状造一条力量（`32 次 @60 = 1920`）与一条计时（`mins:30`），断言容量/时长/PR 三条口径。
- `seedRichMember` 造两条计时日志（一次跑步、一次操课），让 `?selftest` / `?ftest` 渲染到新形态。
- `server/test/render.test.js`：补结构断言（锚定**标题文案**，不要锚 emoji——裸 emoji 会撞习惯图标，见 AGENTS.md）；断言失败修渲染代码，不放宽断言。

---

## 6. 测试与验证

1. **备份**：`cp server/data/jjhealth.db server/data/jjhealth.db.bak-<日期>-exlib-refactor`（B1 第一步）。
2. `cd server && npm test` 全绿，重点：
   - `fixture.json` 全面改新形状：库条目带 `cat/muscle/mode`；计划项与日志项为拍平版（含"无 weight 的自重项"、"无 km 的计时项"两种缺键样本）。
   - `roundtrip.test.js`：断言 PUT→GET 深度相等，特别是**缺键保真**（无 `weight`/`km` 的项读回来不得凭空长出该键）。
   - `admin.test.js`：`sanitizeLibrary` 保留 `cat`/`muscle`/`mode`，丢弃非法 `cat`/`mode`，`全身` 是合法 `muscle`。
   - `render.test.js`：计时行渲染出「分钟」文案、力量行渲染出「32 次 @60kg」、计划卡计时行正确。
3. **迁移验收**（起服务后）：旧库启动打印"已重置旧运动数据"；`plans`/`workouts` 为空；个人库等于新种子；**饮食/身体/睡眠/饮水/习惯原样可读**（这条最关键——重置不能误伤）。
4. `?selftest` / `?ftest` 全 ok（含新增断言）。
5. **部署顺序**（项目记忆规矩）：停服务 → 备份 → 起服务（触发重置与建表）→ 全端强刷；严禁新旧进程混跑。
6. 用户目测清单（浏览器策略禁访本机，agent 只能给清单）：
   - 设置 → 动作库：新种子条目齐全（跑步/骑行/游泳/跳操…，且跑步带 ⏱ 徽标）；新增「爬山（有氧 / 全身 / 计时）」；大类换「力量」时部位默认变「胸」、方式默认变「计次」。
   - 运动页：计划与日志均为空态（旧数据已按裁定清除）；排一条跑步（30 分钟）→ 概览今日运动卡显示「30 分钟」；记录一次跑步 30 分钟 + 5 km，再记一次卧推 32 次 @60kg。
   - 历史页：容量图不再 NaN、数值 = `Σ 重量×次数`；周时长图 = `Σ 分钟`；PR 只剩 🏆。
   - 其它页面（饮食/身体/睡眠/饮水/打卡）数据**完全没变**。

**完成判据（可机械验收）**
- `grep -c "sets" public/js/app.js` → **0**
- `grep -rn "workout_sets" server/` → 仅剩 §3 重置代码里的判据字符串
- `npm test` 全绿；`?selftest`、`?ftest` 全 ok

---

## 7. 实施顺序（4 批，每批独立可验、可停）

| 批次 | 内容 | 验收 |
|---|---|---|
| B1 服务端 + 重置 | 备份 → `db.js`（新表结构 + `wipeLegacyWorkout` + `USER_DATA_TABLES`）→ `mapper.js` 拍平 → `seed-data.js`/`seed.js`/`server.js` → 往返/管理测试 | `npm test` 绿；起服务后旧运动数据已清、非运动数据完好（用 curl 拉 `/api/state` 逐键核对） |
| B2 库管理 UI | `openExLib`/`renderExLibMine`/`paintSysLib`/`importExerciseFromSys`/`admin.html` | 能建/挑入计时动作，大类/部位/记录方式三件套正确 |
| B3 计划与记录 UI | `openPlanEditor`/`openWorkoutDlg`（共用行编辑器）/`openExercisePicker`/`renderPlans`/概览今日运动卡/公共格式化层 | 能排计时计划、能记跑步、`sets` 引用清零 |
| B4 统计与收尾 | 删 `rm1`/`rPR`、`wkVolume`/`wkMinutes`/`wkDistance`、新图卡、自检钩子、`render.test.js` 断言、四项文档 | `npm test` 绿 + 完成判据三条全过 + 用户目测清单通过 |

---

## 8. 文档同步（AGENTS.md 要求）

- `CHANGELOG.md`：新增 **v4.11** 段，**显式记录三件事**：① 破坏性重置（旧运动数据作废、判据与范围）② 移除估算 1RM 与「PR 刷新」角标 ③ 数据结构由 `sets` 数组拍平为列。
- `MEMO.md`：动作库四件套（cat/muscle/name/mode）、运动记录"一次一条汇总"口径、`plan_items`/`workout_items` 列现状与 `workout_sets` 已删除、历史页图表清单、PR 规则。
- `README.md`：功能简介补计时运动，并说明动作库是「名称 / 分类 / 方式」平铺表。
- `PLANS.md` §6：指向本方案，实施后打勾。

---

## 9. 二期候选（本次明确不做）

秒表计时器 · 多段间歇（需重新引入段结构，存储已无此概念）· 单组次数与估算 1RM 回归 · 心率/RPE/坡度（**加列即可**，模型已留口）· 配速（分钟/km）· 距离周汇总卡 · 有氧卡路里估算（MET）· 训练模板套用 · CSV 导出。

---

## 10. 决策状态

| # | 决策点 | 状态 |
|---|---|---|
| 1 | 字段命名：`muscle` 保留装部位，另加 `cat` 装大类 | ✅ **已定**（09-06；早先"改名 muscle→cat"的裁定已撤销） |
| 2 | 归类三层：`cat` › `muscle` › `name` | ✅ **已定**（09-06） |
| 3 | 非力量类 `muscle` 默认「全身」（平铺列表里只是一格文案，不承担分组职责） | ✅ **已定**（09-06） |
| 4 | 取消分段：一次记录只写一条汇总（力量 = 总次数+重量；计时 = 总时长+可选距离），**连带移除估算 1RM** | ✅ **已定**（09-06） |
| 5 | **旧运动数据整体作废**（计划/日志/个人动作库/系统库动作部分），存储层拍平、删 `workout_sets` | ✅ **已定**（09-06 用户裁定，见 §3） |
| 6 | **库列表 / 选择器一律平铺成表格**（名称 \| 分类 \| 方式 \| 操作），任何界面不再出现分组树 | ✅ **已定**（09-06 用户裁定，见 §2.3） |
| 7 | 统计范围 | ✅ 已定（历史页「每周运动时长」图 + 距离 tooltip；概览磁贴不动） |
| — | 实施时机 | ✅ 已实施（v4.11，2026-09-10） |
