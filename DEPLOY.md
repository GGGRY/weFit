# weFit 云端部署与运维手册

本文只讲「上云之后」的部署、升级、回滚与备份,是 README「公网部署」一节的展开版与操作细则。功能与架构见 `MEMO.md`,版本历史见 `CHANGELOG.md`。

> 项目特点决定了运维很简单:**全栈零 npm 依赖、无构建步骤**,服务器上不需要 `npm install`,升级本质就是「拉代码 + 重启」。难点不在部署,而在**数据库迁移**与**避免新旧进程混跑**这两件事上。

---

## 一、部署形态与目录约定

```
手机 / 电脑浏览器
      │ HTTPS 443
      ▼
    Caddy(自动申请续期证书,只做反代)
      │ HTTP 127.0.0.1:8123
      ▼
 weFit server.js(systemd 服务 wefit,User=wefit)
      │
      ├── 代码:/opt/wefit(git 仓库,只读挂载给服务)
      └── 数据:/var/lib/wefit/wefit.db(SQLite,持久化,不在代码目录里)
```

| 项目 | 默认值 | 覆盖变量(`deploy/_common.sh`) |
|---|---|---|
| 代码目录 | `/opt/wefit` | `APP_DIR` |
| 数据库 | `/var/lib/wefit/wefit.db` | `DB_PATH` |
| systemd 服务名 | `wefit` | `SERVICE` |
| 数据库备份目录 | `/var/backups/wefit` | `BACKUP_DIR` |
| 备份保留份数 | 30 | `KEEP_BACKUPS` |
| 健康检查地址 | `http://127.0.0.1:8123/api/health` | `HEALTH_URL` |
| 健康检查重试秒数 | 20 | `HEALTH_RETRIES` |
| node 可执行文件 | 从 `PATH` 取 | `NODE_BIN` |

**代码与数据分离**是这套部署的关键:`git pull` / `git reset` 永远碰不到 `/var/lib/wefit/`,数据库不会被代码操作误覆盖。

运行环境要求:**Node.js ≥ 22.5**(使用内置 `node:sqlite`;不需要系统 `sqlite3` 命令)。

---

## 二、上线前的选择

### 2.1 云厂商与规格

腾讯云 / 阿里云都可以,技术上没有差异。买**轻量应用服务器**(Lighthouse / 轻量),不要买 ECS/CVM:

| 项 | 建议 |
|---|---|
| 规格 | 2 核 2G(1 核 1G 也能跑,2G 是常见促销档) |
| 带宽 | 3~5 Mbps 固定带宽足够(响应都是小 JSON + 已 gzip 的静态资源) |
| 磁盘 | 默认 40~50G |
| 系统 | Ubuntu 22.04 / 24.04 |

个人低负载服务,重点看**当前促销价与续费价**,不必为品牌纠结。轻量的固定带宽比 ECS 按流量计费更可控。

### 2.2 地域:大陆还是香港

| | 大陆节点 | 香港节点 |
|---|---|---|
| 备案 | **必须备案**,通常 7~20 天 | 免备案,当天可上线 |
| 访问速度 | 最快 | 大陆访问够用 |
| 顺序 | 必须先备案,再让域名走 80/443 | 无此限制 |

急着用或不想等备案 → 选香港;能等一两周 → 大陆节点 + 备案。域名不必和服务器在同一家买。

### 2.3 必须提前定好的安全口径

- 安全组 / 防火墙**只放行 22、80、443**;**8123 绝不对公网开放**。
- 服务只监听 `127.0.0.1`(`HOST=127.0.0.1`),公网入口交给 Caddy。
- **必须关闭注册**(`ALLOW_REGISTER=0`):开放注册时第一个访问者会直接成为管理员。
- 域名 A 记录先指向服务器公网 IP,证书申请要求 80/443 可达。

