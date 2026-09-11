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
  - 不能验:布局/间距/配色等视觉表现——样式类改动仍靠用户目测;确需测 DOM 事件流时可引入 jsdom 类 devDependency(见硬约束边界,无需再确认),但默认用现有桩补断言。

## 样式 / 单页修改定位法(省 token,必须遵守)
- 禁止为小样式改动整读 `public/js/app.js`(≈2700 行)。该文件按页面分块,先 grep 下面锚点拿行号,再用 Read 的 offset/limit 只读目标函数附近(单次 ≤400 行)。
- 样式共三处,按改动性质只查需要的那处:
  1. 全局类/主题 → `public/css/style.css`(≈300 行,可整读;分节:主题变量/布局骨架/卡片与通用/弹窗/登录门)
  2. 页面结构与内联 style → app.js 渲染函数,锚点(函数名 grep 即得行号):
     概览 `renderHome`/`tileHTML`/`habitCardHTML` · 饮食 `renderDiet`/`openFoodLib`/`foodRowHTML` · 训练 `renderTrain`/`renderWorkoutWeek`/`dayCardHTML`/`exRowHTML`/`bindItemChecks`/`openItemDlg`/`delItem`/`collectItems`/`libTableHTML`/`openExLib`/`renderExLib` · 身体 `renderBody`/`openBodyDialog`/`renderBodyChart` · 睡眠饮水卡 `lifeTodayHTML`/`renderSleepChart`/`renderWaterChart` · 设置 `renderSettings`/`habitSettingsCardHTML`/`openNutritionEditor` · 历史 `renderStats`/`legendHTML` · 档案 `openProfile`/`openProfileEditor` · 弹窗框架 `showDialog` · 主题切换 `applyTheme`
  3. 页面外壳 → `public/index.html`(小文件)
- 新增页面/函数后,若命名或归属变了,顺手同步上面的锚点清单;若清单已维护不住,参考 PLANS.md §8 的 ES module 拆分方案(需用户确认后再动手)。

## 每次修改后必做
- 检查并按需更新文档:CHANGELOG.md、MEMO.md、README.md、PLANS.md。
- 改完服务端/前端代码,部署必须走「停服务 → 启服务 → 全端刷新」再验证;禁止新旧进程混跑测试(整树 PUT 会互相覆盖丢数据)。
- 提交前跑 `cd server && npm test` 确认通过。

## 文档分工 (请按需读取)
- 架构与功能详情 → MEMO.md;版本历史 → CHANGELOG.md;后续计划 → PLANS.md。本文件只放 agent 必须遵守的规则。
