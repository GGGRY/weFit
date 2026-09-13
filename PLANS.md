# 后续开发计划建议

## 1. 云端部署

本地全栈已就位，上云 = 把同一套代码放到云服务器：

- 任何有固定 IP/域名的 VPS 或 Docker 主机：`node server.js` + 反代 + HTTPS
- 公网部署仍需：反代套 HTTPS + Cookie 加 `Secure`、登录失败限速、（可选）把 SQLite 数据文件放持久卷
- 多账户远程各用各的 = 当前架构即支持；规模再大（几十账户以上/要细粒度端点）时评估 Postgres 重写

## 2. PWA 化

manifest + service worker，手机"添加到主屏幕"像独立 App（app.js 内可做）

## 3. 近期功能小步

复制昨日/上周同餐 ★★★ ｜常用置顶 ★★★ ｜ 套餐组合｜ 单位切换 ｜ CSV 导出 ｜ 月度回顾页

> 记饮食入口已整成**三 tab**（我的库 / 系统库 / 新增 + 共用「克数与实时合计」底栏）：后续做「常用置顶」、「复制上周同餐」或「套餐组合」时直接在这三个面板上加（`addMealDialog`），不要再往单页表单里塞字段。

## 4. 远期可选

营养数据自动查询（中国食物成分表/USDA）、进度照片对比、组间休息倒计时、AI 助手（拍照识别/周报）、穿戴数据接入、教练-家人模式

## 5. 建议执行顺序

**用两周验证同步+账户隔离顺手 → 决定 PWA（登录门配合离线缓存键已为 PWA 留好） → 功能小步走 → 确定要脱离"电脑常开"再上云（补 HTTPS/Secure Cookie/限速）。**

## 6. 添加科学的食物库

## 7. app.js 按页拆分 ES module（彻底重构，暂缓）

背景：agent 改单页样式时整读 app.js（≈2700 行）费 token，现已用 AGENTS.md「锚点定位法」缓解（grep 页面函数 → 分段读）。当锚点法不够用时再做本重构。

触发条件（满足其一再动手）：
- 函数重命名/挪动频繁，锚点清单维护不住、定位仍常读错块
- app.js 突破 ~4000 行，或概览页（renderHome + 睡眠饮水卡 + 打卡）继续膨胀
- 需要按页懒加载提升首屏

方案要点：
- 零依赖约束下用**原生 ES module**（`<script type="module">`，无构建工具），按现有 `/* ===== */` 分块切文件：`js/pages/home.js`、`diet.js`、`train.js`、`body.js`、`life.js`（睡眠饮水）、`settings.js`、`stats.js`、`profile.js`，公共层留 `js/core/`（store/sync/util/ui 框架如 showDialog/toast）
- 难点是现在的隐式全局单例 `state`/`save()`：需先收敛成显式导入的模块（如 `core/store.js` export state/save），页面模块只 import 自己用到的，避免循环依赖
- `index.html` 入口改 module script；admin.html 不受影响
- 迁移策略：先抽 `core/`，再逐页搬，每搬一页跑一遍手动验证 + `npm test`，不一次性大爆改

## 9. 同步切片化（L1）——已实施（2026-09-13 完成；下面保留开工时的计划原文，实测见 9.8）

### 9.1 目标 / 非目标

目标（对应 MEMO §四-3「同步粒度为本账户整树」这条技术债）：

1. **写放大归零**：一次打勾/加一杯水只写它所在的那一片，不再重写全账户所有行。
2. **冲突面收窄**：两台设备改不同日期互不冲突；只有「同一天同一集合」才 409，且裁决只作用于冲突片。
3. **增量传输**：30s 回线只拉「变过的片」，不再整树 35KB。

非目标（本轮不做）：行级 LWW / UpdatedAt、Postgres、SSE 推送、把 `body` 拆成逐日片。

### 9.2 切片语法（`(账户, date)` 为天然单位）

固定片 4 个（对应 `users` 一行）＋ 逐日片 5 类：

