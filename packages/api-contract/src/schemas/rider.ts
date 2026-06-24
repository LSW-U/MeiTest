/**
 * 骑手模块 schema（骑手资料 + 在线状态 + 班次）
 *
 * 决策依据：
 * - schema.prisma 已有 RiderProfile 表
 * - W2 仅给骑手 App 骨架（登录/上下班），W3 接入 dispatch
 */
import { z } from 'zod';
import { Id, IsoTimestamp } from './common';

/** 骑手状态（与 schema.prisma RiderStatus 同步） */
export const RiderStatus = z.enum(['OFFLINE', 'ONLINE', 'BUSY']);

/** 车辆类型 */
export const VehicleType = z.enum(['MOTORCYCLE', 'BICYCLE', 'CAR']);

/** 骑手资料视图 */
export const RiderProfile = z.object({
  id: Id,
  userId: Id,
  riderName: z.string(),
  phone: z.string(),
  vehicleType: VehicleType,
  vehiclePlate: z.string().nullable(),
  status: RiderStatus,
  totalDeliveries: z.number().int().nonnegative(),
  rating: z.number().min(0).max(5),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** 接单模式（抢单 vs 系统派单） */
export const AcceptMode = z.enum(['GRAB', 'AUTO_DISPATCH']);

/** 切换上下班请求 */
export const UpdateDutyStatusRequest = z.object({
  status: RiderStatus,
  /** 上班时切换接单模式 */
  acceptMode: AcceptMode.optional(),
});

/** 骑手当前位置上报（WS 已有，HTTP 兜底用） */
export const ReportLocationRequest = z.object({
  lat: z.number(),
  lng: z.number(),
  speed: z.number().optional(),
  heading: z.number().min(0).max(360).optional(),
  orderId: Id.optional(),
});
