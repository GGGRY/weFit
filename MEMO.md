# 健康管理 · 项目备忘录

> 当前版本 **v4.24** · 最后更新 2026-11-03 · 版本变更历史见 [CHANGELOG.md](CHANGELOG.md) · 后续计划见 [PLANS.md](PLANS.md)
> 本文只记**项目定位、功能清单与结构**；交互细节、样式与按钮行为不记（改动前先读代码）。

## 一、项目定位

个人健康管理网页，主线「记录 → 回顾」：饮食、运动、体重围度、睡眠、饮水、目标、历史看板。

**技术形态：零依赖全栈**

- **前端** `public/`：`index.html` + `admin.html` + `css/style.css` + `js/app.js` + `js/seed-data.js` + `js/sleep-shape.js` + `js/slices.js`（+ `js/dev.js` 调试钩子，按需注入）。无构建、无外部依赖，样式/脚本/图标全内联
- **后端** `server/`：Node 内置 `node:http` + `node:sqlite` + `node:crypto`，npm 依赖为零
- **鉴权**：scrypt 密码哈希 + SQLite 持久会话（30 天）+ HttpOnly Cookie；除登录/注册/健康检查/静态页外全部 API 走鉴权中间件
- **数据库** `server/data/wefit.db`：会增长的集合拆为 14 张关系表；profile/goal/nutrition 与个人食物/动作库等形状固定对象用 JSON 列整存保真
- **同步模型（v4.20 切片化）**：同一服务器 + 登录同一账户 = 同一份本人数据；不同账户彼此隔离；localStorage 只是按账户分键的离线缓存，服务器为准。同步粒度 = **片**（`(账户,date)` 或账户级固定块，契约见 `js/slices.js`）：写只写脏片、CAS 按片、冲突只冲突同片
- **启动**：`./start.sh`（Linux/macOS）或双击 `start.bat`（Windows），端口 8123；手机同 Wi-Fi 访问 `http://<电脑IP>:8123`。本机 已配**开机自启**：systemd 用户单元 `~/.config/systemd/user/wefit.service`（样例 `deploy/wefit.user.service`）+ `loginctl enable-linger`，开机/无人登录也在后台跑；此时别再手动 `./start.sh`（会撞 8123 端口），改用 `systemctl --user stop/start/restart wefit`
- **静态资源**：一律 `Cache-Control: no-cache` + `ETag`（大小+mtime），未改动回 `304`、改动即时生效（无构建/无版本号，靠 304 而非 `max-age`）；≥1KB 的文本响应走 gzip；`server.keepAliveTimeout` = 65s。ETag 含 mtime，**不要用「改内容不改 mtime」的方式写文件**
- **种子数据只在服务端**：`js/seed-data.json`（食物 321（USDA）+ 动作 27）由 `server/seed.js` 在 Node 侧 require 建系统库，**浏览器不加载**（用户端走 `GET /api/system/library`）；`js/seed-data.js` 在浏览器只提供枚举/默认值/来源常量

## 二、功能清单

### 1. 概览首页 🏠（`renderHome()`）

- 问候行（时刻问候 + 昵称 + 日期）
- 四 tile（固定）：热量（已摄入/目标）｜BMI（数值 + 分档小字，`bmiTone()`）｜运动（当天已打勾项/全部项，无安排显「休息」）｜打卡（今日完成数/习惯总数）
- 5 张今日卡片:**饮食**(已摄入 vs 目标 + 进度条 + 蛋白/碳水/脂肪三 chip + 当日饮食明细「一餐一行:🍳 早餐 · 名称(不显克数;两列 flex,换行悬挂缩进对齐明细不回退到餐名)」+ 卡底「＋ 添加饮食」直接开记录弹窗;空态居中「＋ 添加饮食」同样直接开弹窗)|**运动**(当天各运动项逐项打卡 + `n/N` + 「添加运动」)|**饮水**(± 步进 + 进度条 + 达标文案;目标 0 = 隐藏本卡)|**睡眠**(全天合计小时 + 达标;逐段一行;「记录一段」)|**打卡**（一行一习惯：名称行 + `n/30 天 · x%` + 连续天数 + 行尾当天圆钮，下面跟同一条 30 格热力格；热力格只读）
- **卡片顺序可拖**（饮食/运动/饮水/睡眠/打卡），存本人状态树 `state.homeOrder`（↔ `users.home_order_json`）；2026-09-13 起不再提供「恢复默认」按钮（要回默认序就自己拖回去）
- 不展示体重 7 天差值、睡眠「今日概览」卡、体重主目标相关卡；习惯的增删改归「设置」页

