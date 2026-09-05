# 健康管理 · 项目备忘录

> 更新：2026-09-05（**v4.1：独立管理后台 /admin** · v4：账户鉴权 + 数据隔离 + 双层资源库；同日 v3.2：睡眠饮水记录并入概览页，导航页移除）｜ v3.1：概览/目标页信息架构整理 + 移动端适配 ｜ v3（2026-09-04）：前端 + 后端 + SQLite 架构，解决跨设备同步 ｜ 旧单文件版存档于 `legacy/index.html`

## 一、项目定位

个人健康管理网页，主线「制定计划 → 记录 → 回顾」：饮食、训练、体重围度、睡眠饮水、目标、统计看板。

**技术形态（v3）**：零依赖全栈
- **前端** `public/`：`index.html` + `css/style.css` + `js/app.js` 三文件，无构建工具，样式/脚本/图标仍全内联零外部依赖
- **后端** `server/`：Node 内置 `node:http` + 内置 `node:sqlite` + 内置 `node:crypto`，**npm 依赖为零**，`node server.js` 即起
- **鉴权**（v4）：scrypt 密码哈希 + SQLite 持久会话（30 天）+ HttpOnly Cookie；除登录/注册/健康检查/静态页外全部 API 走鉴权中间件
- **数据库** `server/data/jjhealth.db`：集合型数据拆为 18 张关系表（餐次/训练/身体/睡眠/饮水/习惯/账户/会话…），profile/goal/nutrition 与个人食物/动作库等形状固定对象 JSON 列整存保真
- **同步模型**：同一服务器 + **登录同一账户** = 读写同一份本人数据，天然同步；**不同账户彼此隔离**；浏览器 localStorage 降级为按账户分键的离线缓存，服务器为准数据源
- **启动**：Windows 双击项目根目录 `start.bat`，Linux/macOS 运行 `./start.sh`（或 `cd server && node server.js`），端口 8123
- **手机访问**：与电脑同 Wi-Fi 时打开 `http://<电脑IP>:8123`（服务器启动窗口会打印可用地址）

## 二、已实现功能清单

### 1. 概览首页 🏠（v3.1 重排，聚合"今天的事"；v3.2 睡眠饮水记录迁入）
- 今日四 tile：热量摄入/目标、体重、训练状态、打卡完成数
- **今日饮水 + 今日睡眠两卡（v3.2 自「睡眠饮水」页迁入）**：饮水 −/＋ 步进 + 进度条 + 达标文案；睡眠记入睡/起床/质量，可改删当天；卡右上角 🕘「补记」开历史弹窗，翻日期查看/补记/修改/删除过去记录
- 快捷操作：「记录本次训练」一键开练（自动带入当日周计划）——旧 💧喝水 +1 已随今日饮水卡并入（饮水操作统一在新卡内）
- 今日饮食卡：摄入 vs 目标（"还差/已超 xx%"紧跟标签文字）+ 进度条 + **蛋白/碳水/脂肪三 chip**（仅当天有饮食时显示）
- **每日打卡卡从「目标」页移入**（近 7 天网格 + 🔥连击 + 新习惯添加），打卡后原地刷新概览
- 页面顺序：问候+tile → 今日饮食 → 今日计划 → 今日饮水/今日睡眠 → 每日打卡
- 已移除：体重 7 天差值小字、"今日概览"卡（睡眠/BMI 不在首页展示）、"主目标"卡（目标进度归「目标」页）

### 2. 饮食 🍽️
- 早/午/晚/加餐四餐次记录，可前后翻页回看任意日期补记
- 营养模型：食物按 **每100g 营养 × 实际克数** 自动换算（热量/蛋白/碳水/脂肪）
- 添加弹窗：从食物库带入 → 改克数 → 实时预览合计；可勾选「同时存入食物库」；支持编辑/删除
- 每日汇总对比目标，超标进度条变色提醒
- 食物库（v4 双层）：**我的库**可增删；**系统库**由管理员维护、只读，可一键「＋我的库」挑入

