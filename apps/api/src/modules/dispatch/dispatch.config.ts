/**
 * 配送静态配置（P11 ETA，2026-08-07）
 *
 * MVP 决策（方案 A）：ETA 用简单规则「now + DEFAULT_ETA_MINUTES」，
 * 不依赖地图 API / 距离公式（东帝汶地图数据差 + API 依赖 + 配额风险）。
 *
 * 创建 DeliveryTask 时（dispatch.service.ts createTaskForOrder）
 * 算 now + DEFAULT_ETA_MINUTES 写入 estimated_arrival 列。
 *
 * 经验值 45 分钟（东帝汶骑手配送平均时长）。若实际偏差大，改本常量即可，
 * **无需 migration**（旧任务 estimated_arrival 仍为 null，前端降级 etaPlaceholder）。
 *
 * 扩展点（本次不做）：多仓库差异化时效时，Warehouse 模型加 `defaultEtaMinutes Int?`，
 * 计算时 `warehouse.defaultEtaMinutes ?? DEFAULT_ETA_MINUTES`。
 *
 * 风格对齐：参考 payment-methods.config.ts（静态配置集中管理）。
 */

/** 预估送达时长（分钟），东帝汶骑手配送经验值 */
export const DEFAULT_ETA_MINUTES = 45;
