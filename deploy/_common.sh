#!/usr/bin/env bash
# weFit 云端升级/回滚 · 共用配置与工具函数
# 由 deploy/update.sh 与 deploy/rollback.sh source，不单独执行。
#
# 默认路径与 deploy/wefit.service 保持一致，可用环境变量覆盖：
#   APP_DIR      代码目录        （默认 /opt/wefit）
#   DB_PATH      真实数据库      （默认 /var/lib/wefit/wefit.db）
#   SERVICE      systemd 服务名  （默认 wefit）
#   BACKUP_DIR   数据库备份目录  （默认 /var/backups/wefit）
#   KEEP_BACKUPS 保留备份份数    （默认 30）
#   HEALTH_URL   健康检查地址    （默认 http://127.0.0.1:8123/api/health）
#   HEALTH_RETRIES 健康检查重试秒数（默认 20）
#   NODE_BIN     node 可执行文件 （默认从 PATH 取；与 wefit.service 的 ExecStart 保持一致）
#
# 数据库备份用 node:sqlite 的 VACUUM INTO（运行中也取一致快照，含 WAL），
# 不依赖系统 sqlite3 命令。

APP_DIR="${APP_DIR:-/opt/wefit}"
DB_PATH="${DB_PATH:-/var/lib/wefit/wefit.db}"
SERVICE="${SERVICE:-wefit}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/wefit}"
KEEP_BACKUPS="${KEEP_BACKUPS:-30}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8123/api/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
LOG_TAG="${LOG_TAG:-wefit}"

say()  { printf '[%s] %s\n' "$LOG_TAG" "$*"; }
warn() { printf '[%s] ⚠ %s\n' "$LOG_TAG" "$*" >&2; }
die()  { printf '[%s] ✗ %s\n' "$LOG_TAG" "$*" >&2; exit 1; }

require_root() {
  [ "$(id -u)" -eq 0 ] || die "需要 root 权限（重启 systemd 服务、读写数据库目录）：sudo $0 ..."
}

repo_owner() { stat -c %U "$APP_DIR"; }

# 以代码目录属主的身份跑 git：
#   1) 避免 root 访问他人仓库触发 git 的 dubious ownership 拒绝；
#   2) git pull 能用上该用户自己的 SSH/凭据配置（sudo -H 让 HOME 指向属主）。
git_run() {
  sudo -H -u "$(repo_owner)" -- git -C "$APP_DIR" "$@"
}

preflight() {
  require_root
  [ -d "$APP_DIR/.git" ] || die "$APP_DIR 不是 git 仓库（可用 APP_DIR=... 覆盖）"
  command -v systemctl >/dev/null 2>&1 || die "找不到 systemctl"
  command -v sudo >/dev/null 2>&1 || die "找不到 sudo"
  systemctl cat "$SERVICE" >/dev/null 2>&1 || die "找不到 systemd 服务 $SERVICE（先安装 deploy/wefit.service）"
  [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ] || die "找不到 node 可执行文件（可用 NODE_BIN=... 指定）"
}

# 代码目录必须是干净的：线上热改过的文件绝不能被 pull/reset 静默覆盖
assert_clean() {
  local dirty
  dirty=$(git_run status --porcelain) || die "读取 git 状态失败"
  [ -z "$dirty" ] || die "代码目录有未提交的本地修改，拒绝继续（先在 $APP_DIR 处理掉）"
}

current_desc() {
  git_run describe --tags --always 2>/dev/null || git_run rev-parse --short HEAD
}

# 对运行中的库取一致快照，成功后把备份路径打印到 stdout
# 可选第二参：一份「不参与保留份数裁剪」的备份路径（回滚的恢复目标可能是最旧那份，
#             不能在本次备份触发的裁剪里被连带删掉；按文件名豁免，本目录备份名由脚本生成、无空格）
db_backup() {
  local label="${1:-manual}"
  local keep_base="${2:+$(basename -- "$2")}"
  [ -f "$DB_PATH" ] || die "数据库不存在：$DB_PATH（确认 DB_PATH 与 wefit.service 一致）"
  mkdir -p "$BACKUP_DIR"
  local out="$BACKUP_DIR/wefit-$(date +%Y%m%d-%H%M%S)-$label.db"
  "$NODE_BIN" -e '
const { DatabaseSync } = require("node:sqlite");
const [src, dst] = process.argv.slice(1);
const q = String.fromCharCode(39); // 单引号：SQL 字符串字面量，路径里的单引号成对转义
const db = new DatabaseSync(src);
db.exec(`VACUUM INTO ${q}${dst.split(q).join(q + q)}${q}`);
db.close();
' "$DB_PATH" "$out" || die "数据库备份失败（VACUUM INTO）"
  [ -s "$out" ] || die "数据库备份文件为空：$out"
  # 只保留最近 KEEP_BACKUPS 份（文件名带时间戳，按修改时间倒序裁掉最旧的；keep 豁免）
  ls -1t "$BACKUP_DIR"/wefit-*.db 2>/dev/null \
    | awk -v k="$keep_base" '{ p = $0; sub(/.*\//, "", p); if (k == "" || p != k) print }' \
    | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
  printf '%s\n' "$out"
}

health_ok() {
  "$NODE_BIN" -e '
fetch(process.argv[1]).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1));
' "$HEALTH_URL" 2>/dev/null
}

wait_health() {
  local i
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    if health_ok; then return 0; fi
    sleep 1
  done
  return 1
}

restart_and_verify() {
  say "重启服务 $SERVICE ..."
  systemctl restart "$SERVICE" || {
    journalctl -u "$SERVICE" -n 80 --no-pager >&2 || true
    die "服务重启失败，见上方日志"
  }
  if wait_health; then
    say "健康检查通过：$HEALTH_URL"
  else
    journalctl -u "$SERVICE" -n 80 --no-pager >&2 || true
    die "健康检查失败（${HEALTH_RETRIES}s 内 $HEALTH_URL 未返回 200），见上方日志"
  fi
}
