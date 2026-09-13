# weFit · Agent 规则

## 硬约束
- 零依赖全栈:前端无构建、后端只用 Node 内置模块。未经用户明确要求,禁止新增任何 npm 依赖或引入构建工具。
- 约束边界:上述规则只管**运行产物**(`public/` 与 `server/` 执行路径);`server/test/` 下的验证工具不受限,为自动化验证添加工具无需逐次确认(用户裁定 2026-09-06)。
- `server/data/jjhealth.db` 是用户真实数据,禁止直接改动、清空或迁移。

## 常用命令
- 启动:`./start.sh`(端口 8123);测试:`cd server && npm test`。

## 本地验证路由(必读,别再撞墙)
- **浏览器工具进不了本机服务**:宿主浏览器策略固定拦截回环与私有网段(localhost / 127.x / 192.168.x 全部 `browser navigation blocked by policy`,当前版本无开关)。禁止再用浏览器工具测本地地址,也禁止换端口/换 IP 写法重试浪费回合。
- 各验证通道:接口/数据 → Bash `curl http://localhost:8123`(不受策略限制);逻辑回归 → `cd server && npm test`;**UI 视觉效果 → 请用户在自己的浏览器打开 `http://localhost:8123` 查看**,agent 无法截图本地页面,只能靠 API 响应 + 代码审查间接确认。
- 前端渲染逻辑的自动化验证**已落地零依赖路线**:`server/test/render.test.js`(node:vm + 迷你 DOM/fetch/localStorage 桩,复用 fixture.json 树真实走完 init→/api/me→/api/state→渲染),已并入 `npm test`。
  - 改渲染函数/数据形状后:给新卡片或新契约**补结构断言**再跑 `npm test`;启动冒烟、六页导航、卡片显隐、多段合计、营养换算已在覆盖。断言失败修渲染代码,不要放松断言。
  - 桩的锚点:网络出口收敛在 `srvFetch()`;`$$` 恒返回 [] 故事件绑定全 no-op(交互路径不在范围);裸 emoji(如 💧)会撞习惯图标,断言要锚定卡片标题文案。
  - 调试钩子与演示数据住在 `public/js/dev.js`(v4.16 起按需注入):测试里要用它们就 `vm.runInContext(readPub('js/dev.js'), ctx)` 手动加载(T15a 先断言主包不含 `demoData`/`DEMO_FOODS`,T15a2 再断言 dev.js 单独加载即可用);改动钩子后必须过一次真实浏览器(`?selftest` + `?ftest`)。
  - 种子数据:桩的 `fakeFetch` 会记录对 `seed-data.json` 的请求(断言前端不请求它,T15a);改种子/演示库契约时同步改桩与 T15a/T15b。
  - 同步切片(v4.20):桩的 `fakeFetch` 同时充当服务端(带 `MANIFEST`/`SLICE_VALUES`/`SLICE_PUSHES` 与**真正的按片 CAS**),要用到 `js/slices.js` 就把 `readPub` 加载列表一起改(两个 vm 测试都是 `seed-data → sleep-shape → slices → app.js` 这个顺序);脏片推送/分批/冲突裁决在 T20 系列。
  - 真链路的自动验证另有一个文件:`server/test/sync-http.test.js`(真 `app.js` 同步层 × 真 http 服务 × 真 SQLite,多个 vm「设备」各自带 localStorage/Cookie;含「改完关页 → 在线/离线重开补推」这两条最容易丢改动的回归)。改同步层、`/api/slices` 或切片契约时,**两个文件都要跑**(已并入 `npm test`);动启动/离线/冲突路径时,记得在 `sync-http.test.js` 里补一条「带未推送缓存的启动」用例(现成写法见 E16 系列)。
  - 不能验:布局/间距/配色等视觉表现——样式类改动仍靠用户目测;确需测 DOM 事件流时可引入 jsdom 类 devDependency(见硬约束边界,无需再确认),但默认用现有桩补断言。

