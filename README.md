# weFit · 个人健康管理

weFit 是一款个人健康管理网页应用,包含概览、饮食、运动、身体数据、历史、设置六个功能模块。饮食按餐次记录:食物分为「我的库」与「系统库」两层,从库中选定条目并填写食用克数即可完成记录。运动支持计次与计时两种记录方式,按天聚合为一条记录、逐项确认完成。身体指标、睡眠、饮水与习惯打卡均按日记录;营养目标与基础资料在设置页维护。多设备登录同一账户时自动同步数据:同步按「片」粒度进行,仅上传与下载实际变更的数据;断网期间可继续本地记录,网络恢复后自动补推。

全栈零 npm 依赖,基于 Node.js 内置模块 `http`、`sqlite`、`crypto` 实现,执行 `node server.js` 即可启动服务。

## 快速开始

```bash
./start.sh          # Linux/macOS(Windows 运行 start.bat)
```

浏览器访问 `http://localhost:8123`;移动设备可在同一无线网络内访问启动日志中打印的本机 IP 地址。

## 开机自启(本机 / 局域网环境,无需管理员权限)

若需 weFit 开机自动在后台运行,免于每次手动启动,可采用 systemd 用户级单元配合 linger 配置(用户未登录时服务同样会启动)。仓库提供样例 `deploy/wefit.user.service`,请按本机环境修改其中的路径与 Node.js 版本(用法说明见文件头部注释)。

```bash
mkdir -p ~/.config/systemd/user
cp deploy/wefit.user.service ~/.config/systemd/user/wefit.service   # 先改正文件头注释中的 Node.js 绝对路径
systemctl --user daemon-reload
systemctl --user enable --now wefit          # enable 为开机自启,--now 为立即启动
loginctl enable-linger $USER                 # 未启用此项时,无用户登录会话不会拉起服务
```

常用维护命令:`systemctl --user status wefit` 查看服务状态,`journalctl --user -u wefit -f` 查看日志,`systemctl --user stop wefit` 停止服务。需要临时手动启动服务前,请先停止该单元以避免端口冲突。

此方案仅适用于局域网访问(监听 `0.0.0.0:8123`),未配置 HTTPS 且保持注册开放,只适合家庭或可信网络环境。公网部署请采用下文反代方案并关闭注册。

## 公网部署(HTTPS 反向代理)

weFit 服务本身不处理 TLS:建议将 443 端口交由反向代理(Caddy 或 nginx),weFit 仅监听回环地址。仓库提供两份可直接使用的配置样例:`deploy/Caddyfile`(Caddy 自动申请并续期证书)与 `deploy/wefit.service`(systemd 服务单元)。

```bash
# 1) 配置反向代理(将 Caddyfile 中的域名替换为实际域名,并确保域名解析至本机、80/443 端口可达)
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
# 2) 服务仅监听回环,采信反向代理请求头,并关闭注册
HOST=127.0.0.1 TRUST_PROXY=1 ALLOW_REGISTER=0 node server.js   # 或修改 deploy/wefit.service 后执行 systemctl enable --now wefit
# 3) 防火墙仅放行 80 与 443 端口,8123 端口不得暴露于公网
```

启动日志会打印当前配置口径,例如 `HTTPS/Cookie Secure auto(信 X-Forwarded-Proto) · 注册已关闭`,便于核对配置是否生效。

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `COOKIE_SECURE` | `auto` | `auto` 表示仅当 `TRUST_PROXY=1` 且反向代理上报 `X-Forwarded-Proto: https` 时,为会话 Cookie 添加 `Secure` 属性;`1` 强制添加,`0` 强制不添加 |
| `TRUST_PROXY` | 关闭 | 置 `1` 后才会采信 `X-Forwarded-Proto` 与 `X-Forwarded-For`。反向代理对 `X-Forwarded-For` 通常是追加而非覆写,因此服务端只取最后一段(最近一跳受信反代所添加)。若取第一段,攻击者可携带随机前缀扰乱限速分桶、绕过登录限速。样例 Caddyfile 已显式覆写该头,两侧口径一致 |
| `ALLOW_REGISTER` | 开启 | 置 `0` 关闭注册(返回 403 `register_closed`)。公网部署必须关闭:首个注册账户自动获得管理员权限,开放注册等于向任意访客暴露管理权限 |
| `LOGIN_MAX_FAILS` / `LOGIN_MAX_FAILS_IP` | 5 / 20 | 同一来源对同一账户 / 同一来源对任意账户的失败次数上限,达到上限后封锁该来源 `LOGIN_BLOCK_MS`(默认 15 分钟),返回 429 与 `Retry-After` |
| `LOGIN_WINDOW_MS` / `LOGIN_BLOCK_MS` | 15 分钟 / 15 分钟 | 失败次数统计窗口与封锁时长 |
| `HOST` / `PORT` / `DB_PATH` | `0.0.0.0` / `8123` / `server/data/wefit.db` | 监听地址、端口与数据库路径;`DB_PATH` 应指向纳入备份范围的持久化位置 |