| slice key | 值 = 状态树里哪一块 | 落库 |
| --- | --- | --- |
| `profile` | name/avatar/color/activity/waterTarget/profile/goal/nutrition + theme/onboarded + homeOrder/bodyHidden/chartOrder | `users` 行各列（一条 UPDATE） |
| `lib` | `shared.foods` + `shared.exercises` | `users.foods_json` / `exercises_json` |
| `body` | `state.body`（整数组，seq 保序，**不拆日**） | `body_records` 全表（本用户） |
| `habits` | `state.habits` 的**定义**（id/name/icon/color + 顺序） | `habits` 表（写时清孤儿 `habit_done`） |
| `meals:<date>` | `state.meals[date]`（四槽对象，含 meal_days 标记） | `meals` + `meal_days` 该日 |
| `workouts:<date>` | `state.workouts` 里 date 匹配的那一项 | `workouts` + `workout_items` 该日 |
| `sleep:<date>` | `state.sleep[date]` 段数组 | `sleep_sessions` 该日 |
| `water:<date>` | `state.water[date]`（杯数） | `water_records` 该日 |
| `habitdone:<date>` | 各习惯在该日的打卡集合 | `habit_done` 该日 |

- 值 `null` / 键缺失 = 删除该片（`habitdone:<date>` 空集合即删除）。
- 键语法/日期格式/读值/写值只此一份：新增 **`public/js/slices.js`**（浏览器全局 + 服务端 `require`，与 `sleep-shape.js` 同一套共用模式）。
- `body` 保持整片、`habits` 定义与逐日打卡分开：前者 seq 是位置语义拆日会错位，后者拆开才能让「同一天打卡」冲突面收窄。

### 9.3 服务端

- 表 `user_slices(user_id, slice, rev, PRIMARY KEY(user_id, slice))`，`rev` = 该片**最后一次改动时的全局 `users.rev`**（单调，不做独立计数器）。
  - 片被删除时**保留行并抬 rev**（否则客户端用 `remoteRev > baseRev` 判不出「服务器删了这片」）。
  - 缺行 = rev 0。
- 接口（都挂在登录后，鉴权中间件之后）：
  - `GET /api/slices[?since=<globalRev>]` → `{rev, slices:{key:rev}}`；`since` ≥ 当前全局 rev 时直接回 `{rev, unchanged:true, slices:{}}`（30s 轮询的常见路径，免传整份 manifest）。
  - `GET /api/slices?keys=a,b` → 追加 `values:{key:value}`（拉变过的片）。
  - `PUT /api/slices` body `{slices:{key:{rev?, value}}}` → 事务内逐片 CAS（`rev` 缺省 = 盲写）→ 200 `{rev, slices}`；任一冲突 → 409 `{error:'rev_conflict', rev, conflicts:{key:{rev,value}}}`（值一并带回，供客户端裁决，不必二次请求）。
  - 上限：单片请求 ≤ 500 片、未知键 400 `unknown_slice`、`sleep:<date>` 段数沿用 `SLEEP_MAX_SEGS` 显式 400。
  - `GET /api/state` / `PUT /api/state` **原样保留**（旧客户端/整树备份导入/测试仍在用）：GET 追加 `slices` manifest，PUT 成功后把所有已知片（含已删片）的 rev 抬到新全局 rev。
- `mapper.js`：把 `insertUserData`/`readUserData` 拆成「每片一读一写」并在整树路径里复用（保证整树与逐片写出的形状必然一致，不靠两处手抄）；新增 `sliceRev/sliceManifest/readSlice/writeSlices`。

### 9.4 客户端（`app.js` 同步层）

