#!/bin/sh
# 数据库备份：容器启动时备份一次，之后每隔 BACKUP_INTERVAL 秒（默认一天）一次。
#
# - 文件是 pg_dump 的 custom 格式（自带压缩），用 pg_restore 恢复，步骤见 deploy/README.md
# - 本地（/backups，挂载到部署目录的 backups/）保留最近 BACKUP_KEEP_DAYS 天
# - 设置了 BACKUP_S3_BUCKET 时同时上传到 S3；S3 上保留多久用存储桶的生命周期规则管
# - 连接数据库用 libpq 的环境变量（PGHOST、PGUSER、PGPASSWORD、PGDATABASE）
# - 某一次失败只记日志，下一轮照常进行
# - 参数 once：只备份一次就退出
set -u

: "${BACKUP_INTERVAL:=86400}"
: "${BACKUP_KEEP_DAYS:=7}"
: "${BACKUP_S3_PREFIX:=}"

backup() {
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  name="pa-$stamp.dump"
  # 先写临时文件，成功后再改名：中途失败不会留下半个备份
  pg_dump --format=custom --no-owner --file="/backups/$name.partial" || return 1
  mv "/backups/$name.partial" "/backups/$name"
  echo "backup: wrote /backups/$name ($(du -h "/backups/$name" | cut -f1))"
  if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
    target="s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX$name"
    aws s3 cp --only-show-errors "/backups/$name" "$target" || return 1
    echo "backup: uploaded to $target"
  fi
  find /backups -name 'pa-*.dump' -mtime "+$BACKUP_KEEP_DAYS" -delete
}

# docker compose run --rm backup once：只备份一次就退出（例如在手动改数据之前）
if [ "${1:-}" = "once" ]; then
  backup
  exit $?
fi

while true; do
  if ! backup; then
    echo "backup: FAILED" >&2
    rm -f /backups/*.partial
  fi
  sleep "$BACKUP_INTERVAL"
done