### 3. 训练 🏋️
- **周计划**：周一~周日各安排一个计划（名称 + 动作×组×次×重量，自重留空）
- **训练日志**：逐动作逐组记 次数×重量；可从周计划一键导入再改；可编辑/删除历史
- **PR 检测**：保存时对比历史，刷新最大重量 🏆 / 刷新估算 1RM（Epley 公式）标「PR 刷新」
- **动作库**（v4 双层：我的库 | 系统库）：18 个种子动作按肌群分组，训练中出现的新动作自动入我的库
- 每次训练容量统计 Σ(重量×次数)

### 4. 身体数据 📏
- 7 项指标：体重/胸围/腰围/臀围/臂围/大腿围/体脂率；可按任意日期补记，同日再存自动合并覆盖
- BMI 圆环；各指标最新值 + 7 天变化
- 任选指标近 60 条趋势折线（体重图含目标虚线）；历史表格 + 查看全部
- 记录体重自动同步「当前体重」（供 BMR 计算）

### 5. 睡眠与饮水 💧😴（v3.2：并入概览页，原导航页已移除）
- 概览页「今日饮水 / 今日睡眠」两卡就地记录当天：睡眠记入睡/起床（自动算时长、跨零点正确）、质量 1-5 星；饮水每日目标杯数 ±1 快捷 + 进度条
- 卡右上角 🕘「补记」→ 历史弹窗：daynav 翻任意日期查看/补记/修改/删除（原独立页能力完整保留，入口收进概览）
- 睡眠归属语义不变：记录键 = 「起床那天」
- 两张趋势图仍在统计页（v3.1 迁入）

### 6. 目标 🎯（导航原名"目标打卡"，v3.1 改名；打卡已迁至概览）
- 主目标：减脂(-400kcal)/保持/增肌(+300kcal)，起点/目标/期限 → 完成度环 + 每周节奏评估
- **每日目标卡（原"每日营养目标"）**：只显示目标值不显示当日进度——kcal hero + 蛋白/碳水/脂肪三 tile + 活动量/每日饮水两 tile
- 「修改目标」统一弹窗：自动计算勾选 + 活动量 + 饮水目标 + 四大营养素；自动模式改活动量即时重算
- **⚙️设置弹窗瘦身为纯"基础资料 + 数据管理"**：活动量、饮水、营养目标设置全部移出设置（v3.1），设置保存不再触碰营养目标（自动模式经 syncNutrition 重算，手动模式保留原值）

### 7. 统计 📊
- 8 个汇总卡 + 6 张图（体重趋势/热量对比/营养素供能/每周训练容量 + **睡眠时长、每日饮水量**（近 14 天柱状，并排一行；记录在概览页完成））

### 8. 账户体系、管理后台与双层资源库 👥（v4 + v4.1）
- **登录门**：打开页面先 `GET /api/me` 探测会话；未登录显示全屏登录/注册页（不可关闭）；**第一个注册的账户自动成为管理员**
- **管理后台（v4.1）**：独立页面 `public/admin.html`，访问 `http://<服务器>:8123/admin`——页面公开但只有 admin 登录后可用（非管理员看到"无管理权限"页）
  - 系统共享库编辑（食物/动作增删 + 保存）
  - 用户管理：账户列表（昵称/角色/注册时间/数据概况/rev）+ **设为/撤销管理员**（护栏：最后一个管理员不可撤销）+ **重置密码**（被重置账户全部会话强制下线）+ **删除账户**（FK 级联清空全部记录；不可删自己/最后管理员）
  - 权限即时生效：role 每请求现查；被撤者后台立即 403，但其**用户端账户照常使用**
