/**
 * 孤儿清理配置（upload 模块批C U4/U4P，2026-09-10）
 *
 * - cron 非整点错峰（04:17 Asia/Dili 低峰）
 * - 宽限期 7 天：新上传对象即使无引用也不删（防「先传后引用」窗口误删）
 * - execute 开关：env ORPHAN_CLEANUP_EXECUTE=true 才真删，默认 dry-run（灰度安全）
 */
/** 每日清理 cron（04:17 Asia/Dili，非整点错峰避免整点任务洪峰） */
export const ORPHAN_CLEANUP_CRON_PATTERN = '17 4 * * *';

/** cron 时区（东帝汶 UTC+9，与订单/结算定时任务一致） */
export const ORPHAN_CLEANUP_CRON_TZ = 'Asia/Dili';

/** repeatable job 去重 key（BullMQ repeat.key，禁同时指定 jobId） */
export const ORPHAN_CLEANUP_REPEAT_KEY = 'orphan-cleanup-daily';

/** job 名 */
export const ORPHAN_CLEANUP_JOB_NAME = 'cleanup-orphans';

/** 宽限期天数：无引用且 lastModified 早于此才判孤儿（防先传后引用窗口误删） */
export const ORPHAN_CLEANUP_GRACE_PERIOD_DAYS = 7;

/** 真删开关（env ORPHAN_CLEANUP_EXECUTE=true，默认 false=dry-run 只统计记日志） */
export function isOrphanCleanupExecuteEnabled(): boolean {
  return process.env.ORPHAN_CLEANUP_EXECUTE === 'true';
}