- `save()`：落盘后若整树串与 `srv.baseTree` 不同，则按片比对快照算出**脏片集合**，并入 `meta.dirtySlices`（跨标签页取并集），并记 `meta.dirtyRevs`（脏片的基线 rev，供重载后精确 CAS）。
- `doPush()`：只推脏片（值从本机树现取）；**不再带全局 rev**，CAS 按片；响应更新 `srv.sliceRevs` / `srv.base` / 清理脏片（沿用 `meta.gen` 判「期间有没有新编辑」）。
- `converge()`（启动/回线）：脏片 ∩ 服务器变过的片 = ∅ → 直接采纳服务器树 + 把本机脏片重挂回去推送（**不弹窗**，这是本轮最大体验改动）；非空 → 弹窗，且只对冲突片二选一，其余脏片照常推送；文案列出冲突片的人话名（`sliceLabel()`，如「9月13日 饮食」）。
- `retrySync()`：先推脏片；干净时用 `GET /api/slices?since=` 探一下，变了才 `GET /api/slices?keys=` 拉变过的片 → `writeSlice()` 挂回本机树 → 落盘 + `materialize()` + `go(curView)`。
- **兼容老缓存**：`meta.dirty` 为真但 `dirtySlices` 不是数组（旧版 meta）→ 走旧整树路径（`PUT /api/state` + 原弹窗语义），一次 `save()` 后自然迁移到按片。
- 状态栏「数据版本」仍显示全局 rev；`?ftest`/`?selftest` 演示数据与 `localStorage` 分键契约不变。

### 9.5 测试与验收

- 新增 `server/test/slices.test.js`：`slices.js` 纯函数（键语法、`sliceKeysOf`、`sliceValue`/`writeSlice` 往返与删键、`sliceLabel`）。
- `roundtrip.test.js`：整树往返仍深度相等（回归）；逐片 PUT→GET 与「客户端 `writeSlice` 结果」深度相等（防两侧漂移）；逐片 CAS 409；删片后 manifest rev 抬升；`habits` 写时的孤儿打卡清理；`since` 短路；未知键/超限/睡眠段数 400。
- `render.test.js`：启动链改为带 `slices` manifest 的桩；新增断言——脏片只推脏片（`PUT /api/slices` 收到且只收到脏片）、干净轮询走 `since` 短路、拉到变过的片能挂回并重渲染。
- 验收：`cd server && npm test` 全绿；另起临时库（`DB_PATH=… PORT=8124`）用 curl 走一遍注册→逐片写→整树读→冲突；真实服务按「停服务 → 启服务 → 全端刷新」重启并复核 `/api/health`。

### 9.6 步骤

1. `public/js/slices.js` + `index.html` + `STATIC_FILES` + `server/test/slices.test.js`（纯函数层）
2. `server/db.js`（建表）＋ `server/mapper.js`（拆片读写 + 切片 API 落库层）→ 跑 `roundtrip.test.js` 回归整树路径
3. `server/server.js`（三条路由 + `/api/state` 带 manifest）＋ roundtrip 的逐片用例
4. `public/js/app.js` 同步层改造 + `render.test.js` 桩与断言
5. 文档（CHANGELOG/MEMO/README/AGENTS 锚点）＋ 全量 `npm test` ＋ 临时库 curl 冒烟 ＋ 重启真实服务

### 9.7 风险

- **两侧形状漂移**（最大风险）：靠「整树路径复用逐片写函数」+ 逐片用例与客户端 `writeSlice` 对账来堵。
- **跨标签页脏片丢失**：`meta.dirtySlices` 取并集、推送成功后只清自己推过的片，沿用 `meta.gen` 判新编辑。
- **manifest 体积**：5 年账 ~2000 片 ≈ 60KB（gzip 后个位数 KB）；用 `?since=` 短路把常见轮询压到 ~40B。

### 9.8 完成情况（2026-09-13）

按 9.6 的五步做完，计划与实现一致，无偏差。落地清单：