### 2. 饮食 🍽️

- **周视图**（版式与运动页一致）：顶部周汇总卡（周导航 ‹ › + 「已记录 X/7 天」进度条 + 热量/蛋白/碳水三 chip，非本周多「回到本周」），下面周一→周日每天一张全宽卡：卡头 = 日期 + 今天/当日 kcal + 「＋ 添加饮食」；卡内按早/午/晚/加餐分组展开条目（分组行带该餐小计）；整天空白 = 「未记录」。只换呈现：数据仍是 `state.meals[date]` 四餐形状；营养 = **每100g 营养 × 实际克数**（热量/蛋白/碳水/脂肪）
- **记录弹窗 `addMealDialog`**：顶部 `md_slot` 四段选餐次（早/午/晚/加餐；入口可预选，日卡入口不带预选时按当前时刻粗分默认）；三 tab = 我的库 / 系统库 / 新增（每次打开停在「我的库」，不跨次记忆），底栏共用克数 + 实时合计 + 保存；系统库页可勾「同时保存到我的食物库」（同名标注「已有」），新增页默认不入库、勾选则以「用户」来源入库；库列表固定 38vh 高，三态等高不跳动
- **修改弹窗 `editMealDialog`：只改克数 + 删除**（行内只留 ✏️，周视图下带条目所在日定位）——记录是副本，不开放改营养、不写回食物库
- 饮食页不再显示当日目标进度条；「今日摄入 vs 目标、超标变色」仍在概览页「今日饮食」卡
- **食物库双层**：我的库可增删改（独立子页面 `renderFoodLibPage()`，名称搜索 + 20 条/页分页 + 行内 ✏️/🗑 + 卡头「添加食物」）；系统库只读、同名标「已有」、可「＋我的库」挑入；每行名称旁带「营养来源」小签 `src`（系统库 = USDA / 用户自录 = 「用户」，编辑后改记「用户」）

### 3. 运动 🏋️

- **周视图**：顶部周汇总卡（周导航 + 「已运动 X/7 天」+ 容量/时长/距离 chips），下面每天一张全宽卡（卡头 = 日期 + 今天/`n/N`/未完成 + 「添加运动」；卡内逐项打卡 + 行尾 ✏️；空态「休息日 / 未安排」），非本周多「回到本周」
- **数据模型：一天一条** `{id, date, name, items:[{…, done?}]}`，`done` 在每一项上；添加/修改/删除都是**单项粒度**；任一项打勾即算这天已运动；删掉最后一项 = 那天整条回收
- **单项弹窗 `openItemDlg`**：添加态三 tab（我的库/系统库/新增，同饮食），选中或新增即定「计次 / 计时」（不能自造方式），从系统库选或新增的动作自动并入我的动作库；力量 = 总次数（起步 30）+ 可选重量，计时 = 总时长（起步 20 分钟，预设 15/20/30/45/60）+ 可选距离；修改态只改数值 + 删除
- 运动名（腿日/推日）不上 UI，`name` 字段保留；行内小字 = 「大类 · 部位」
- 统计：只累加已打勾的项，容量 = Σ(重量×次数)；力量项没填重量只显示次数（不自造「自重」）；PR 只比最大重量且只跟更早、已打勾的项比
- **动作库双层**：27 个种子动作，列表行展示（大类·部位·方式，按大类→部位→名称排序）；管理入口 = 独立子页面 `renderExLibPage()`，版式与食物库一致（分页 tab 带条数、名称搜索、20 条/页、我的库行内 ✏️/🗑 + 「添加动作」）；系统库只读、同名标「已有」；运动中出现的动作自动入我的库
- 没有周计划模板：要提前安排就选具体某一天

