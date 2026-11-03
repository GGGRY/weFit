#!/usr/bin/env bash
# weFit 云端升级脚本（在服务器上执行）
#
# 流程：备份数据库 → git pull --ff-only → systemctl restart → /api/health 检查
# 数据库备份先做，任何一步失败都不会继续；失败后可用 rollback.sh 回退。
#
# 用法：
#   sudo /opt/wefit/deploy/update.sh
#
# 可用环境变量覆盖默认路径（见 deploy/_common.sh 文件头）。
#
# 注意：本脚本只负责上云后的「拉代码 + 重启」。
#       发版前必须在开发机上跑完 `cd server && npm test`，不要在服务器上跳步。

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
LOG_TAG=update
# shellcheck source=deploy/_common.sh
. "$SCRIPT_DIR/_common.sh"

preflight
assert_clean

OLD_HEAD=$(git_run rev-parse HEAD)
OLD_DESC=$(current_desc)
say "当前版本：$OLD_DESC"

BACKUP=$(db_backup "pre-$(git_run rev-parse --short "$OLD_HEAD")")
say "已备份数据库：$BACKUP"

say "拉取最新代码 ..."
git_run pull --ff-only || die "git pull 失败（代码未变动，服务未重启；数据库备份保留在 $BACKUP）"

NEW_HEAD=$(git_run rev-parse HEAD)
if [ "$OLD_HEAD" = "$NEW_HEAD" ]; then
  say "代码已是最新（$OLD_DESC），无需重启"
  exit 0
fi

NEW_DESC=$(current_desc)
say "更新：$OLD_DESC → $NEW_DESC"

CHANGED=$(git_run diff --name-only "$OLD_HEAD" "$NEW_HEAD")
printf '%s\n' "$CHANGED" | sed 's/^/    /'

if printf '%s\n' "$CHANGED" | grep -qE '^server/(db\.js|seed\.js)$'; then
  warn "本次含 server/db.js 或 server/seed.js 变更：启动时会执行建表/迁移。"
  warn "已提前备份；若启动失败，用下方回滚命令，必要时加 --restore-db 恢复备份。"
fi
if printf '%s\n' "$CHANGED" | grep -qx 'deploy/wefit.service'; then
  warn "deploy/wefit.service 有变更，旧单元不会自动生效。需要时手动："
  warn "  sudo cp $APP_DIR/deploy/wefit.service /etc/systemd/system/ && sudo systemctl daemon-reload"
fi
if printf '%s\n' "$CHANGED" | grep -qx 'deploy/Caddyfile'; then
  warn "deploy/Caddyfile 有变更，需要时手动：sudo cp $APP_DIR/deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy"
fi

restart_and_verify

say "升级完成：$OLD_DESC → $NEW_DESC"
say "数据库备份：$BACKUP"
say "建议在手机与电脑上各刷新一次页面，确认数据同步正常"
say "如需回滚：sudo $APP_DIR/deploy/rollback.sh $OLD_DESC"