### 2.4 服务端环境变量与安全设置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `COOKIE_SECURE` | `auto` | `auto` 表示仅当 `TRUST_PROXY=1` 且反向代理上报 `X-Forwarded-Proto: https` 时,为会话 Cookie 添加 `Secure` 属性;`1` 强制添加,`0` 强制不添加 |
| `TRUST_PROXY` | 关闭 | 置 `1` 后才会采信 `X-Forwarded-Proto` 与 `X-Forwarded-For`。反向代理对 `X-Forwarded-For` 通常是追加而非覆写,因此服务端只取最后一段(最近一跳受信反代所添加)。若取第一段,攻击者可携带随机前缀扰乱限速分桶、绕过登录限速。样例 Caddyfile 已显式覆写该头,两侧口径一致 |
| `ALLOW_REGISTER` | 开启 | 置 `0` 关闭注册(返回 403 `register_closed`)。公网部署必须关闭:首个注册账户自动获得管理员权限,开放注册等于向任意访客暴露管理权限 |
| `LOGIN_MAX_FAILS` / `LOGIN_MAX_FAILS_IP` | 5 / 20 | 同一来源对同一账户 / 同一来源对任意账户的失败次数上限,达到上限后封锁该来源 `LOGIN_BLOCK_MS`(默认 15 分钟),返回 429 与 `Retry-After` |
| `LOGIN_WINDOW_MS` / `LOGIN_BLOCK_MS` | 15 分钟 / 15 分钟 | 失败次数统计窗口与封锁时长 |
| `HOST` / `PORT` / `DB_PATH` | `0.0.0.0` / `8123` / `server/data/wefit.db` | 监听地址、端口与数据库路径;`DB_PATH` 应指向纳入备份范围的持久化位置(公网部署用 `/var/lib/wefit/wefit.db`) |

启动日志会打印当前配置口径,例如 `HTTPS/Cookie Secure auto(信 X-Forwarded-Proto) · 注册已关闭`,便于核对配置是否生效。

> 本地与局域网的明文 HTTP 访问不受上述安全配置影响:默认口径下,明文 HTTP 的会话 Cookie 不添加 `Secure` 属性,`./start.sh` 与同网设备访问方式保持不变。仅显式设置 `COOKIE_SECURE=1` 会使明文 HTTP 无法登录,启动日志会输出相应警告。

---

## 三、首次部署流程

> 上线顺序:本地注册管理员并核对数据 → 取数据库快照 → 服务器装环境 → 代码与库落位 → 起服务(关注册)→ 配 Caddy → 验收 → 手机 / 电脑登录确认。

### 3.1 本地收尾与数据迁移

1. 本地 `./start.sh`,确认管理员账户与各账户数据正常。
2. 本地停服后取一致快照(服务在跑也能用 `VACUUM INTO`):

   ```bash
   node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("server/data/wefit.db");db.exec("VACUUM INTO \"/tmp/wefit-migrate.db\"");db.close()'
   ```

   或停服后直接 `cp server/data/wefit.db /tmp/wefit-migrate.db`。

> ⚠️ **上线后云端是唯一真身**。本地这份服务要停掉,本地页面改访问云端地址。两套服务同时写数据会分叉,而且它们之间互不同步。

### 3.2 服务器装环境

```bash
# Node 22(node:sqlite 需要 ≥ 22.5)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v

# Caddy(自动 HTTPS)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

### 3.3 代码与数据库落位

```bash
# 服务器上
sudo useradd -r -s /usr/sbin/nologin wefit
sudo mkdir -p /opt/wefit /var/lib/wefit
sudo git clone <仓库地址> /opt/wefit
sudo chown -R wefit:wefit /opt/wefit

# 本机上传数据库快照
scp /tmp/wefit-migrate.db vps:/tmp/wefit-migrate.db

# 服务器上
sudo mv /tmp/wefit-migrate.db /var/lib/wefit/wefit.db
sudo chown -R wefit:wefit /var/lib/wefit
sudo chmod 700 /var/lib/wefit
```

**绝不要**把本地 `server/data/` 同步到服务器覆盖云端库。

### 3.4 systemd 起服务

`deploy/wefit.service` 已内置公网安全口径:`HOST=127.0.0.1`、`PORT=8123`、`TRUST_PROXY=1`、`COOKIE_SECURE=auto`、`ALLOW_REGISTER=0`、`DB_PATH=/var/lib/wefit/wefit.db`,并用 `ProtectSystem=strict` + `ReadWritePaths=/var/lib/wefit` 做最小权限。

```bash
# 安装前核对 WorkingDirectory 与 ExecStart 的 node 路径(which node)
sudo cp /opt/wefit/deploy/wefit.service /etc/systemd/system/wefit.service
sudo systemctl daemon-reload
sudo systemctl enable --now wefit
systemctl status wefit --no-pager
journalctl -u wefit -n 20 --no-pager
```

启动日志应体现:`127.0.0.1` 监听、采信 `X-Forwarded-Proto`、注册已关闭。

### 3.5 Caddy 反向代理

```bash
sudo cp /opt/wefit/deploy/Caddyfile /etc/caddy/Caddyfile
sudo vi /etc/caddy/Caddyfile        # 把所有 wefit.example.com 换成真实域名
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