### 4. 身体数据 📏

- **13 项指标**：体重/胸围/腰围/臀围/臂围/大腿围/小腿围/体脂率 + 收缩压/舒张压（mmHg）+ 空腹血糖/餐后血糖（mmol/L）+ 静息心率（bpm）。清单单一来源 = `MEASURES`（磁贴/趋势下拉/记录表列/记录弹窗/`upsertBody` 白名单同源），每项带 `dec` 小数位；血压两项**只并显示不并存储**（记录表与弹窗均并成一格 `128/82`）
- 卡头两列 = 当前体重 / BMI（等分 grid，左列贴左、右列右对齐）；磁贴显最新值 + 7 天变化；任选指标近 60 条趋势折线 + 历史表格；同日再存自动合并覆盖
- **「⚙ 显示项」自选**：决定磁贴/记录表/趋势下拉/记录弹窗显示哪些指标（一套开关管显示 + 录入），存 `state.bodyHidden`（**存隐藏集**，空数组 = 全显示，老账户零迁移）；血压两项共用一个开关，体重恒勾；隐藏不动已存数据
- 记录体重自动同步「当前体重」（供 BMR 计算）；保存要求至少填体重

### 5. 睡眠 😴（记录在概览页完成）

- **多段**：每段 `{t, bed, wake, mins, quality}`，类型三档（夜间🌙/午睡⛅/其他休息🛋️）；逐段可改可删（弹窗 `sleepSessionEditor`），卡底「记录一段」追加
- 入睡/起床用**自绘上下滑动滚轮**（分钟 5 分档，值写在隐藏 input 里，手机端不弹系统时钟）；质量是五颗星按钮
- **统计口径 = 全天各段总时长**（卡面达标、历史「平均睡眠」、30 天柱状图均按日总和）；记录键 = **起床那天**
- **形状契约 `public/js/sleep-shape.js` 是唯一来源**（类型枚举 / `sleepDur` / `normalizeSleepDay`），服务端 `mapper.js` 直接 require；两侧清洗裁决一致（类型不符丢键、空段丢弃、空数组删键），单日段数 > `SLEEP_MAX_SEGS`(32) 才显式 400

### 6. 设置 ⚙️

六张卡，由 `renderSettings()` 组装：

- **👤 我的档案**：点头像区开弹窗改头像/昵称/标识色；行右端主题切换钮（与侧栏「外观」同一状态）
- **🧍 基础资料**：性别/出生年份/身高/体重，「修改资料」弹窗 `openProfileEditor()`，保存即重算自动目标
- **🥗 营养目标**：kcal + 三大营养素 + 活动量/热量倾向/饮水三 tile（只读值）；「修改目标」弹窗 = 倾向 + 活动量 + 饮水 + 营养素 + 自动计算勾选；倾向减脂 −400 / 保持 / 增肌 +300，自动档 = BMR×活动系数，饮水目标 0 = 不追踪
- **📌 每日打卡管理**：习惯增删改 + ↑↓ 调顺序（`moveHabit`；定义数组序 = 概览页打卡行序 = 落库 seq，零新契约）
- **💾 数据管理**：食物库/动作库子页面入口（带条数）+ 导出/导入备份 + 清空本账户 + 同步状态行
- **🛠 后台管理**：仅 admin，链接 `/admin`
- 最后一颗独立按钮 **⎋ 退出登录**（不在卡片内）

### 7. 历史 📊（视图 id `stats`）