- 一账户一档案：一个账户 = 一份成员档案，数据完全隔离；顶栏胶囊改为「我的档案」（改昵称/头像/颜色 + 退出登录），成员切换/增删退役；**用户端零管理功能**，admin 的档案弹窗里只有一行「进入后台管理 →」链接
- **双层库**：系统共享库（管理员在后台 `/admin` 维护，普通用户只读）+ 我的库（注册时整份拷贝系统库；可增删，可从系统库页一键挑入，按名去重）
- 系统库更新**不追溯**已注册用户已有的个人库（要新条目去系统库页挑）
- 离线缓存按账户分键（`jjhealth_v3:<用户名>`），同一浏览器多人互不污染
- 说明：v3 及以前库里已有的成员数据自 v4 起**不再展示**（既定决策"从零开始"）；需要留底用旧版导出功能或保留 db 文件副本

### 9. 数据与同步（v4 架构）
- **权威数据**在 `server/data/jjhealth.db`；每次保存：localStorage 落盘（即时，本人键）+ 600ms 防抖 `PUT /api/state`（异步，**只写本人子树**）
- **启动顺序**：探测登录态 → 读服务器本人数树（局域网毫秒级）→ 服务器不可达降级读本账户缓存；注册即建档并自动登录
- **离线**：已登录过的账户照常可记录（缓存键隔离），每 30 秒自动重试，服务器恢复后自动补推（首推前从服务器树捕获本人 uid 并本地重挂）
- **离线期间关了页面（v4.1）**：本机关闭前若有未推送改动，重开时与服务器比对——服务器没动 → **静默自动补推**；服务器前进了（本账户其他设备写过）→ **弹窗人工裁决**（采用服务器 / 本机覆盖），两个方向都不会静默丢改动。实现：`jjhealth_v3meta:<用户名>` 存 `{rev, dirty}`，save 置 dirty、推送成功复位
- **冲突**：**每用户独立 rev**；运行中本账户另一设备先写会触发 409 弹窗由用户裁决（同上两选一）；其他账户的写入永远不会与本账户冲突
- 鉴权语义：所有 `/api/state`、`/api/system/library` 等未登录一律 401 → 前端清工作区弹登录门；写操作要求 `Content-Type: application/json`；会话 30 天存库，服务器重启不掉线
- ⚙️设置弹窗顶部显示同步状态行（登录账户 / 版本 rev / 最近同步时间 / 离线提示）
- 导出/导入 JSON 备份功能保留（**只针对本人数据**；导入多人备份时取其中"当前成员"一份重挂为本账户数据）；「清空」只清本账户子树 + 本账户缓存
- 备份文件在 OneDrive 目录内 = 自动获得异地备份 + OneDrive 版本历史

### 10. 界面与体验
- 响应式：手机底部 Tab / 桌面左侧分组边栏；弹窗手机端底部升起
- **移动端适配（v3.1 修复）**：`.tile` 自带 `min-width:130px` 是多列网格溢出根因，网格列一律 `minmax(0,1fr)` + 子项 `min-width:0`；每日目标五 tile 自适应收窄；概览打卡区改为**左列名字固定 + 右侧 7 天格横向滚动**（≤560px 圆钮缩至 27px、行高两列严格对齐）
- 深/浅色主题（v4 起每账户独立）；手写 SVG 图表；首次引导；Toast；危险操作二次确认
- 开发调试钩子：`?selftest` 全视图渲染、`?ftest` 13 项功能自测、`?shot=视图名`、`?probe` 数据摘要

## 三、代码结构速览

