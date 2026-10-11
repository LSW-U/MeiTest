/**
 * 存量假 Settlement 清洗脚本（P0-1 D2，方案v2-后端资金越权并发修复 20261011 §四）
 *
 * 背景：MockOrderAggregator 生成的结算单无真实订单依据，金额虚构，且直接污染
 *   getAvailableBalance 派生链（withdraw.service.ts:298-321）。Settlement 表无来源
 *   标识列 → 不能按来源过滤 → 按方案 v2 §四 定稿口径【全量删除重算】。
 *
 * 口径（方案 v2 §四）：
 *   1. 先统计各 (subjectType) 分布并打印 —— 若发现**非 Mock 来源特征**的记录
 *      （本仓 Real 聚合器 2026-10-11 才首次存在，此前的记录全部产自 Mock；
 *      人工插入无法程序化识别，脚本只打印分布供人核）→ 有疑义请先停手上报②再执行。
 *   2. 删除范围：全表（含 PENDING/CONFIRMED/PAID/DISPUTED 所有状态）。
 *      ⚠️ 生产环境执行前必须人工确认（脚本 --force 才真正删除，默认 dry-run）。
 *   3. 重算：不在此脚本内做 —— T+1 SettleScheduler 次日 02:00 Asia/Dili 自动按
 *      RealOrderAggregator 重新生成；如需立即重算，手动触发 run-settlement job。
 *   4. 幂等：第二次执行删除数为 0（本脚本自身可重复跑，不依赖外部状态）。
 *
 * 运行方式（apps/api 目录下）：
 *   npx tsx scripts/cleanup-mock-settlements.ts            # dry-run：只统计打印
 *   npx tsx scripts/cleanup-mock-settlements.ts --force    # 实删
 *
 * 幂等验证（任务书 A2.2）：
 *   --force 跑两次，第二次应输出 deleted=0。
 */
import { PrismaClient } from '../src/prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const force = process.argv.includes('--force');

  // 1. 执行前分布（供人工核来源；Mock 记录无审计痕迹列，分布仅作参照）
  const byStatus = await prisma.settlement.groupBy({
    by: ['subjectType', 'status'],
    _count: { _all: true },
  });
  console.log('[cleanup] 执行前 Settlement 分布（subjectType × status）:');
  for (const row of byStatus) {
    console.log(
      `  subjectType=${row.subjectType} status=${row.status} count=${row._count._all}`,
    );
  }
  const total = await prisma.settlement.count();
  console.log(`[cleanup] 全表总数: ${total}`);

  if (total === 0) {
    console.log('[cleanup] 表为空，无需清洗（幂等：重复执行同样 0 删除）');
    return;
  }

  if (!force) {
    console.log('[cleanup] dry-run 模式（未删除）。确认后加 --force 实删。');
    return;
  }

  // 2. 全量删除（方案 v2 §四：删除重算，含全部状态）
  const deleted = await prisma.settlement.deleteMany({});
  console.log(`[cleanup] 已删除 Settlement 记录: ${deleted.count} 条`);

  // 3. 幂等自证：删后计数必须为 0
  const after = await prisma.settlement.count();
  console.log(`[cleanup] 删除后全表总数: ${after}（应=0）`);
  if (after !== 0) {
    throw new Error(`cleanup failed: ${after} rows remain after deleteMany`);
  }
  console.log('[cleanup] 完成。重算由 SettleScheduler（T+1 02:00 Asia/Dili）按 RealOrderAggregator 自动执行。');
}

main()
  .catch((err: Error) => {
    console.error('[cleanup] 失败:', err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