- **6 个汇总卡 + 7 张图表卡**（各占一行竖排），顺序 = `state.chartOrder`（↔ `users.chart_order_json`，可拖，只认卡头抓手 `⠿`；与概览卡共用同一套排序机器）
- 默认序：体重趋势（kg） → 睡眠时长 → 每日热量 vs 目标 → 宏量营养素供能 → 每周运动容量 → 每周运动时长 → 每日饮水量（体重图的 kg 写在标题上，纵轴刻度只印数字）
- 汇总口径统一近 30 天（营养素供能图为近 14 天）
- 「睡眠时长」「每日饮水量」卡头 🕘 补记 → 各自的历史弹窗（翻任意日期查看/补记/修改/删除，改动同步刷新背后页面）
- 2026-09-20：原「习惯打卡」卡**整卡移除**（其 30 格热力格已移到概览页「今日打卡」卡上，见 §1）；习惯的增删改仍在设置页

### 8. 账户体系、管理后台与双层库 👥

- **登录门**：先 `GET /api/me` 探测会话，未登录显示全屏登录/注册页（不可关闭）；**第一个注册的账户自动成为管理员**；`/api/me` 与 `/api/login` 响应带 `version`（来源 = `server/package.json` 的 `version`，补丁位 0 展示时去掉），设置页底部与管理后台页脚显示「weFit vX.Y」小字，登录页不显示、离线时整行不渲染
- **管理后台** `public/admin.html`（`/admin`，页面公开但仅 admin 可用）：系统共享库编辑（食物/动作两子分页，草稿共用，保存 = 一次 PUT 整份，服务端 `sanitizeLibrary` 校验）+ 用户管理（**新建用户**（代建号，不受 `ALLOW_REGISTER` 影响、不下发会话 Cookie、可直建管理员）/列表/设为或撤销管理员（最后一个不可撤）/重置密码（强制下线）/删除账户（级联清数据，不可删自己或最后管理员））；role 每请求现查，被撤者后台立即 403 但用户端照常
- **一账户一档案**，数据完全隔离；用户端零管理功能（admin 多一张「后台管理」卡）
- **双层库**：系统共享库由管理员维护、普通用户只读；我的库**新账户注册时为空**（不拷贝系统库，客户端也不会拿种子填满），可增删改 + 从系统库挑入（按名去重）；系统库不追溯存量/新注册用户
- 离线缓存按账户分键（`wefit_v3:<用户名>`；旧 `jjhealth_*` 键首次读取自动迁移并删除；新旧并存时旧树/meta 有未推送改动则旧键胜出，否则清旧键）

### 9. 数据与同步