```
JJ_HealthManagement/
├─ start.bat                    # Windows 双击启动服务器（端口 8123）
├─ start.sh                     # Linux/macOS 启动服务器（端口 8123）
├─ public/                      # 前端（无构建，浏览器直载）
│  ├─ index.html                #   页面骨架
│  ├─ admin.html                #   管理后台（v4.1 自包含单文件；/admin 路由）
│  ├─ css/style.css             #   设计令牌 + 组件样式（含登录门/后台样式）
│  └─ js/app.js                 #   全部业务 JS + 同步层 + 登录门/双层库 UI
├─ server/                      # 后端（零 npm 依赖）
│  ├─ server.js                 #   node:http：鉴权中间件 + 静态托管 + 登录/注册 + 本人数树读写 + 系统库 + /api/admin/*
│  ├─ auth.js                   #   scrypt 密码哈希 / 会话 token / Cookie 解析（node:crypto）
│  ├─ seed.js                   #   系统库种子（与前端 SEED_* 同步）+ 个人库初始拷贝
│  ├─ db.js                     #   node:sqlite 建表 + 幂等列迁移（18 张表，每用户 rev）
│  ├─ mapper.js                 #   单人数树 ⇄ 关系表；不变量：PUT→GET 深度相等（只触碰本人子树）
│  ├─ test/roundtrip.test.js    #   55 项断言：鉴权 + 双账户隔离 + 系统库权限 + 形状保真 + 规模压测
│  ├─ test/admin.test.js        #   38 项断言：后台 API（角色/重置密码/删号 + 护栏）
│  └─ data/jjhealth.db          #   SQLite 数据库（.gitignore 已排除）
├─ legacy/index.html            # 旧单文件版（离线可用，回退参考）
└─ memo.md
```

- **前端核心约定**不变：业务代码只读写 `state`（当前成员工作副本），`save()` = 写回成员 + localStorage + queuePush()；同步层函数集中在 `load()` 之后（fetchState / doPush / queuePush / handleConflict / refreshSyncStatus）
- **页面归属（v3.2）**：每日打卡渲染函数 `habitCardHTML()` + `bindHabitEvents()` 由概览 `renderHome()` 调用；`openNutritionEditor()` 是"每日目标"统一编辑弹窗（营养+活动量+饮水）；睡眠/饮水趋势图函数 `renderSleepChart/renderWaterChart` 挂在 `renderStats()`，容器 id `st_sleep`/`st_water`；今日饮水/今日睡眠卡 = `lifeTodayHTML()` + `bindLifeToday()`（`lifeWaterCard/lifeSleepCard/bindLifeCard` 以 ctx `home`/`dlg` 双上下文复用——概览今日卡与历史弹窗 `openLifeHistory()/renderLifeDlg()` 共用一套渲染与绑定，睡眠修改走 `sleepQuick(d, sl, after)`）
- **数据接口（v4 / v4.1）**：公开 = `POST /api/register`、`POST /api/login`、`GET /api/health`、静态页（含 `/admin`）；登录后可用 = `GET/PUT /api/state`（**本人数树**，`{rev?, data}`——rev 过期 409、缺省盲写；服务端只取 `data.users[本人uid]` 那一份，其余键忽略，缺本人键则 400 拒绝防误清空）、`GET /api/me`、`POST /api/logout`、`GET /api/system/library`（**PUT 仅 admin**）；**后台 API（仅 admin，v4.1）** = `GET /api/admin/users`（列表+数据概况）、`PUT /api/admin/role`（设/撤管理员，防"最后一个管理员"）、`PUT /api/admin/password`（重置并强制该账户下线）、`DELETE /api/admin/users`（删账户级联清数据，不可删自己）
- **API 仍是"整树 state"风格**（v4 粒度收窄为单账户）：细粒度 CRUD 端点留待未来按需追加，mapper 后的关系表结构已支持

### 数据库结构（`server/data/jjhealth.db` · 18 张表，建表与列迁移见 `server/db.js`）

设计原则：会增长的集合拆为真正关系表；profile/goal/nutrition 与个人库等形状固定的小对象用 JSON 列整存保真；有数组语义处一律带 `seq` 保证顺序往返一致；成员数据全部 `REFERENCES users(id) ON DELETE CASCADE`；v4 幂等迁移用 `PRAGMA table_info` 检查后 `ALTER TABLE ADD COLUMN`（旧库文件直接升级，v3 及以前的旧成员数据保留但不再读取）。

