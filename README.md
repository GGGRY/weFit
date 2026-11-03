# weFit · 健康管理

个人健康管理网页：概览 / 饮食 / 运动 / 身体数据 / 历史 / 设置。饮食按餐记录（**我的库 / 系统库**双层食物库，从库选只填吃了多少克）；运动分**计次 / 计时**两类，一天一条、逐项打勾；身体、睡眠、饮水、习惯打卡按天记录，营养目标与基础资料在设置页维护。多设备登录**同一账户**自动同步（按「片」粒度上传/下载，断网照常记录、恢复后补推）。

零 npm 依赖全栈（Node 内置 `http` + `sqlite` + `crypto`），`node server.js` 即起。

## 快速开始

```bash
./start.sh          # Linux/macOS（Windows 双击 start.bat）
```

浏览器打开 `http://localhost:8123`（手机：同一 Wi-Fi 下打开启动窗口打印的电脑 IP 地址）。

## 开机自启（本机 · 局域网，免 sudo）

个人机上想让 weFit 开机就在后台跑、不用每次手动 `./start.sh`：用 systemd **用户级**单元 + linger（用户未登录也启动）。仓库自带样例 `deploy/wefit.user.service`（路径/`node` 版本按你机器改，用法在文件头）。

```bash
mkdir -p ~/.config/systemd/user
cp deploy/wefit.user.service ~/.config/systemd/user/wefit.service   # 先按文件头改对 node 绝对路径
systemctl --user daemon-reload
systemctl --user enable --now wefit          # enable=开机自启，--now=这次立刻起
loginctl enable-linger $USER                 # 关键：不开这个， logout / 没人登录时服务不拉起
```

之后：`systemctl --user status wefit` 看状态，`journalctl --user -u wefit -f` 看日志，`systemctl --user stop wefit` 停（想临时手动跑就先停它，避免端口占用）。这份只管局域网监听（0.0.0.0:8123）、不套 HTTPS、保持可注册——**只适合家里/可信网络**；公网仍要走下面反代方案并关注册。

## 公网部署（HTTPS 反代）

服务端自己不做 TLS：把 443 交给反代（Caddy/nginx），weFit 只监听回环。仓库自带两份可直接用的样例：`deploy/Caddyfile`（Caddy 自动申请/续期证书）与 `deploy/wefit.service`（systemd 守护）。

```bash
# 1) 反代（把 Caddyfile 里的域名换成你的，DNS 需指到本机、80/443 可达）
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
# 2) 服务端只监听回环 + 采信反代头 + 关注册
HOST=127.0.0.1 TRUST_PROXY=1 ALLOW_REGISTER=0 node server.js   # 或改 deploy/wefit.service 后 systemctl enable --now wefit
# 3) 防火墙只放行 80/443，8123 绝不暴露公网
```

启动日志会打印当前口径，例如 `HTTPS/Cookie Secure auto（信 X-Forwarded-Proto） · 注册已关闭`，对照一眼就能确认配置吃上了。

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `COOKIE_SECURE` | `auto` | `auto` = 仅当 `TRUST_PROXY=1` 且反代上报 `X-Forwarded-Proto: https` 时给会话 Cookie 加 `Secure`；`1` 强制加、`0` 强制不加 |
| `TRUST_PROXY` | 关 | 置 `1` 才采信 `X-Forwarded-Proto` / `X-Forwarded-For`。注意 `X-Forwarded-For` 反代通常是**追加**而非覆写，所以服务端只取**最后一段**（最近一跳受信反代添的）——若取首段，攻击者带个随机前缀就能把限速桶洗牌绕过限速。样例 Caddyfile 已显式覆写该头，两边一致 |
| `ALLOW_REGISTER` | 开 | `0` 关闭注册（返回 403 `register_closed`）。公网务必关闭——**首个注册账户自动成为管理员**，公开注册等于把后台交给第一个访客 |
| `LOGIN_MAX_FAILS` / `LOGIN_MAX_FAILS_IP` | 5 / 20 | 同一来源对同一账户 / 同一来源对任意账户的失败上限，触顶锁 `LOGIN_BLOCK_MS`（默认 15 分钟），返回 429 + `Retry-After` |
| `LOGIN_WINDOW_MS` / `LOGIN_BLOCK_MS` | 15 分钟 / 15 分钟 | 失败计数窗口与封锁时长 |
| `HOST` / `PORT` / `DB_PATH` | `0.0.0.0` / `8123` / `server/data/wefit.db` | 监听地址/端口与数据库位置（`DB_PATH` 请指向会被备份的持久位置） |