- 权威数据在 `server/data/wefit.db`；每次保存 = localStorage 即时落盘 + 600ms 防抖推送脏片（v4.20 起 `PUT /api/slices`，只发真正改过的那几片；值从本机树现取）
- 启动：探测登录态 → 读服务器本人数树（带全量切片 manifest 作基线）→ 不可达则降级读本账户缓存；注册即建档并自动登录
- 离线：照常记录，每 30 秒自动重试，回线自动补推；离线期间关页后重开——服务器没动则静默补推，**只有「本机与服务器都改过的同一片」**才弹窗人工裁决，且只放弃/覆盖冲突片，其余本机改动照常上传
- 冲突：片级 CAS（`user_slices.rev` = 该片最后一次改动时的全局 `users.rev`）；裁决逻辑收敛在 `converge()`（load / 30s 回线 / 409 三入口共用）。前端两份待推清单：`meta.dirtySlices`（与基线**有差异**的片，每次 save 重算，回退到原值即收回）与 `meta.pushSlices`（**必须推但与基线同形**的片：采纳时本机规范化补出的默认值、离线重开时转正的待推片、重挂回树的本机脏片），基线 rev 养在 `meta.dirtyRevs`
- 增量拉取：干净时 30s 轮询先发 `GET /api/slices?since=<全局rev>`（未动只回 `unchanged`，几十字节），变了才用 `?keys=` 拉那几片（**单轮上限 200 片**）并挂回本机树渲染
- **全局游标（`srv.rev`/`meta.rev`）只在这两种情况推进**：① 拿到完整 manifest 且把这一轮的变更**全部**处理完；② 整树 `GET /api/state` 采纳（那一版就是当时的全量）。推送成功只推进**按片基线**，全局游标一次最多 +1 —— `j.rev` 计入了推送在途时别端的写入，直接跳过去会让 `?since=` 漏掉那些片
- 有弹窗在编辑时本轮拉取让路（拉回来的片会换掉树里的对象，弹窗捕获的引用会成孤儿）；`await` 回来后**再查一次**弹窗（这几秒里可能刚打开）
- 旧版缓存兼容：`meta` 里有 `dirty` 但没 `dirtySlices` → 整个会话按旧语义走整树 `PUT /api/state`，一次对齐成功后自动转入按片；整树写会给「旧树里有、新树里没了」的逐日片**立墓碑**（`existingDaySliceKeys`），老账户（切片表为空）的删除也能被按片客户端看见
- 离线启动（本会话从未拿到 manifest）时新改的片，CAS 基线先记 **`null` = 未知**；回线时由 `converge` 按「全局 `users.rev` 有没有动过」判定：没动 = 服务器那一版就是我们当时看到的那一版 → 直接补推并把基线补上（不再对本机自己推过的片弹假冲突），动了 → 人工裁决（宁可多问一句也不静默覆盖）
- 失败语义：**5xx/408/429 = 暂时性**（退避重试，不判死本会话）；**4xx = 请求本身有问题**（`fatal`，状态栏提示刷新）；单片级的 400（坏值/超限/坏 rev）只挂起那一片（状态栏如实显示「N 项数据格式异常未同步」，改好自动放行）
- 未登录访问 `/api/state`、`/api/slices`、`/api/system/library` 一律 401 → 前端清工作区弹登录门；写操作要求 `Content-Type: application/json`；会话 30 天存库
- 导出/导入 JSON 备份只针对本人数据；「清空」只清本账户子树 + 缓存

### 10. 界面与体验

- 卡片 `padding:16px`，卡间 16px（手机 12px）；`.main` 左右 `clamp(12px,3vw,32px)`；概览卡容器手机单列、`≥900px` 两列，5 张卡全带 `data-wide`（宽屏即单列堆叠）
- 响应式：手机底部 Tab / 桌面左侧分组边栏；≤899px 时改滚 `.main`（避免地址栏收起把 fixed Tab 栏拖着跳，作用域只到 `.app` 外壳，不影响 `/admin`）+ 手写下拉刷新 `bindPullToRefresh()`
- 移动端网格列一律 `minmax(0,1fr)`（`.tile` 的 `min-width` 是溢出根因）
- **图表几何按容器真实宽算**（`chartLayout()`/`chartHostW()`）：viewBox 宽 ≈ 容器宽、轴字 11~14px 真像素、图高 210~300px、刻度密度按绘图区宽；日期轴刻度一律 MM/DD，纵轴带单位（睡眠图为小时；**历史页体重图例外**，刻度只印数字、单位写在卡片标题「体重趋势（kg）」），刻度过宽由 `padForTicks()` 补左留白；窗口宽度变化 ≥40px 重画
- **稀疏序列图表走日历轴**（`lineChartSVG` 的 `dateScale`，历史页体重图与身体页趋势图启用）：横轴按真实日期等比，停记空窗留白、缺口断线不跨越；断点阈值 `cut = max(7 天, 2.5×记录间隔中位数)`，按各自记录节奏不误切。逐日补齐的图（睡眠/热量/宏量/饮水）仍是序号等距轴
- **图表取数值**：每点一条整高透明感应带（`hitBands()`）+ `.chart-tip` 气泡——触屏点按留读数、横拖换点、纵拖滚页，桌面悬停跟随
- 深/浅色主题（每账户独立）；手写 SVG 图表；首次引导；Toast；危险操作二次确认
- **调试钩子**（`public/js/dev.js`，命中才按需注入）：`?selftest` 全视图渲染、`?ftest` 15 项功能自测、`?shot=视图名`、`?probe` 数据摘要；前三个会覆盖当前账户为演示数据，共用确认门卫，`&devok` 可跳过

## 三、结构与约定

