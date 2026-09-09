/**
 * Device Token Service — 设备推送 token 注册/注销（批A A1，2026-09-09）
 *
 * 设计（方案v2 §3.1/§3.2）：
 *   - DeviceToken 表：token @unique（Expo PushToken 全局唯一），upsert by token 幂等
 *     —— 重注册更新 lastSeenAt + locale，不产生重复行（验收 A1：幂等）
 *   - User 表无 locale 字段 → token.locale 注册时快照，推送文案语言来源（en 兜底）
 *   - status：ACTIVE | INVALID（Expo 回执 NotRegistered 置 INVALID，A2 清脏 token）
 *
 * 端点归属（2026-09-09 调度裁决，双端点）：
 *   - POST/DELETE /api/v1/client/device-tokens（@Roles('CUSTOMER')，deviceType=client_app）
 *   - POST/DELETE /api/v1/rider/device-tokens（@Roles('RIDER')，deviceType=rider_app）
 *   —— DeviceTypeGuard 对 /client/* 强制 client_app，单端点双角色不成立（rider 会 403）
 *
 * DI：tsx 无 decorator metadata，controller 必须显式 @Inject(DeviceTokenService)。
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { RegisterDeviceTokenRequest, DeleteDeviceTokenRequest } from '@meimart/api-contract';

type RegisterInput = z.infer<typeof RegisterDeviceTokenRequest>;
type DeleteInput = z.infer<typeof DeleteDeviceTokenRequest>;

@Injectable()
export class DeviceTokenService {
  /**
   * 注册/刷新推送 token（upsert by token 幂等）
   *
   * - 新 token：建行（status=ACTIVE，lastSeenAt=now）
   * - 已有 token：更新 userId / platform / locale / lastSeenAt / status 复位 ACTIVE
   *   （换账号登录同一设备时 token 归属切换到新用户；重装后 INVALID 复位）
   */
  async register(userId: string, input: RegisterInput) {
    const row = await db.deviceToken.upsert({
      where: { token: input.token },
      create: {
        userId,
        token: input.token,
        platform: input.platform,
        locale: input.locale,
        status: 'ACTIVE',
      },
      update: {
        userId,
        platform: input.platform,
        locale: input.locale,
        status: 'ACTIVE',
        lastSeenAt: new Date(),
      },
    });
    logger.info({
      msg: 'DEVICE_TOKEN_REGISTERED',
      userId,
      platform: input.platform,
      locale: input.locale,
      tokenTail: input.token.slice(-8),
    });
    return {
      id: row.id,
      platform: row.platform,
      locale: row.locale,
      status: row.status,
      lastSeenAt: row.lastSeenAt.toISOString(),
    };
  }

  /**
   * 注销推送 token（登出时调用，按 token 删）
   *
   * 幂等：token 不存在/不属于当前用户也返回 success（登出场景不因残留 token 失败）；
   * 归属校验防误删他人 token（deleteMany 带 userId 条件）。
   */
  async unregister(userId: string, input: DeleteInput) {
    const result = await db.deviceToken.deleteMany({
      where: { token: input.token, userId },
    });
    if (result.count === 0) {
      logger.warn({
        msg: 'DEVICE_TOKEN_UNREGISTER_MISS',
        userId,
        tokenTail: input.token.slice(-8),
      });
    }
    return { success: true as const };
  }
}
