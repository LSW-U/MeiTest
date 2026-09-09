/**
 * Dashboard 时间范围与增长率计算（数据分析报表模块 批A 2026-09-09 起 re-export）
 *
 * 纯函数本体已平移至 src/shared/statistics/range.ts（公共层，dashboard 与 statistics
 * 共用单一事实源）。本文件保留为 re-export 以兼容既有 import 路径，不再新增逻辑——
 * 新代码请直接 import shared/statistics/range。
 */
export {
  buildRange,
  growthPct,
  DILI_TZ,
  type Range,
} from '../../shared/statistics/range';