```
weFit/
├─ start.bat / start.sh         # 启动服务器（端口 8123）
├─ public/                      # 前端（无构建，浏览器直载）
│  ├─ index.html / admin.html   #   用户端骨架 / 管理后台（自包含单文件，/admin）
│  ├─ css/style.css             #   设计令牌 + 组件样式（含登录门/后台）
│  └─ js/
│     ├─ app.js                 #   全部业务 JS + 同步层 + 登录门/双层库 UI（~4.4k 行；定位看 AGENTS.md 锚点表）
│     ├─ seed-data.json         #   食物 321 + 动作 27 种子本体（仅服务端与工具读）
│     ├─ seed-data.js           #   枚举/默认值/来源常量（浏览器用）
│     ├─ sleep-shape.js         #   睡眠形状契约唯一来源（前端 + 服务端 mapper 共用）
│     ├─ slices.js              #   同步切片契约唯一来源（切片键语法/树上取写/人话名，前端 + 服务端 mapper 共用）
│     └─ dev.js                 #   调试钩子 + 演示数据（按需注入，用户路径不加载）
├─ server/                      # 后端（零 npm 依赖）
│  ├─ server.js                 #   node:http：鉴权 + 静态托管（ETag/304 + gzip）+ 登录注册 + 本人数树 + 切片同步 + 系统库 + /api/admin/*
│  ├─ auth.js                   #   scrypt 哈希 / 会话 token / Cookie
│  ├─ db.js                     #   node:sqlite 建表 + 幂等列迁移（14 张表，含 user_slices）
│  ├─ mapper.js                 #   单人数树 ⇄ 关系表 + 逐片读写（不变量：PUT→GET 深度相等；整树与逐片两路写出的形状一致）
│  ├─ seed.js                   #   系统库种子构建
│  ├─ test/                     #   断言：roundtrip 121 · render 229 · admin 63 · migration 41 · slices 27 · sync-http 41 · sleep-shape 17 · auth-https 37，另有 fixture 与一次性维护脚本
│  └─ data/wefit.db          #   SQLite（.gitignore 已排除）
└─ MEMO.md
```

- **前端约定**：业务代码只读写 `state`（当前账户工作副本），`save()` = 写回 + localStorage + `queuePush()`；视图导航收敛在 `go(v)`，视图名与**每页滚动位置**记在 localStorage / 内存，刷新回上次页面；设置页的「食物库/动作库」是不进 `NAV` 的子页面，靠 `SUBVIEW` 声明父级（高亮与刷新落回「设置」）
- **弹窗**：`showDialog` 维护 `dialogStack`，只有栈顶响应 Esc（睡眠编辑器是叠在历史弹窗上再开一层）
- **数据接口**：公开 = `POST /api/register`、`POST /api/login`、`GET /api/health`、静态页；登录后 = `GET/PUT /api/state`（本人数树，`{rev?, data}`，GET 另带 `slices` manifest；rev 过期 409，缺本人键 400）、`GET /api/slices[?since=&keys=]` 与 `PUT /api/slices`（v4.20 按片同步：写只写脏片、CAS 按片、冲突只冲突同片）、`GET /api/me`、`POST /api/logout`、`GET /api/system/library`（PUT 仅 admin）；后台 = `GET /api/admin/users`、`POST /api/admin/users`（新建用户：不受 `ALLOW_REGISTER` 影响、不下发会话 Cookie）、`PUT /api/admin/role`、`PUT /api/admin/password`、`DELETE /api/admin/users`（均仅 admin）
- **同步入口两套并存**：客户端日常走按片 `/api/slices`；`GET/PUT /api/state` 保留作兼容壳（旧客户端、备份导入、测试），整树 PUT 会把所有已知片的 rev 抬到新全局 rev
- 数据同步仍以「单账户整棵子树」为原子边界（写路径只触碰自己那份）；按片只是在此之内把粒度收窄

### 数据库（`server/data/wefit.db` · 建表与迁移见 `server/db.js`）