- `public/js/slices.js`（切片契约唯一来源）+ `index.html` / `STATIC_FILES` 加载位；`server/db.js` 新增 `user_slices`；`server/mapper.js` 把整树读写拆成逐片小函数并新增 `sliceRev`/`sliceManifest`/`readSlice`/`writeSliceValue`/`writeSlices`；`server/server.js` 新增 `GET/PUT /api/slices`（`since` 短路、`keys` 拉值、整批原子 CAS）并给 `GET /api/state` 加 `slices` manifest；`public/js/app.js` 同步层改为「脏片推送 + 分片 CAS + 冲突裁决只作用于冲突片 + 干净时增量拉取」，旧缓存自动走整树 PUT 迁移。
- 测试：`slices.test.js` 27 项、`roundtrip` +40 项（T19 系列）、`render` +44 项（T20 系列）、新增 `sync-http.test.js` 35 项（真链路：真 `app.js` × 真 http × 真 SQLite，多个 vm「设备」）——`npm test` 共 **501 项断言**全绿（sleep-shape 17 + slices 27 + migration 41 + roundtrip 121 + admin 46 + render 214 + sync-http 35）。
- 实测：两台设备改不同日期互不覆盖且不弹窗；同片冲突只放弃冲突项、同一批里其余脏片照常上传；干净轮询走 `since` 短路（几十字节）；450 片脏自动分两批推完且一片不漏；旧版 meta 走整树 PUT 后自动转入按片；「改完关页 → 在线/离线重开」两路都保住本机改动（`sync-http` E16 系列，先确认过它在旧写法下真的会失败）。
- **六轮对抗式复核（同日）** 共修 31 处，其中两处是真丢数据：启动裁决要在读本机树之后（旧写法 `USERS` 还是 null，脏值被读成 null 再重挂回树 = 删掉本机改动）；离线重开推进基线前必须把待推片转成「必须推」清单（否则被当「已对齐」清空）。另修：只读渲染物化空饮食日、服务端按定义过滤打卡、单片 400 使整个同步 `fatal`、`?since=` 漏片、`?keys=` 无上限、干净启动不挂轮询。第三轮又揪出 8 处：同批拉回「定义 + 打卡」的顺序（新习惯的勾会静默丢）、`habitdone` 值形状跟着习惯顺序变（假脏片导致全量重推）、冲突裁决 `markBase` 把弹窗半编辑烤进基线、推送在途时拉远端盖回编辑、`writeSliceValue` 未落地却回 200、形状表第二份抄写、users 行列映射两处手抄。第四轮（收敛）又补 5 处：400 挂起的片用户改好后本会话仍被挡着（冷启动被旧值盖掉）、离线冷启动基线伪装成 0 导致回线弹假冲突并可能丢掉刚做的编辑、拉取期间落地的非模态编辑被远端旧值盖掉、`doPush` 部分出口不接轮询、采纳失败后残留盲写标记。第五轮（跨文件调用链）再补 6 处，其中最重的一条是**拉取分批饿死**：一轮 manifest 报 >200 片变更时旧写法把全局游标推到服务器当前 rev，下一轮 `?since=` 被短路，剩下的片**永远拉不回来**；同族的还有「推送成功把游标跳到 `j.rev`（含别端在途写入）」。另修：拉取的弹窗保护要在 `await` 回来后重查、`habitdone` 读路径与整树同口径 + 推送 payload 定义先行、冲突前先做内容比对（同值不弹窗、不盲写）、以及**把 render 的 fetch 桩改成「整批共享一个新全局 rev」**——正是旧桩按片各抬一次，掩盖了游标这类缺陷。第六轮（移除行为澄清）再补 5 处：**整树 PUT 给被删的逐日片立墓碑**（老账户切片表为空时，老客户端的删除谁也看不见、之后还会被 rev 0 复活）、非数字 CAS 基线归一 + `invalid_slice_rev` 纳入隔离（脏缓存会造成刷新即复现的死循环）、睡眠片发出前先归一（PUT 必须等于 GET，否则基线记错且无自愈通道）、坏片挂起期间不谎报「同步正常」、5xx/408/429 改判为暂时性（fatal 只留给 4xx）。全部在测试里钉住（B1 系列 / T20v-y / T19E-G，均先确认旧写法会红）。

**后续可选（不在本轮）**：`body` / `lib` 再拆细；行级 `updated_at` + LWW 合并（同片冲突也不必弹窗）；manifest 换增量协议；上云后换 Postgres（见 §1）。
第三轮审查另记三条「择机收」的债：① 脏片/必须推片/基线 rev 三份清单的并剪逻辑手写在 8+ 处，宜收成一个 pending map（现在靠注释与测试守一致性）；② `user_slices` 的已删片墓碑永不回收，多年后片数只增（manifest 体积同因）；③ 服务端逐片写每次 `prepare`、客户端每轮 `sliceSnap` 序列化 3~4 次全树——量级都还小，等真的卡了再优化。

