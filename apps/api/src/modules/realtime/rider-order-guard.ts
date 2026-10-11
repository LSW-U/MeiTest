/**
 * 骑手-订单归属校验（WS location:update + HTTP /rider/location/report 共用）
 *
 * 决策依据：P0 后台定位 — 后端 HTTP 通道复用 WS handler 的骑手-订单绑定校验
 *   - realtime.gateway.ts handleLocationUpdate（WS 通道，P1-9 修复）
 *   - rider/location.controller.ts report（HTTP 通道，P0 后台定位）
 *
 * 返回值：
 *   - { ok: true }                          通过（含订单未派单 riderId=null 的放行场景）
 *   - { ok: false, reason: 'not_found' }    订单不存在
 *   - { ok: false, reason: 'no_profile' }   查无 RiderProfile（fail-closed）
 *   - { ok: false, reason: 'mismatch', assignedRiderId }  已派单但非本人
 */
import { db } from '../../shared/db';

export type AssertRiderOwnsOrderResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'no_profile' }
  | { ok: false; reason: 'mismatch'; assignedRiderId: string };

/**
 * 校验骑手对订单的位置上报权限。
 *
 * D9（20261012 热修，对齐批1 P1-2 修复先例）：入参是 JWT sub=User.id，
 * Order.riderId 存的是 RiderProfile.id（dispatch acceptTask/adminAssign/reassign
 * 三个写入点均经 resolveRiderProfileId 转换，dispatch.service.ts:354 注释先例），
 * 须先转 profile 再比对；查无 profile fail-closed 拒绝。
 *
 * riderId 可能为 null（订单未派单，抢单阶段）—— 此时放行（骑手可为自己即将抢的订单预热位置）。
 * 已派单（riderId 非空）时必须本人。
 */
export async function assertRiderOwnsOrder(
  orderId: string,
  riderId: string,
): Promise<AssertRiderOwnsOrderResult> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { riderId: true },
  });
  if (!order) {
    return { ok: false, reason: 'not_found' };
  }
  // D9：sub(User.id) → RiderProfile.id 转换后再与 order.riderId 比对
  const profile = await db.riderProfile.findUnique({
    where: { userId: riderId },
    select: { id: true },
  });
  if (!profile) {
    return { ok: false, reason: 'no_profile' };
  }
  if (order.riderId && order.riderId !== profile.id) {
    return { ok: false, reason: 'mismatch', assignedRiderId: order.riderId };
  }
  return { ok: true };
}