`deploy/Caddyfile` 里已写好:gzip/zstd 兜底压缩、显式覆写 `X-Forwarded-For`(只传真实来源,避免限速被伪造头绕开)、HSTS 试跑 `max-age=300`、安全响应头。

HSTS 试跑期确认全站无混合内容后,再把 `max-age` 拉到一年(加 `includeSubDomains` 要谨慎,浏览器记住后很难回退)。

### 3.6 验收清单

```bash
curl -I https://你的域名/api/health          # 200
curl -I http://你的域名/                     # 301 → HTTPS
curl -s https://你的域名/api/health          # {"ok":true,...}
```

登录 Cookie 验证(用真实账户;失败请求不会下发 Cookie):

```bash
curl -sv -X POST https://你的域名/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<用户名>","password":"<密码>"}'
# Set-Cookie 应包含 Secure
```

可选:验证限速不会被伪造的 `X-Forwarded-For` 前缀洗掉。经反代后,Caddy 会用真实来源覆写该头;连续用不同伪造前缀发失败登录,计数应累计到同一来源并最终返回 429,而不会每次被当成新来源:

```bash
for i in $(seq 1 25); do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://你的域名/api/login \
    -H 'Content-Type: application/json' \
    -H "X-Forwarded-For: 1.1.1.$i, <你的真实IP>" \
    -d '{"username":"<一次性测试用户名>","password":"wrong"}'
done | sort | uniq -c
```

> 这条测试会触发 15 分钟登录封锁,请用一次性测试用户名,不要拿常用账户试。

再看一眼防火墙:公网直接访问 `http://服务器IP:8123` 应当连接失败。

### 3.7 手机侧

手机浏览器打开 `https://你的域名`,登录与本地相同的账户即自动同步。iOS Safari「分享 → 添加到主屏幕」/ Android Chrome「添加到主屏幕」,可当近似原生应用使用。

---

## 四、日常升级流程

### 4.1 开发机上(发版前,不可跳过)

```bash
# 用独立测试库开发,不污染 server/data/wefit.db
DB_PATH=/tmp/wefit-dev.db ./start.sh

# 全量回归(同步 / 鉴权 / 渲染 / 真链路)
cd server && npm test

# 更新文档并按需升版号(版本号唯一来源是 server/package.json)
git add -A && git commit -m "..."
git push
git tag v4.xx && git push --tags      # 建议每个版本打 tag,回滚直接按 tag 走
```

发版前的 `npm test` **必须在开发机跑**;服务器上的脚本只负责拉代码和重启。

### 4.2 服务器上(标准做法)

```bash
cd /opt/wefit && sudo git pull --ff-only   # 首次把 deploy/update.sh 拉下来
sudo /opt/wefit/deploy/update.sh
```

`deploy/update.sh` 依次执行:

1. 检查 root、目录、systemd 服务、node;
2. **拒绝脏工作区**:`/opt/wefit` 有未提交修改就直接退出;
3. 用 `node:sqlite` 的 `VACUUM INTO` 备份运行中的库(含 WAL,一致快照),文件形如 `/var/backups/wefit/wefit-20261104-101500-pre-a4409a9.db`,只保留最近 30 份;
4. `git pull --ff-only`(代码没变化就结束,不重启);
5. 打印本次变更文件;`server/db.js` / `server/seed.js` 有变更时提示「启动会跑迁移」;
6. `systemctl restart wefit`(systemd 保证旧进程先退出,不会新旧混跑);
7. 轮询 `/api/health` 最多 20 秒;失败则打印 `journalctl` 尾部、退出非零,并给出回滚命令。

### 4.3 手动等价步骤

不想用脚本时,按同样顺序执行:

```bash
OUT="/var/backups/wefit/wefit-$(date +%F-%H%M).db"
sudo node -e '
const { DatabaseSync } = require("node:sqlite");
const [src, dst] = process.argv.slice(1);
const q = String.fromCharCode(39);
const db = new DatabaseSync(src);
db.exec(`VACUUM INTO ${q}${dst.split(q).join(q + q)}${q}`);
db.close();
' /var/lib/wefit/wefit.db "$OUT"

cd /opt/wefit && sudo git pull --ff-only
sudo systemctl restart wefit
curl -sf http://127.0.0.1:8123/api/health && echo OK
```

> 与 `deploy/_common.sh` 的备份逻辑一致:传参而不是把路径拼进 SQL,避免路径里的引号问题。

### 4.4 含数据库迁移的版本(改了 `db.js` / SCHEMA / 迁移逻辑)

1. **先在本地演练**:把云上刚打的备份拉到本机,`DB_PATH=/tmp/wefit-cloud-copy.db ./start.sh`,确认迁移能跑通、页面数据正常;
2. 云端照常走 `update.sh`,**备份这一步不可省**;
3. 迁移后不要急着回滚代码——旧代码可能不兼容新表结构;要回滚就连数据库一起恢复(见第五节)。

### 4.5 不要在服务器上做的事

- 不要在 `/opt/wefit` 里直接改文件:代码只在启动时加载,热改不重启 = 新前端 + 旧后端混跑,整树写入会互相覆盖丢数据;
- 不要同时手动 `node server.js` 再留 systemd 服务在跑(端口冲突 / 两进程写同一库);
- 不要把 `git push` 配成自动上线:本项目要求发版前本地 `npm test` + 迁移演练,自动部署会绕过这道闸;
- 不要用「只改前端就不用重启」偷懒:统一走 `update.sh` 最省事。

---

## 五、回滚流程

```bash
sudo /opt/wefit/deploy/rollback.sh --list      # 当前版本 + 可用 tag + 最近数据库备份
sudo /opt/wefit/deploy/rollback.sh v4.23       # 只回滚代码(默认带确认)
sudo /opt/wefit/deploy/rollback.sh v4.23 --restore-db /var/backups/wefit/wefit-xxx.db
sudo /opt/wefit/deploy/rollback.sh <commit> --yes   # 跳过确认
```

`rollback.sh` 的行为:

- 目标可以是 tag、分支或 commit;回滚前**自动再备份一次当前库**(防恢复错备份后回不到现状);
- 先 `git reset --hard` 回滚代码,再处理数据库——顺序反过来一旦中断会留下「库已回旧、代码仍是新版、服务停着」的残局;
- `--restore-db`:停服 → 覆盖库 → **删除残留 `-wal`/`-shm`**(否则旧 WAL 会回放)→ 恢复属主权限 → 起服 → 健康检查;
- 两版本间 `db.js`/`seed.js` 有变化却没带 `--restore-db` 时,给出醒目警告。

**判断标准**:纯前端 / 纯逻辑修复,只回代码;动了表结构或迁移,必须连数据库一起回到升级前的备份。

手动回滚数据库时:

```bash
sudo systemctl stop wefit
sudo cp /var/backups/wefit/wefit-2026-11-04-101500-pre-a4409a9.db /var/lib/wefit/wefit.db
sudo rm -f /var/lib/wefit/wefit.db-wal /var/lib/wefit/wefit.db-shm
sudo chown wefit:wefit /var/lib/wefit/wefit.db
sudo chmod 600 /var/lib/wefit/wefit.db
sudo systemctl start wefit
```

---

## 六、备份

- `update.sh` 与 `rollback.sh` 每次执行都会自动备份,默认保留 30 份;
- 建议再加一条**每日定时备份**(不依赖系统 `sqlite3`):

  ```bash
  # /etc/cron.d/wefit-backup
  15 3 * * * root /usr/bin/node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("/var/lib/wefit/wefit.db");db.exec("VACUUM INTO \"/var/backups/wefit/wefit-daily.db\"");db.close()'
  ```

  或直接复用 `_common.sh` 的备份函数写一个小脚本;
- **异地备份**:定期把备份文件下载一份到自己的电脑(服务器整机故障时,本机备份才是最后的兜底);
- 恢复前先停服务,恢复后清 `-wal`/`-shm`,再启动。

---

## 七、关键注意事项(踩坑清单)

