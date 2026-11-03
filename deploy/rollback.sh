#!/usr/bin/env bash
# weFit 云端回滚脚本（在服务器上执行）
#
# 用法：
#   sudo /opt/wefit/deploy/rollback.sh --list
#   sudo /opt/wefit/deploy/rollback.sh v4.23
#   sudo /opt/wefit/deploy/rollback.sh v4.23 --restore-db /var/backups/wefit/wefit-20261018-120000-pre-6dd479c.db
#   sudo /opt/wefit/deploy/rollback.sh <commit> --yes
#
# 说明：
# - 默认只回滚代码（git reset --hard + 重启 + 健康检查）。
# - 两个版本之间 db.js / seed.js 有变化时启动会跑迁移；若旧代码无法兼容新库结构，
#   必须用 --restore-db 指定升级前的备份，把数据库一起恢复。
# - --restore-db 会提前校验备份文件，再按「回滚代码 → 自动备份当前库 → 停服覆盖」执行。
# - 目标可以是 tag、分支或 commit。

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
LOG_TAG=rollback
# shellcheck source=deploy/_common.sh
. "$SCRIPT_DIR/_common.sh"

usage() {
  cat <<EOF
用法：sudo $0 <版本|commit> [选项]

  --restore-db <备份文件>  回滚代码的同时恢复数据库（停服覆盖，自动清理 -wal/-shm）
  -y, --yes                跳过确认
  -l, --list               列出可回滚的版本标签与最近的数据库备份
  -h, --help               显示本帮助

示例：
  sudo $0 --list
  sudo $0 v4.23
  sudo $0 v4.23 --restore-db /var/backups/wefit/wefit-20261018-120000-pre-6dd479c.db
EOF
}

TARGET=""
RESTORE_DB=""
ASSUME_YES=0
LIST=0

while [ $# -gt 0 ]; do
  case "$1" in
    -l|--list) LIST=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    --restore-db)
      shift
      [ $# -gt 0 ] || die "--restore-db 需要备份文件路径"
      RESTORE_DB=$1
      ;;
    -h|--help) usage; exit 0 ;;
    -*) die "未知参数：$1（见 --help）" ;;
    *)
      [ -z "$TARGET" ] || die "只能指定一个目标版本"
      TARGET=$1
      ;;
  esac
  shift
done

preflight

# ---- 只列清单 ----
if [ "$LIST" -eq 1 ]; then
  say "当前版本：$(current_desc)"
  say "版本标签（新 → 旧）："
  git_run tag --sort=-creatordate | head -n 20 | sed 's/^/    /'
  say "最近的数据库备份："
  if [ -d "$BACKUP_DIR" ]; then
    ls -1t "$BACKUP_DIR"/wefit-*.db 2>/dev/null | head -n 10 | sed 's/^/    /'
  else
    say "    （暂无备份目录 $BACKUP_DIR）"
  fi
  exit 0
fi

[ -n "$TARGET" ] || { usage; exit 1; }

# 恢复目标先校验（并转成绝对路径）：后面 pre-rollback 备份触发的保留份数裁剪可能删掉它，
# 校验要发生在任何删改之前；裁剪侧同时按文件名豁免这份（见 _common.sh db_backup）
if [ -n "$RESTORE_DB" ]; then
  [ -f "$RESTORE_DB" ] || die "备份文件不存在：$RESTORE_DB"
  [ -s "$RESTORE_DB" ] || die "备份文件为空：$RESTORE_DB"
  RESTORE_DB=$(readlink -f -- "$RESTORE_DB")
fi

assert_clean

TARGET_COMMIT=$(git_run rev-parse --verify "${TARGET}^{commit}") \
  || die "找不到版本/提交：$TARGET"
CURRENT_HEAD=$(git_run rev-parse HEAD)
CURRENT_DESC=$(current_desc)
TARGET_DESC=$(git_run describe --tags --always "$TARGET_COMMIT")

if ! git_run merge-base --is-ancestor "$TARGET_COMMIT" "$CURRENT_HEAD"; then
  warn "$TARGET 不是当前提交的历史祖先——这不是常规回滚（可能切到另一条历史）"
fi

say "当前版本：$CURRENT_DESC"
say "目标版本：$TARGET_DESC（$TARGET_COMMIT）"
[ -n "$RESTORE_DB" ] && say "数据库：  将恢复为 $RESTORE_DB"

if [ "$ASSUME_YES" -eq 0 ]; then
  printf '确认回滚？[y/N] '
  read -r ans || ans=""
  case "$ans" in
    y|Y|yes|YES) ;;
    *) say "已取消"; exit 0 ;;
  esac
fi

DB_FILES=$(git_run diff --name-only "$CURRENT_HEAD" "$TARGET_COMMIT" -- server/db.js server/seed.js || true)
if [ -n "$DB_FILES" ] && [ -z "$RESTORE_DB" ]; then
  warn "两个版本之间 server/db.js / server/seed.js 有变化（启动时会跑建表/迁移）。"
  warn "若旧代码无法兼容新库结构，需要带 --restore-db 指定升级前的备份一起恢复。"
  warn "可用备份：sudo $0 --list"
fi

# 先回滚代码、后恢复数据库：反过来跑时若 reset 中途失败，会留下
# 「库已回旧、代码仍是新版、服务被停」的新旧混跑残局；代码先就位，失败面只剩「未动库、未停服务」
say "回滚代码：$CURRENT_DESC → $TARGET_DESC"
# 注意：reset 会替换本脚本文件本身；bash 已按 inode 打开脚本，替换不影响本次执行。
git_run reset --hard "$TARGET_COMMIT" \
  || die "git reset 失败：代码未回滚、数据库未改动、服务未停，见上方 git 报错后重跑"

# 回滚前再给当前库留一份，防止恢复错备份时无法回到现状（恢复目标豁免于本次裁剪）
BACKUP=$(db_backup "pre-rollback-$(git_run rev-parse --short "$CURRENT_HEAD")" "$RESTORE_DB")
say "已备份当前数据库：$BACKUP"

RESTORED=0
if [ -n "$RESTORE_DB" ]; then
  say "停止服务 $SERVICE ..."
  systemctl stop "$SERVICE" || die "停止服务失败"

  read -r DB_OWNER DB_GROUP DB_MODE <<< "$(stat -c '%U %G %a' "$DB_PATH" 2>/dev/null || printf 'wefit wefit 600')"
  say "恢复数据库：$RESTORE_DB → $DB_PATH"
  cp -- "$RESTORE_DB" "$DB_PATH"
  # 备份是 VACUUM INTO 的完整快照，不需要旧库的预写日志；残留 WAL 会被旧进程回放，必须清掉
  rm -f -- "$DB_PATH-wal" "$DB_PATH-shm"
  chown "$DB_OWNER:$DB_GROUP" "$DB_PATH"
  chmod "$DB_MODE" "$DB_PATH"
  RESTORED=1
fi

restart_and_verify

say "回滚完成：$CURRENT_DESC → $TARGET_DESC"
say "回滚前的数据库备份：$BACKUP"
if [ "$RESTORED" -eq 0 ] && [ -n "$DB_FILES" ]; then
  warn "本次没有恢复数据库；若发现数据读取异常，用 --restore-db 指定备份重跑"
fi
say "请在手机与电脑上刷新页面确认数据正常"