> 本地与局域网的明文 HTTP 访问不受上述安全配置影响:默认口径下,明文 HTTP 的会话 Cookie 不添加 `Secure` 属性,`./start.sh` 与同网设备访问方式保持不变。仅显式设置 `COOKIE_SECURE=1` 会使明文 HTTP 无法登录,启动日志会输出相应警告。

**首次公网上线步骤**:先在本地环境注册管理员账户(首个注册账户即为管理员),核对数据无误;随后停止服务并备份 `server/data/wefit.db`;按上文三步启动反向代理与服务(设置 `ALLOW_REGISTER=0`);最后分别在浏览器与移动设备登录,验证多端同步。

**验收检查**:`curl -I https://<域名>/api/health` 应返回 200;`curl -I http://<域名>/` 应 301 重定向至 HTTPS;使用真实账户调用 `curl -sv -X POST https://<域名>/api/login -d '{"username":"<用户名>","password":"<密码>"}' -H 'Content-Type: application/json'`,响应头 `Set-Cookie` 应包含 `Secure` 属性(登录失败时不下发 Cookie,须以有效账户验证)。另可验证限速分桶仅依据最后一段地址:连续发送带有不同伪造前缀、相同末段的请求(如 `-H 'X-Forwarded-For: 1.1.1.$i, <真实IP>'`),失败计数应稳定累计并最终返回 429,而不会每次被判别为新来源。

**上线后维护**:新增账户通过管理后台「用户管理 → 新建用户」创建,不受关闭注册的影响,公网部署下这是唯一的建号入口;数据库定时备份方式见 MEMO.md 使用备忘(以 `VACUUM INTO` 获取一致性快照)。

**日常升级与回滚**(在服务器上执行,脚本随仓库一同更新):

```bash
sudo /opt/wefit/deploy/update.sh                  # 备份数据库 → git pull --ff-only → 重启服务 → /api/health 检查
sudo /opt/wefit/deploy/rollback.sh --list         # 查看可回滚的版本标签与最近的数据库备份
sudo /opt/wefit/deploy/rollback.sh v4.23          # 仅回滚代码
sudo /opt/wefit/deploy/rollback.sh v4.23 --restore-db /var/backups/wefit/wefit-xxx.db   # 同时恢复代码与数据库
```

默认路径与 `deploy/wefit.service` 保持一致(`/opt/wefit`、`/var/lib/wefit/wefit.db`、服务名 `wefit`、备份目录 `/var/backups/wefit`),可通过同名环境变量覆盖。数据库备份使用 Node.js 内置 `node:sqlite` 的 `VACUUM INTO`,不依赖系统 `sqlite3` 命令。升级脚本会拒绝对存在未提交修改的代码目录执行,并在 `db.js` 或 `seed.js` 发生变更(涉及启动时迁移)时给出提示。发版前的 `npm test` 应在开发机上完成,本脚本仅负责服务器端的代码拉取与服务重启。

## 账户与数据隔离

- 访问应用需注册并登录,每个账户仅能读取和修改自身数据,多账户之间互不影响。
- 同一账户在多台设备(如手机与电脑)登录后自动同步数据:以服务器为准,浏览器保留离线缓存。同步按「片」粒度执行(一天的饮食、一天的饮水、一次打卡等各为一片),仅上传实际修改的切片,其他设备同样只下载发生变更的切片。
- 会话有效期为 30 天,服务器重启不会导致登出;退出登录入口位于页面右上角的账户菜单。
- 断网期间本地记录照常,恢复后自动补推。若离线期间关闭过页面,且本账户其他设备修改过相同切片,下次启动时会就受影响的项目提示选择处理方式,其余本机改动照常上传,避免本地修改被静默覆盖。
- 食物与运动数据采用双层库结构:每个账户拥有可增删改的「我的库」,食物条目可修改名称与四项营养成分,修改后该条目的营养来源改记为「用户」;「系统库」由管理员在后台维护,对全体用户只读,可一键加入我的库。食物条目带有营养来源(`src`)标识:系统库条目为 `USDA`,用户自行录入的条目为「用户」,从系统库挑入的条目沿用其原有来源。运动条目包含三层信息:大类(力量 / 有氧 / 球类 / 柔韧 / 其他)、部位(胸 / 背 / 腿 / 肩 / 手臂 / 核心 / 全身)与记录方式(计次 / 计时),库列表以「名称 + 大类 · 部位 · 方式」的形式展示。