> **本地/局域网明文访问不受影响**：默认口径下明文 HTTP 不加 `Secure`，`./start.sh` 与手机同网访问照旧。只有显式 `COOKIE_SECURE=1` 才会让明文 HTTP 登不上（启动日志会警告）。

**首次公网上线顺序**：先在本地 `./start.sh` 注册好管理员账户（第一个账户）→ 确认数据无误 → 停服务并备份 `server/data/wefit.db` → 按上面三步起反代与服务（`ALLOW_REGISTER=0`）→ 浏览器与手机各登录一次验证同步。

**验收**：`curl -I https://<域名>/api/health` 应为 200；`curl -I http://<域名>/` 应 301 到 https；`curl -sv -X POST https://<域名>/api/login -d '{"username":"x","password":"y"}' -H 'Content-Type: application/json'` 的 `Set-Cookie` 应带 `Secure`（登录失败时不下发 Cookie，所以先用真实账户验证）。另可验证限速分桶确实只认最后一跳：连续带**不同的伪造前缀、相同的末段**请求（如 `-H 'X-Forwarded-For: 1.1.1.$i, <真实IP>'`）应稳定累计并最终 429，而不是每次都当新来源。

**上线后维护**：新增账户走管理后台「用户管理 → 新建用户」（不受关注册影响，公网部署下就是唯一建号入口）；数据库定时备份见 MEMO.md 使用备忘（`VACUUM INTO` 取一致快照）。

**日常升级 / 回滚**（在服务器上执行，脚本随仓库更新）：

```bash
sudo /opt/wefit/deploy/update.sh                  # 备份库 → git pull --ff-only → 重启 → /api/health 检查
sudo /opt/wefit/deploy/rollback.sh --list         # 查看可回滚的版本标签与最近的数据库备份
sudo /opt/wefit/deploy/rollback.sh v4.23          # 只回滚代码
sudo /opt/wefit/deploy/rollback.sh v4.23 --restore-db /var/backups/wefit/wefit-xxx.db   # 代码 + 数据库一起恢复
```

默认路径与 `deploy/wefit.service` 一致（`/opt/wefit`、`/var/lib/wefit/wefit.db`、服务名 `wefit`、备份目录 `/var/backups/wefit`），可用同名环境变量覆盖；数据库备份用内置 `node:sqlite` 的 `VACUUM INTO`，不依赖系统 `sqlite3` 命令。升级脚本会拒绝有未提交修改的代码目录，并在 `db.js`/`seed.js` 变更（启动时跑迁移）时提示；**发版前的 `npm test` 必须在开发机上跑**，脚本只负责上云后的拉取与重启。

## 账户与数据隔离

- 打开页面需**注册/登录**，每个账户只看得见、改得动自己的数据；多人同时使用互不影响。
- 同一人的手机 + 电脑登录**同一账户** = 自动同步（服务器为准，浏览器留离线缓存）。同步按**片**粒度（一天饮食/一天饮水/一次打卡…各算一片）：只上传你真正改过的那几片，其他设备也只下载变过的片。
- 会话 30 天有效，服务器重启不掉线；退出登录：右上角头像胶囊 → ⎋ 退出登录。
- 断网照常记录；恢复后自动补推。若离线期间还关了页面、且本账户其他设备**改过同一片**，重开会就那几项弹窗让你二选一（其余本机改动照常上传），不会悄悄丢改动。
- 食物/动作是**双层库**：人人有自己的"我的库"（可增删改——食物行尾 🗑 左侧的 ✏️ 可改名称与四项营养，改过的条目**营养来源**改记「用户」；系统库分页只读，没有 ✏️/🗑），公共"系统库"由管理员在后台维护、对所有人只读，可一键挑进我的库。食物条目带**营养来源**（`src`）小签：系统库条目 = `USDA`，用户自己录入的 = 「用户」，从系统库挑入的沿用其来源。动作带三层信息——**大类**（力量/有氧/球类/柔韧/其他）、**部位**（胸/背/腿/肩/手臂/核心/全身）、**记录方式**（计次/计时），库列表是列表行（名称 + 「大类 · 部位 · 方式」小字）。

## 管理后台（仅管理员）

