#!/bin/bash
# pg_restore 演练脚本
#
# 用法：
#   ./scripts/pg-restore-test.sh [backup-file]
#
# 参数：
#   backup-file: 可选，默认使用 latest.sql.gz
#
# 流程：
#   1. 创建临时测试数据库 meimart_test
#   2. 从备份恢复数据
#   3. 验证关键表数据完整性
#   4. 清理测试数据库

set -e

BACKUP_DIR="/opt/meimart/backups"
DB_NAME="meimart"
DB_TEST_NAME="meimart_test"
DB_USER="postgres"

# 选择备份文件
if [ -n "$1" ]; then
  BACKUP_FILE="$1"
else
  BACKUP_FILE="$BACKUP_DIR/latest.sql.gz"
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "❌ Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "=== pg_restore 演练 ==="
echo "备份文件: $BACKUP_FILE"
echo "测试数据库: $DB_TEST_NAME"

# 解压备份文件
TMP_SQL="/tmp/restore-test.sql"
gunzip -c "$BACKUP_FILE" > "$TMP_SQL"

# 创建测试数据库
echo "[1/4] 创建测试数据库..."
docker exec meimart-pg psql -U "$DB_USER" -c "DROP DATABASE IF EXISTS $DB_TEST_NAME;"
docker exec meimart-pg psql -U "$DB_USER" -c "CREATE DATABASE $DB_TEST_NAME;"

# 恢复数据
echo "[2/4] 恢复数据..."
docker cp "$TMP_SQL" meimart-pg:/tmp/restore-test.sql
docker exec meimart-pg psql -U "$DB_USER" -d "$DB_TEST_NAME" -f /tmp/restore-test.sql

# 验证数据完整性
echo "[3/4] 验证数据完整性..."
ORDERS_COUNT=$(docker exec meimart-pg psql -U "$DB_USER" -d "$DB_TEST_NAME" -t -c "SELECT COUNT(*) FROM orders;")
PRODUCTS_COUNT=$(docker exec meimart-pg psql -U "$DB_USER" -d "$DB_TEST_NAME" -t -c "SELECT COUNT(*) FROM products;")
WAREHOUSES_COUNT=$(docker exec meimart-pg psql -U "$DB_USER" -d "$DB_TEST_NAME" -t -c "SELECT COUNT(*) FROM warehouses;")

echo "  orders: $ORDERS_COUNT"
echo "  products: $PRODUCTS_COUNT"
echo "  warehouses: $WAREHOUSES_COUNT"

# 清理测试数据库
echo "[4/4] 清理测试数据库..."
docker exec meimart-pg psql -U "$DB_USER" -c "DROP DATABASE $DB_TEST_NAME;"
rm "$TMP_SQL"

echo "=== ✅ Restore 演练完成 ==="