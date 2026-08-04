#!/usr/bin/env bash
# P2-1 trigram POC: temp PG container to verify pg_trgm selectivity on CJK short words (go/no-go gate)
# 用法：bash docs/poc/w3-catalog-trgm-poc/run.sh
# 清理：脚本末尾自动 docker rm -f 临时容器
#
# 通过判据：建索引后 5 语言 OR 走 BitmapOr + 5x BitmapIndexScan（非 SeqScan），
#          且中文 2-3 字词（苹果/巧克力）单语言查询走 BitmapIndexScan。
# 失败处理：trigram 对中文不达预期 → 方案回炉（评估 FTS / zhparser），非局部回退。
#
# 注：可执行部分强制 ASCII，规避 macOS 自带 bash 3.2 多字节变量名 bug
#     （$VAR 后紧跟 UTF-8 多字节字符会被吸进变量名）。

set -euo pipefail

IMAGE=postgres:16-alpine
CONTAINER=meimart-trgm-poc
DB=trgm_poc
USER=postgres

cd "$(dirname "$0")"

echo ">>> starting temp PG container [$CONTAINER] image [$IMAGE] ..."
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_DB="$DB" -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" >/dev/null

trap 'docker rm -f "$CONTAINER" >/dev/null 2>&1 || true' EXIT

echo ">>> waiting for PG ready + DB [$DB] initialized ..."
# pg_isready 只查端口，POSTGRES_DB 在 init 阶段才建；用 psql 连目标库判断真正就绪
until docker exec "$CONTAINER" psql -U "$USER" -d "$DB" -c '\q' >/dev/null 2>&1; do
  sleep 0.3
done

run() { docker exec -i "$CONTAINER" psql -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 "$@"; }

echo ">>> [01] create schema ..."
run < 01-schema.sql >/dev/null

echo ">>> [02] seed 10000 rows (10 words x 1000, 5 langs) ..."
run < 02-seed.sql

echo ""
echo "################ BEFORE INDEX (expect SeqScan) ################"
run < 03-explain-before.sql

echo ""
echo ">>> [04] create pg_trgm extension + 5 GIN expression indexes ..."
run < 04-indexes.sql

echo ""
echo "################ AFTER INDEX (expect BitmapOr + 5x BitmapIndexScan) ################"
run < 05-explain-after.sql

echo ""
echo ">>> POC done (container auto-cleaned). Fill README.md with verdict."