| 表 | 主键 | 说明 |
|---|---|---|
| `app` | id（恒为 1，单行） | 全局单行：`system_json`（**系统共享库**，管理员维护）；theme/active/rev 为遗留列，v4 起不再读写 |
| `users` | id | 成员档案：seq, name, avatar, color, activity, water_target + `profile_json` / `goal_json` / `nutrition_json` + **v4 新列**：`rev`（每用户乐观并发）/ `theme` / `onboarded` / `foods_json` / `exercises_json`（**个人食物/动作库**） |
| `accounts` | username | **v4 登录账户**：user_id（绑定档案，CASCADE）/ pwd（`scrypt$盐$哈希`）/ role（首个注册 = `admin`，其余 `user`）/ created_at |
| `sessions` | token | **v4 会话**：username / created_at / expires_at（30 天，存库 = 服务器重启不掉线） |
| ~~`foods`~~ / ~~`exercises`~~ | id | 旧全局共享库：v4 起为遗留表不再读写（系统库改存 `app.system_json`） |
| `meal_days` | (user_id, date) | "日期被打开过"标记——餐次 4 槽全空也要能原样还原 |
| `meals` | (user_id, date, slot, seq) | 饮食条目：slot=早/午/晚/加餐, item_id, name, kcal, p, c, f, g |
| `plan_defs` | (user_id, weekday) | 周计划头：plan_id, name |
| `plan_items` | (user_id, weekday, seq) | 周计划动作：item_id, ex_id, ex_name, muscle, sets, reps, weight |
| `workouts` | (user_id, workout_id) | 训练日志头：date, name, note（seq 保留列） |
| `workout_items` | (user_id, workout_id, seq) | 训练动作项：item_id, ex_id, ex_name, muscle |
| `workout_sets` | (user_id, workout_id, item_seq, seq) | 逐组 reps×weight；用 `item_seq` 引用所属动作项而非 item_id（主键列不能 NULL，旧数据可能缺 id） |
| `body_records` | (user_id, seq) | 身体 7 项：weight/chest/waist/hip/arm/thigh/bf；主键用 seq 因旧版导入可能同日多条；索引 `idx_body_date(user_id, date)` |
| `sleep_records` | (user_id, date) | bed, wake, mins, quality(1-5) |
| `water_records` | (user_id, date) | cups |
| `habits` | (user_id, habit_id) | 习惯定义：seq, name, icon, color |
| `habit_done` | (user_id, habit_id, date) | 打卡记录（一行 = 一次打卡） |

- **连接参数**：`journal_mode = DELETE`（不留常驻 -wal 边文件，OneDrive 同步友好）、`synchronous = NORMAL`、`foreign_keys = ON`
- **往返不变量**（mapper.js）：单人数树 PUT→GET 深度相等——JSON 列与关系表拆分/重组必须保形状，且写路径只触碰本人子树，`test/roundtrip.test.js` 55 项断言守此约定（含双账户隔离与系统库权限）

## 四、已知边界与技术债

1. ~~**无鉴权**~~ **v4 已解决**：scrypt 登录 + 30 天持久会话 Cookie + 每用户独立数据；~~管理员无法管理他人~~ **v4.1 后台已解决**（设/撤管理员、重置密码、删账户）。残余债务：登录失败**无限速/锁定**；Cookie 未加 `Secure`（局域网 http 可接受，**公网部署必须先上 HTTPS**，否则密码与 Cookie 明文过网）；**无本人自助改密/删号**（需找管理员在后台操作）；登录门为前端门，接口层才是真防线（静态页本身公开，属预期）
2. 本账户多设备各改各的无法自动合并（二选一人工裁决覆盖另一方）；裁决 UX 已覆盖运行中回线与关闭后重开两种场景（v4.1）
3. 同步粒度为本账户整树（v4 已比旧版"整库"安全——不再波及其他账户；个人数据量下 PUT/GET 实测 <20ms）；数据量增长后可上细粒度端点
4. ~~存储键 `jjhealth_v2`~~ **v4 已解决**：`jjhealth_v3:<用户名>` 按账户分键；旧键不再读写（残留可手动清）
5. 服务器需保持运行：电脑重启后 Windows 双击 `start.bat`，Linux/macOS 运行 `./start.sh`；手机记录依赖电脑在线（彻底脱离电脑 → 云端部署，见五.1）
6. 图表 hover 用原生 title；饮水"杯"无 ml 换算；主题不跟随系统（沿袭旧版）