1. **云端唯一真身**:上线后停掉本地服务,否则两边各写各的,数据分叉且无法自动合并。
2. **改完必须重启**:任何服务端/前端代码改动都要走 `git pull` + `systemctl restart wefit`,禁止热改混跑。
3. **迁移前先备份**:`db.js` / `seed.js` 变更会在启动时自动迁移,备份是唯一退路。
4. **不要新旧进程并存**:统一由 systemd 管理;手动起的 `node server.js` 会和它抢端口、写同一库。
5. **不要把 `server/data/` 传上云**:云端库在 `/var/lib/wefit/`,代码目录里的库只是历史副本。
6. **安全三件套**:`HOST=127.0.0.1`、`ALLOW_REGISTER=0`、防火墙不放行 8123。关闭注册后,新增账户只能由管理员在后台「用户管理 → 新建用户」创建(首个注册账户即管理员)。
7. **系统配置不会自动更新**:`deploy/wefit.service` / `deploy/Caddyfile` 有变更时,`update.sh` 只提示,需手动 `cp` + `daemon-reload` / `reload caddy`。
8. **不自动部署**:`git push` 后必须在服务器上显式执行 `update.sh`,保留人工闸门。
9. **版本号单一来源**:升版号只改 `server/package.json`,`/api/me`、设置页与管理后台自动跟随;补丁位为 0 时界面自动省略。
10. **前端不需要清缓存**:静态资源带 `ETag` + `Cache-Control: no-cache`,刷新自动拿新版。
11. **升级窗口**:重启只有一两秒;正在同步的请求会失败重试,离线改动留在本地缓存,服务恢复后自动补推。
12. **升级后双端确认**:手机 + 电脑各打开一次,确认同一账户数据一致。
13. **Node 版本要求升级时**:先升级服务器 Node,再发版(看 `server/package.json` 的 `engines`)。
14. **脚本执行位**:若 `git` 检出后脚本没有可执行位,用 `sudo bash /opt/wefit/deploy/update.sh` 调用;仓库中已记录为 755。
15. **首次拉取脚本**:`update.sh` 本身要先在服务器上手动 `git pull` 一次才有;之后再统一用脚本。
16. **HSTS 谨慎**:先从短 `max-age` 试跑,确认无混合内容再拉长。

---

## 八、故障排查

| 现象 | 检查 / 处理 |
|---|---|
| 服务起不来 | `systemctl status wefit --no-pager` + `journalctl -u wefit -n 80 --no-pager` |
| 健康检查失败 | `curl -v http://127.0.0.1:8123/api/health`;确认端口、`DB_PATH` 权限、Node 版本 ≥ 22.5 |
| 域名打不开 / 证书报错 | `systemctl status caddy`、`journalctl -u caddy -n 50`;确认 DNS A 记录、80/443 可达、域名已备案(大陆节点) |
| Caddy 启动失败 / 写日志报错 | 样例配置日志落在 `/var/log/caddy/wefit.log`;先 `sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy` |
| 登录后立刻掉线 | 确认 `TRUST_PROXY=1` 与 Caddy 的 `X-Forwarded-Proto`;`COOKIE_SECURE=auto` 时明文直连不会加 Secure |
| 数据像是旧版 | 浏览器刷新;`curl -s https://域名/api/health`;确认服务器 `git rev-parse HEAD` 与预期一致 |
| 升级后数据异常 | 立即 `rollback.sh --list`,按版本回滚;涉及迁移时带 `--restore-db` |
| 备份太大 / 太多 | 调整 `KEEP_BACKUPS`,或手工清理 `/var/backups/wefit/` |

---

## 九、相关文件

| 文件 | 用途 |
|---|---|
| `deploy/Caddyfile` | Caddy 反代样例(HTTPS、XFF 覆写、HSTS、安全头) |
| `deploy/wefit.service` | 系统级 systemd 单元(公网部署,回环监听 + 关注册) |
| `deploy/wefit.user.service` | 用户级 systemd 单元(仅局域网 / 个人机自启) |
| `deploy/update.sh` | 备份 → 拉代码 → 重启 → 健康检查 |
| `deploy/rollback.sh` | 按 tag/commit 回滚,可选连数据库一起恢复 |
| `deploy/_common.sh` | 路径默认值、备份、健康检查、git 调用的公共实现 |
| `README.md` | 快速开始、公网部署摘要、环境变量表 |
| `MEMO.md` | 架构、同步切片、数据模型等技术细节 |
| `CHANGELOG.md` | 版本变更与各版本升级注意事项 |