## 样式 / 单页修改定位法(省 token,必须遵守)
- 禁止为小样式改动整读 `public/js/app.js`(≈4.4k 行)。该文件按页面分块,先 grep 下面锚点拿行号,再用 Read 的 offset/limit 只读目标函数附近(单次 ≤400 行)。
- 样式共三处,按改动性质只查需要的那处:
  1. 全局类/主题 → `public/css/style.css`(≈300 行,可整读;分节:主题变量/布局骨架/卡片与通用/弹窗/登录门)
  2. 页面结构与内联 style → app.js 渲染函数,锚点(函数名 grep 即得行号):
     概览 `renderHome`/`tileHTML`/`homeCardsHTML`/`homeDietCardHTML`/`homeWorkoutCardHTML`/`tagCard`/`bindHomeSort`/`resolveHomeOrder`/`mergeOrder`/`habitCardHTML` · 饮食 `renderDiet`/`addMealDialog`（三 tab：我的库/系统库/新增）/`editMealDialog`（只改克数+删除）/`mealPrevHTML`/`foodRowHTML` · 训练 `renderTrain`/`renderWorkoutWeek`/`dayCardHTML`/`exRowHTML`/`bindItemChecks`/`openItemDlg`（三 tab：我的库/系统库/新增，修改态只改数值+删除）/`itPickOf`/`exTriple`/`exOwnedTipHTML`/`delItem`/`collectItems` · 动作库页 `renderExLibPage`/`exLibRowHTML`/`exLibCmp`/`openExAdder`/`openExEditor`/`applyExEdit`/`exDupInMine` · 数据管理子页面 `renderFoodLibPage`/`renderExLibPage`/`openFoodAdder`/`openFoodEditor`/`applyFoodEdit`/`foodDupInMine`/`libMatchName`/`libClampPage`/`libPagerHTML`（路由见 `SUBVIEW`/`navActiveId`） · 身体 `renderBody`/`openBodyDialog`/`renderBodyChart` · 睡眠饮水卡 `lifeWaterCard`/`lifeSleepCard`/`bindLifeToday`/`renderSleepChart`/`renderWaterChart` · 睡眠段编辑弹窗与时间滚轮 `sleepSessionEditor`/`timeWheelHTML`/`timeWheelMount`/`twSet`/`twParts`（样式 `public/css/style.css` 的 `.twheel`；`--tw-h` 必须与 app.js 的 `TW_ITEM_H` 一致） · 设置 `renderSettings`/`habitSettingsCardHTML`/`profileCardHTML`/`openProfileDialog`/`themeToggleHTML`/`adminCardHTML`/`openNutritionEditor` · 历史 `renderStats`/`legendHTML`/`renderHabitChart`/`habitGridHTML`（图表卡顺序 = `state.chartOrder`，默认序 8 key `CHART_ORDER_DEFAULT`；习惯卡只读热力格） · 图表几何 `chartLayout`/`chartHostW`/`tickStep`（vw）· 图表取数值 `hitBands`/`bindChartTip`/`ctipShow`/`lineChartSVG`/`barChartSVG`/`groupedBarSVG`（气泡样式 `.chart-tip`） · 基础资料 `openProfileEditor` · 弹窗框架 `showDialog` · 主题 `applyTheme`/`setTheme`
  3. 页面外壳 → `public/index.html`(小文件)
  4. **同步切片**(v4.20,不在页面分块里,单独 grep):契约在 `public/js/slices.js`(`sliceValue`/`writeSlice`/`sliceKeysOf`/`serializeSlice`/`sliceLabel`/`isValidSliceKey`);客户端同步层在 app.js 的 `切片同步工具` 段(`sliceSnap`/`diffSliceKeys`/`markBase`/`markBaseIfIdle`/`promoteDirtyToForce`/`pushKeys`/`dirtyKeysSinceBase`/`detectLegacy`;两份待推清单 `meta.dirtySlices` 与 `meta.pushSlices` 的区别见 MEMO §9)与 `服务器同步层` 段(`fetchState`/`adoptRemote`/`converge`/`reapplyLocalSlices`/`doPush`/`pushLegacy`/`applyPushResult`/`handleConflict`/`legacyArbitration`/`retrySync`/`changedSliceKeys`/`applyRemoteSlices`/`scheduleNextPoll`/`markAllSlicesAt`/`conflictMsg`);服务端落库层在 `server/mapper.js`(`writeMealDay`…`readLib` 这一批逐片小函数 + `sliceRev`/`sliceManifest`/`readSlice`/`writeSliceValue`/`writeSlices`),路由在 `server/server.js` 的 `handleState`。