原则：会增长的集合拆为关系表；形状固定的小对象用 JSON 列整存；有数组语义处带 `seq` 保顺序；成员数据全部 `ON DELETE CASCADE`；迁移用 `PRAGMA table_info` 检查后 `ALTER TABLE ADD COLUMN`。`db.js` 内的破坏性重置（运动项由 `sets` 拍平为列、计划与记录合并为一天一条）判据跑过一次即永假；另有一次性就地补列（`workout_items.done`，不动 rev、只回填一次）。

| 表 | 主键 | 说明 |
|---|---|---|
| `app` | id（恒 1） | 全局单行：`system_json`（系统共享库） |
| `users` | id | 档案：name/avatar/color/activity/water_target + `profile_json`/`goal_json`/`nutrition_json` + `rev`/`theme`/`onboarded` + `foods_json`/`exercises_json`（个人库）+ `home_order_json`/`chart_order_json`/`body_hidden_json` |
| `accounts` | username | 登录账户：user_id（CASCADE）/ pwd（scrypt）/ role（首个注册 = admin）/ created_at |
| `sessions` | token | 会话：username / created_at / expires_at（30 天） |
| `meal_days` | (user_id, date) | 「日期被打开过」标记（4 槽全空也要能还原） |
| `meals` | (user_id, date, slot, seq) | 饮食条目：slot=早/午/晚/加餐, item_id, name, kcal, p, c, f, g |
| `workouts` | (user_id, date) | 运动安排：day_id, name, seq；一天一条（`done` 列已废弃） |
| `workout_items` | (user_id, date, seq) | 运动项：item_id, ex_id, ex_name, cat, muscle, reps, weight, mins, km, `done` |
| `body_records` | (user_id, seq) | 身体 13 项（列名与顺序 = `mapper.BODY_KEYS`，与前端 `MEASURES` 对位）；索引 `idx_body_date` |
| `sleep_sessions` | (user_id, date, seq) | 睡眠多段：t(night/nap/rest), bed, wake, mins, quality(1-5) |
| `water_records` | (user_id, date) | cups |
| `habits` | (user_id, habit_id) | 习惯定义：seq, name, icon, color |
| `habit_done` | (user_id, habit_id, date) | 打卡记录（一行 = 一次打卡） |
| `user_slices` | (user_id, slice) | v4.20 同步切片版本：rev = 该片最后一次改动时的全局 `users.rev`（缺行 = 0）。片被删时**保留行并抬 rev**，否则客户端判不出「服务器删了这片」 |

- 连接参数：`journal_mode = DELETE`（OneDrive 友好）、`synchronous = NORMAL`、`foreign_keys = ON`
- **往返不变量**：单人数树 PUT→GET 深度相等，写路径只触碰本人子树（`test/roundtrip.test.js` 守）；已登记例外 = 按 `sleep-shape.js` 裁决丢弃的脏数据（前端 `ensureUserIntact` 必须同样删键），超 `SLEEP_MAX_SEGS` 是显式 400
- **两路写出必须一致**：`mapper.js` 的整树写（`insertUserData`/`readUserData`）与逐片写（`writeSliceValue`/`readSlice`）**复用同一批小函数**，并由 `roundtrip.test.js` 的 T19 系列拿前端 `writeSlice` 对账——两侧漂移就是互相洗数据

## 四、已知边界与技术债

