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

/** 骑手等级（配送积分门槛：BRONZE 0+ / SILVER 100+ / GOLD 500+ / PLATINUM 2000+） */
export const RiderTier = z.enum(['BRONZE', 'SILVER', 'GOLD', 'PLATINUM']);

/** 骑手申请状态 */
export const ApplicationStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

/** OSS 图片 URL（apply/update 通用，可选） */
const ImageUrl = z.string().url().max(2048).optional().nullable();

/** 骑手资料视图 */
export const RiderProfile = z.object({
  id: Id,
  userId: Id,
  riderName: z.string(),
  phone: z.string(),
  vehicleType: VehicleType,
  vehiclePlate: z.string().nullable(),
  status: RiderStatus,
  applicationStatus: ApplicationStatus,
  totalDeliveries: z.number().int().nonnegative(),
  rating: z.number().min(0).max(5),
  // W3 骑手个人区（2026-08-24）：证件/头像 URL + 配送积分/等级
  avatarUrl: z.string().url().nullable(),
  idCardImageUrl: z.string().url().nullable(),
  licenseImageUrl: z.string().url().nullable(),
  points: z.number().int().nonnegative(),
  tier: RiderTier,
  preferredWarehouseIds: z.array(Id),
  isOnline: z.boolean(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** 入驻申请请求（common/rider/apply，apply payload 带 URL 方案） */
export const ApplyRiderRequest = z.object({
  riderName: z.string().min(1).max(50),
  phone: z.string().min(6).max(20),
  vehicleType: VehicleType.optional(),
  vehiclePlate: z.string().max(20).optional(),
  idCardNumber: z.string().min(6).max(30),
  avatarUrl: ImageUrl,
  idCardImageUrl: ImageUrl,
  licenseImageUrl: ImageUrl,
  preferredWarehouseIds: z.array(Id).optional(),
});

/**
 * 骑手自助改资料请求（rider/profile，PATCH）
 *
 * 不可改字段（F2 2026-08-24 审查报告）：
 *   - idCardNumber：换号=换人，应重新走 apply 审核
 *   - phone：换号涉及登录态 + SMS 验证 + 唯一性 + token revoke，应走 auth.changePhone，
 *     不在自助改资料范围（与 idCardNumber 同决策，避免无验证改号后门）
 */
export const UpdateRiderProfileRequest = z.object({
  riderName: z.string().min(1).max(50).optional(),
  vehicleType: VehicleType.optional(),
  vehiclePlate: z.string().max(20).nullable().optional(),
  avatarUrl: ImageUrl,
  idCardImageUrl: ImageUrl,
  licenseImageUrl: ImageUrl,
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