- 新增页面/函数后,若命名或归属变了,顺手同步上面的锚点清单;若清单已维护不住,参考 PLANS.md §8 的 ES module 拆分方案(需用户确认后再动手)。

## 每次修改后必做
- 改完服务端/前端代码,部署必须走「停服务 → 启服务 → 全端刷新」再验证;禁止新旧进程混跑测试(整树 PUT 会互相覆盖丢数据)。
- **重启前先备份真实库**:任何会让服务端启动时跑建表/迁移的重启(改 `db.js`/SCHEMA/迁移,或自己不确定),先留一份带日期的备份——`cp --preserve server/data/jjhealth.db server/data/jjhealth.db.bak-YYYYMMDD-<topic>`(服务在跑时用 `VACUUM INTO '...'` 取一致快照更好,它只写目标文件、不碰源库)。理由:`server/data/jjhealth.db` 是唯一一份真实数据,这个目录**不在** OneDrive 等同步盘里,没有云端版本历史可回退;回滚 = 停服务 → 用 `.bak` 覆盖 `jjhealth.db` → 启服务。
- 静态资源已带 `ETag`+`Cache-Control: no-cache`(v4.16):刷新时自动 304 复用,**改完前端不需要手动清缓存/加版本号**;但服务端 `serveStatic` 的内存缓存 key = (size, mtime),别用「改内容不改 mtime」的方式写文件。
- 浏览器侧**不加载**种子数据本体（v4.16）：`SEED_FOODS`/`SEED_EXERCISES`/`seed-data.json` 只归服务端（`server/seed.js`）；用户端要系统库走 `GET /api/system/library`；调试钩子（`?selftest`/`?ftest`/`?shot`/`?probe`）与演示数据住在 `public/js/dev.js`，按需注入（要改演示库就改 dev.js 里的 `DEMO_FOODS`/`DEMO_EXERCISES`），不要把这些加回 app.js。
- **同步切片的规则只写一份**（v4.20）：哪一块状态算哪片、值长什么样、怎么读怎么写，全部住在 `public/js/slices.js`（浏览器先于 app.js 加载 + `mapper.js` require）。新增字段/新集合时：先决定它属于哪片（无特殊理由就放进 `profile` 那片）→ 两边共用 `sliceValue`/`writeSlice` → 再让 `mapper.js` 的逐片 SQL 读写跟上；**禁止**在服务端另抄一份切片边界或在客户端手写脏标记（写入口有几十处，漏一处就是静默不同步）。
- `mapper.js` 的**整树写与逐片写必须复用同一批小函数**（`insertUserData`→`writeMealDay`… / `readUserData`→`readMealDay`…）：两条路写出不同形状 = 整树客户端与按片客户端互相洗数据。改逐片函数后跑 `npm test` 里的 `roundtrip` T19 系列（拿前端 `writeSlice` 对账）。
- 提交前跑 `cd server && npm test` 确认通过。

## 每次提交前必做
- 检查并按需更新文档:CHANGELOG.md、MEMO.md、README.md、PLANS.md。

## 文档分工 (请按需读取)
- 架构与功能详情 → MEMO.md;版本历史 → CHANGELOG.md;后续计划 → PLANS.md。本文件只放 agent 必须遵守的规则。
