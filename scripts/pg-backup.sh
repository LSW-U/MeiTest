#!/bin/bash
# pg_dump 定时备份脚本（cron job）
#
# 用法：
#   ./scripts/pg-backup.sh
#
# Cron 示例（每天 2:00 AM）：
#   0 2 * * * /opt/meimart/scripts/pg-backup.sh >> /var/log/meimart-backup.log 2>&1
#
# 输出：
#   备份文件：/opt/meimart/backups/meimart-YYYYMMDD-HHMM.sql.gz
#   最新备份符号链接：/opt/meimart/backups/latest.sql.gz

set -e

# 配置
BACKUP_DIR="/opt/meimart/backups"
DB_NAME="meimart"
DB_USER="postgres"
DB_HOST="localhost"
DB_PORT="5432"
KEEP_DAYS=7  # 保留最近 7 天备份

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 生成备份文件名
TIMESTAMP=$(date +"%Y%m%d-%H%M")
BACKUP_FILE="$BACKUP_DIR/meimart-$TIMESTAMP.sql.gz"

# 执行备份（gzip 压缩）
echo "[$TIMESTAMP] Starting backup..."
docker exec meimart-pg pg_dump -U "$DB_USER" -d "$DB_NAME" -F p -f /tmp/backup.sql

# 从容器复制到宿主机并压缩
docker cp meimart-pg:/tmp/backup.sql "$BACKUP_DIR/backup-$TIMESTAMP.sql"
gzip -c "$BACKUP_DIR/backup-$TIMESTAMP.sql" > "$BACKUP_FILE"
rm "$BACKUP_DIR/backup-$TIMESTAMP.sql"

# 更新 latest 符号链接
ln -sf "$BACKUP_FILE" "$BACKUP_DIR/latest.sql.gz"

# 清理旧备份（保留最近 N 天）
find "$BACKUP_DIR" -name "meimart-*.sql.gz" -mtime +$KEEP_DAYS -delete

# 备份大小
SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$TIMESTAMP] Backup completed: $BACKUP_FILE (size: $SIZE)"

# 失败告警（发送到 Sentry webhook 或邮件）
# 这里示例用 curl 发送到 webhook，生产环境需配置真实告警渠道
if [ $? -eq 0 ]; then
  echo "[$TIMESTAMP] ✅ Backup success"
else
  echo "[$TIMESTAMP] ❌ Backup failed"
  # 告警（生产环境需配置）
  curl -s -X POST "${SENTRY_ALERT_WEBHOOK:-}" -d '{"message":"pg_dump backup failed"}' || true
  exit 1
fi