/**
 * rider-order-guard 三态单测（A2.9c，D9 热修）
 *
 * D9（方案v3 20261012 裁定）：assertRiderOwnsOrder 入参是 JWT sub=User.id，
 * 须先经 riderProfile.findUnique 转 RiderProfile.id 再比对 order.riderId
 * （对齐批1 P1-2 修复先例与 dispatch.service resolveRiderProfileId 先例）。
 *
 * 三态：
 *   1. 本人（已派单，riderId=本人 profile id）→ 放行
 *   2. 他人（已派单，riderId=别的骑手 profile id）→ mismatch 拒绝
 *   3. 未派单（riderId=null，抢单阶段）→ 放行
 * 附加：查无 profile → fail-closed 拒绝；订单不存在 → not_found
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertRiderOwnsOrder } from '../src/modules/realtime/rider-order-guard';
import { db } from '../src/shared/db';

vi.mock('../src/shared/db', () => ({
  db: {
    order: {
      findUnique: vi.fn(),
    },
    riderProfile: {
      findUnique: vi.fn(),
    },
  },
}));

describe('assertRiderOwnsOrder（A2.9c 三态）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认：sub='rider-1' → profile id='profile-rider-1'
    (db.riderProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'profile-rider-1',
    });
  });

  it('本人（已派单给本人 profile）→ 放行 ok:true', async () => {
    (db.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      riderId: 'profile-rider-1',
    });

    const result = await assertRiderOwnsOrder('order-1', 'rider-1');

    expect(result).toEqual({ ok: true });
    // D9 断言：确实走了 sub → profile 转换
    expect(db.riderProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: 'rider-1' },
      select: { id: true },
    });
  });

  it('他人（已派单给其他骑手）→ mismatch 拒绝并回 assignedRiderId', async () => {
    (db.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      riderId: 'profile-someone-else',
    });

    const result = await assertRiderOwnsOrder('order-1', 'rider-1');

    expect(result).toEqual({
      ok: false,
      reason: 'mismatch',
      assignedRiderId: 'profile-someone-else',
    });
  });

  it('未派单（riderId=null，抢单阶段）→ 放行 ok:true', async () => {
    (db.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ riderId: null });

    const result = await assertRiderOwnsOrder('order-1', 'rider-1');

    expect(result).toEqual({ ok: true });
  });

  it('查无 RiderProfile → fail-closed 拒绝（no_profile）', async () => {
    (db.riderProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await assertRiderOwnsOrder('order-1', 'rider-noprofile');

    expect(result).toEqual({ ok: false, reason: 'no_profile' });
  });

  it('订单不存在 → not_found', async () => {
    (db.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await assertRiderOwnsOrder('order-404', 'rider-1');

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});
