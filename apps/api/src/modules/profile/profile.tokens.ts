/**
 * Profile DI tokens（独立文件避免 module↔service 循环 import TDZ——P1-1 家族红线：
 * 字符串常量两端逐字一致）
 */

/** BehaviorInsightService DI token（批5 A7/A8 并入画像） */
export const BEHAVIOR_INSIGHT_SERVICE_TOKEN = 'BehaviorInsightServiceToken';