## 管理后台(仅管理员)

访问 `http://<服务器>:8123/admin`,用户端设置页亦提供后台入口。非管理员账户访问后台时显示无权限页面。

- **系统共享库**:分「食物库 / 动作库」两个子页,通过「添加」按钮打开弹窗录入条目,列表行尾提供删除操作;食物录入可填写营养来源(默认 `USDA`)。保存后对全体用户的系统库页面生效。
- **用户管理**:查看全部账户及其数据概况;新建用户(填写用户名、昵称与初始密码,可指定管理员角色;该入口不依赖用户端注册,关闭注册后仍可建号);设置或撤销管理员(系统至少保留一名管理员);重置密码(该账户在全部设备上强制登出);删除账户(级联清除其全部记录,操作不可恢复)。

## 目录结构

- `public/` 前端,无构建步骤:`index.html`、`admin.html`、`css/style.css`、`js/seed-data.js`、`js/sleep-shape.js`、`js/app.js`;`js/dev.js` 为调试钩子,仅在 URL 携带对应参数时按需加载
- `server/` 后端;`server/data/wefit.db` 为 SQLite 数据库,全部业务数据存放于此
- `deploy/` 部署配置与运维脚本:`Caddyfile`(反向代理)、`wefit.service`(systemd 服务单元)、`wefit.user.service`(用户级自启单元)、`update.sh` 与 `rollback.sh`(升级 / 回滚)、`_common.sh`(脚本公共逻辑)
- `MEMO.md` 项目备忘录(架构、功能、技术债、使用备忘)
- `CHANGELOG.md` 版本变更日志
- `PLANS.md` 后续开发计划建议

## 测试

```bash
cd server && npm test                        # 一次运行下列八个测试文件
     node test/roundtrip.test.js   # 鉴权、双账户隔离、数据往返保真与按片同步(写入 / CAS / 删片 / 墓碑 / 整树兼容),121 项
     node test/admin.test.js       # 管理后台 API:新建用户、角色调整、密码重置、删除账户防护,以及系统库三件套字段白名单,63 项
     node test/auth-https.test.js  # 公网部署安全:登录限速、Cookie Secure、关闭注册、TRUST_PROXY 行为,37 项
     node test/sleep-shape.test.js # 睡眠形状契约纯函数(前后端共用同一份),17 项
     node test/slices.test.js      # 同步切片契约纯函数(切片键语法、树上取写、可读名称),27 项
     node test/migration.test.js   # 破坏性迁移(sets 拍平、计划记录合并)与同版本补列:下放 done、rev 不变、回填仅执行一次,41 项
     node test/render.test.js      # 前端渲染逻辑无头验证:启动冒烟、六页导航、页面记忆、卡片排序、概览打卡卡热力格、图表感应带、脏片推送、分批与冲突裁决(229 项,基于零依赖 node:vm 桩;布局与视觉效果仍需人工确认)
     node test/sync-http.test.js   # 真实链路端到端测试:真实 app.js 同步层、真实 HTTP 服务与真实 SQLite,多个 node:vm 模拟设备各带 localStorage 与 Cookie(41 项,含「携带未推送修改关闭后重开补推」回归)
```

> 同步切片的规则(状态归属、切片结构、读写方式)仅在 `public/js/slices.js` 一处定义:浏览器先于 `app.js` 加载该文件,`server/mapper.js` 直接 require。`mapper.js` 的整树写入与逐片写入复用同一批函数,修改一处即可对两条路径同时生效;测试以前端 `writeSlice` 的结果与逐片写入结果对账,防止两侧实现漂移。

> 睡眠数据的形状规则(异常值清洗、段数上限)同样仅在 `public/js/sleep-shape.js` 一处定义,前后端共用(加载方式与 seed-data.js 相同);修改规则只需变更该文件,两侧自动保持一致。

浏览器调试钩子:`?ftest`(功能自测)、`?selftest`(全视图渲染)、`?shot=<视图名>`、`?probe`(数据摘要)。实现位于 `public/js/dev.js`,仅在 URL 命中上述参数时按需加载;常规访问路径不会解析该文件,演示数据与自测代码因此不占用主包体积。

> ⚠️ `?selftest`、`?ftest` 与 `?shot` 会先以演示数据覆盖当前账户数据并自动同步至服务器,导致真实数据丢失。三个钩子共用同一确认弹窗:选择取消则按现有数据正常进入应用;确认或取消后,钩子参数会自地址栏移除,避免书签或刷新反复触发。自动化场景可在 URL 追加 `&devok` 跳过确认提示。

> 历史版本的变更与升级注意事项见 `CHANGELOG.md`。
