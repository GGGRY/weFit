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

## 