## 五、后续开发计划建议

### 1. 云端部署（原 B1 的延续，替代方案A/B 之争）
本地全栈已就位，上云 = 把同一套代码放到云服务器：
- 任何有固定 IP/域名的 VPS 或 Docker 主机：`node server.js` + 反代 + HTTPS
- ~~前置必做：鉴权中间件~~ **v4 已就位**；公网部署仍需：反代套 HTTPS + Cookie 加 `Secure`、登录失败限速、（可选）把 SQLite 数据文件放持久卷
- 多账户远程各用各的 = 当前架构即支持；规模再大（几十账户以上/要细粒度端点）时评估 Postgres 重写（方案 B）

### 2. PWA 化
manifest + service worker，手机"添加到主屏幕"像独立 App（app.js 内可做）

### 3. 近期功能小步（沿用旧计划 A 档）
复制昨日/上周同餐 ★★★ ｜ 食物库搜索+常用置顶 ★★★ ｜ 套餐组合 ｜ 打卡 30 天热力图 ｜ 单位切换 ｜ CSV 导出 ｜ 月度回顾页

### 4. 远期可选
营养数据自动查询（中国食物成分表/USDA）、进度照片对比、组间休息倒计时、AI 助手（拍照识别/周报）、穿戴数据接入、教练-家人模式

### 5. 建议执行顺序
**用两周验证同步+账户隔离顺手 → 决定 PWA（登录门配合离线缓存键已为 PWA 留好） → 功能小步走 → 确定要脱离"电脑常开"再上云（补 HTTPS/Secure Cookie/限速）。**

## 六、使用备忘

- **启动**：Windows 双击 `start.bat`，Linux/macOS 运行 `./start.sh`（保持窗口开启 = 服务在线）
- **电脑端**：浏览器打开 `http://localhost:8123` → **注册**（第一个账户 = 管理员）→ 登录即用
- **手机端**：同一 Wi-Fi 下打开启动窗口显示的 `http://<电脑IP>:8123`，每人注册/登录**自己的账户**，互不干扰；自己多设备用同一账户登录 = 自动同步
- **管理后台**：浏览器访问 `http://<服务器>:8123/admin`，仅管理员账户可登录；普通用户即使在登录页输对了密码也会看到"无管理权限"提示
- **v4 升级说明（一次性）**：旧成员数据不再展示（既定"从零开始"）；想留底请在升级前用旧版运行导出备份，或直接保留 `jjhealth.db` 文件副本
- **换电脑**：整个文件夹拷走（OneDrive 同步即等价），`server/data/jjhealth.db` 就是全部数据（含账户与会话）
- **跑测试**：`cd server && node test/roundtrip.test.js && node test/admin.test.js`（55 + 38 项断言）；浏览器 `?ftest` 13 项功能自测
- **清零重来**：⚙️设置 → 🗑清空（仅本账户，服务器同步清本人子树，不可恢复，先导出留底）；**全库重来**：停服务后删除 `server/data/jjhealth.db`
- **忘记密码**：找任一管理员在后台「用户管理 → 重置密码」处理（该账户会被强制下线）；若所有管理员都失联：停服务删库重来（最后手段）