访问 `http://<服务器>:8123/admin`（管理员在用户端设置页「🛠 后台管理」卡里也有入口链接）。非管理员账户登录后台会看到"无管理权限"页。

- **系统共享库**：分「食物库 / 动作库」两个子分页，各用一颗「＋ 添加」按钮开弹窗录入（列表行尾 🗑 删除；食物弹窗可填**营养来源**，默认 `USDA`），保存后对所有用户的"系统库"页生效
- **用户管理**：查看全部账户（含数据概况）；**新建用户**（填用户名/昵称/初始密码，可选直接建成管理员；不经用户端注册入口，所以关注册后也照常能建号）；**设为/撤销管理员**（系统至少保留一名）；**重置密码**（该账户全部设备强制下线）；**删除账户**（级联清空其全部记录，不可恢复）

## 目录

- `public/` 前端（无构建：`index.html` + `admin.html` + `css/style.css` + `js/seed-data.js` + `js/sleep-shape.js` + `js/app.js`；`js/dev.js` = 调试钩子，仅在 URL 带 `?selftest/?ftest/?shot/?probe` 时按需加载）
- `server/` 后端 + `data/wefit.db`（SQLite，全部数据都在这里）
- `deploy/` 公网部署样例（`Caddyfile` 反代 + `wefit.service` systemd 单元）
- `MEMO.md` 项目备忘录（架构、功能、技术债、使用备忘）
- `CHANGELOG.md` 版本变更日志
- `PLANS.md` 后续开发计划建议

## 测试

```bash
cd server && npm test                        # 一次跑完下面八个文件
     node test/roundtrip.test.js   # 鉴权 + 双账户隔离 + 往返保真 + 按片同步（写入/CAS/删片/墓碑/兼容整树，121 项）
     node test/admin.test.js       # 管理后台 API：新建用户/角色/重置密码/删号护栏 + 系统库三件套白名单（63 项）
     node test/auth-https.test.js  # 公网部署安全：登录限速 / Cookie Secure / 关注册 / TRUST_PROXY（37 项）
     node test/sleep-shape.test.js # 睡眠形状契约纯函数（前后端共用同一份，17 项）
     node test/slices.test.js      # 同步切片契约纯函数（切片键语法 / 树上取写 / 人话名，27 项）
     node test/migration.test.js   # 破坏性迁移（sets 拍平 / 计划记录合并）+ 同版本第二步就地补列：下放 done、rev 不变、回填只做一次（41 项）
     node test/render.test.js      # 前端渲染逻辑无头验证：启动冒烟 + 六页导航 + 页面记忆 + 卡片排序/概览打卡卡热力格/图表感应带 + 脏片推送/分批/冲突裁决（229 项，零依赖 node:vm 桩；布局/视觉仍需目测）
     node test/sync-http.test.js   # 真链路端到端（真 app.js 同步层 × 真 http 服务 × 真 SQLite，多个 vm「设备」各带 localStorage/Cookie，41 项；含「改完关页 → 重开补推」回归）
```

> 同步切片的规则（哪一块状态算哪片、值长什么样、怎么读怎么写）只写在 `public/js/slices.js` 一处：浏览器先于 app.js 加载它，`server/mapper.js` 直接 require。`mapper.js` 的**整树写与逐片写复用同一批小函数**，改一处两路同步生效；测试拿前端 `writeSlice` 与逐片写的结果对账，防两侧漂移。

> 睡眠的形状规则（脏值清洗、段数上限）只写在 `public/js/sleep-shape.js` 一处：浏览器先于 app.js 加载它，`server/mapper.js` 直接 require（同 seed-data.js）。改规则只改这一份，两侧自动同步。

浏览器调试钩子：`?ftest`（功能自测）、`?selftest`（全视图渲染）、`?shot=视图名`、`?probe`（数据摘要）。实现在 `public/js/dev.js`，**只在 URL 命中这些钩子时才按需加载**（用户路径不解析它，演示数据与自测代码也不占主包）。

> ⚠️ `?selftest`、`?ftest` 与 `?shot` 都会先用**演示数据覆盖当前账户**并自动同步到服务器（真实数据丢失）。三个钩子共用同一确认弹窗，【取消】则按真实数据正常进入，且确认/取消后钩子都会从地址栏剥除（避免书签/刷新反复触发）；自动化场景可在 URL 追加 `&devok` 跳过确认。

> 历史版本的变更与升级注意事项见 `CHANGELOG.md`。