1. **登录安全**（v4.21 已补公网那一半）：登录失败已按「来源+账户」与「来源」两档限速（内存计数，`LOGIN_MAX_FAILS`/`LOGIN_MAX_FAILS_IP`，触顶 429 + `Retry-After`；**进程重启即清零**，多实例部署需外部共享存储或前置限速）；Cookie 已能在反代后面自动加 `Secure`（`COOKIE_SECURE=auto` + `TRUST_PROXY=1` + `X-Forwarded-Proto`）；注册可关（`ALLOW_REGISTER=0`）。仍缺：无自助改密/删号（找管理员）；建号已由后台代建（`POST /api/admin/users`），用户端不再需要临时开注册；登录门是前端门，接口层才是防线
2. 本账户多设备改**同一片**（同一天同一集合）无法自动合并，仍弹窗人工裁决；改不同片已不冲突（v4.20）
3. 切片剩余粒度问题：`body`（身体记录，seq 是位置语义）与 `lib`（个人库）仍是整片，改一条体重就重写全部体重行；manifest 随历史线性增长（5 年账 ~2000 片 ≈ 60KB，靠 `?since=` 短路把常见轮询压到几十字节）。真要再细/行级合并（updated_at + LWW）或上 Postgres，见 PLANS.md §1
4. 服务器需保持运行，手机记录依赖电脑在线；本机重启不再需要手动拉起（本机 已配 systemd 用户单元开机自启，见「启动」条），换机/其他系统仍手动 `start.sh`/`start.bat`；彻底脱机见 PLANS.md 云端部署
5. 饮水「杯」无 ml 换算；主题不跟随系统
6. **公网部署**（v4.21）：反代 + HTTPS 样例在 `deploy/`（`Caddyfile` / `wefit.service`）；服务端不自做 TLS，公网口径 = `HOST=127.0.0.1` + `TRUST_PROXY=1` + `ALLOW_REGISTER=0`，防火墙只放 80/443。HSTS 先短窗口试跑（Caddyfile 里给了 300 秒起步值）；`X-Forwarded-*` 只在 `TRUST_PROXY=1` 时可信（错配成非回环监听时启动会打印 ⚠）——`X-Forwarded-For` 反代通常是**追加**而非覆写，所以服务端只采信**最后一段**（最近一跳受信反代添的），样例 Caddyfile 也显式覆写它，二者一致才能让限速分桶不被伪造前缀洗牌；已知未做：多实例共享限速状态、审计日志、自助改密

## 五、使用备忘

- **电脑端**：`http://localhost:8123` → 注册（第一个账户 = 管理员）→ 登录即用；**手机端**：同 Wi-Fi 打开启动窗口显示的 `http://<电脑IP>:8123`，各人注册/登录自己的账户
- **管理后台**：`http://<服务器>:8123/admin`，仅管理员可用（普通账户见「无管理权限」）
- **公网部署**：见 README「公网部署（HTTPS 反代）」；上线后启动日志会打印 `HTTPS/Cookie Secure … · 注册开放/已关闭`，据此确认配置生效；默认口径（不设任何环境变量）下本地/局域网明文访问行为与以前完全一致
- **换电脑**：整个文件夹拷走（OneDrive 同步即等价），`server/data/wefit.db` 就是全部数据
- **跑测试**：`cd server && npm test`（sleep-shape 17 + slices 27 + migration 41 + roundtrip 121 + admin 63 + auth-https 37 + render 229 + sync-http 41 项断言）；浏览器 `?ftest` 15 项功能自测（会覆盖为演示数据）
- **同步回归**：`test/sync-http.test.js` = **真链路**端到端（真 `app.js` 同步层 × 真 http 服务 × 真 SQLite，两个 vm 「设备」各带自己的 localStorage 与 Cookie），守「改不同片不互相覆盖 / 只拉变过的片 / 同片冲突只冲突同片 / 旧缓存走整树 PUT 迁移」
- **渲染回归**：`test/render.test.js`（零依赖 `node:vm` + DOM/fetch 桩）守「数据 → 页面 HTML」，布局/配色等视觉表现仍靠目测
- **备份/回滚**：`server/data/wefit.db.bak-<日期>-<主题>` 是逐次留的库备份；**agent 在会让启动跑迁移的重启前必须先新备一份**（见 AGENTS.md）；回滚 = 停服务 → 用 `.bak` 覆盖 `wefit.db` → 启服务。目录不在同步盘里，**没有云端版本历史兜底**
- **清零重来**：设置页 → 数据管理 → 清空数据（仅本账户，先导出留底）；全库重来 = 停服务后删 `server/data/wefit.db`
- **忘记密码**：找管理员在后台「重置密码」；管理员全失联则停服务删库重来（最后手段）
