/**
 * Device Token Controllers — 设备推送 token 注册/注销（批A A1，2026-09-09）
 *
 * 双端点（2026-09-09 调度裁决）：DeviceTypeGuard 对 /client/* 强制 deviceType=client_app，
 * /rider/* 强制 rider_app——单端点声明 CUSTOMER+RIDER 双角色不成立（rider 调 /client/* 403），
 * 故 client 与 rider 各一份路由，body/实现同构（复用 DeviceTokenService）。
 *
 * 端点：
 *   POST   /api/v1/client/device-tokens   @Roles('CUSTOMER')
 *   DELETE /api/v1/client/device-tokens   @Roles('CUSTOMER')
 *   POST   /api/v1/rider/device-tokens    @Roles('RIDER')
 *   DELETE /api/v1/rider/device-tokens    @Roles('RIDER')
 *
 * 三道全局 Guard（Jwt → DeviceType → Roles）已注册，controller 不写 @UseGuards。
 */
import { Controller, Post, Delete, Body, Inject, HttpCode, HttpStatus, Request } from '@nestjs/common';
import { z } from 'zod';
import { RegisterDeviceTokenRequest, DeleteDeviceTokenRequest } from '@meimart/api-contract';
import { DeviceTokenService } from './device-token.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

type RegisterBody = z.infer<typeof RegisterDeviceTokenRequest>;
type DeleteBody = z.infer<typeof DeleteDeviceTokenRequest>;

/** client 端（CUSTOMER，deviceType=client_app） */
@Controller('api/v1/client/device-tokens')
@Roles('CUSTOMER')
export class ClientDeviceTokenController {
  constructor(@Inject(DeviceTokenService) private readonly deviceTokens: DeviceTokenService) {}

  /** 注册/刷新推送 token（upsert by token 幂等，重注册不产生重复行） */
  @Post()
  async register(@Request() req: { user: RequestUser }, @Body(new ZodValidationPipe(RegisterDeviceTokenRequest)) body: RegisterBody) {
    const data = await this.deviceTokens.register(req.user.sub, body);
    return { success: true as const, data };
  }

  /** 登出注销（按 token 删，幂等） */
  @Delete()
  @HttpCode(HttpStatus.OK)
  @Audit({ resource: 'DeviceToken', skip: true })
  async unregister(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(DeleteDeviceTokenRequest)) body: DeleteBody,
  ) {
    const data = await this.deviceTokens.unregister(req.user.sub, body);
    return { success: true as const, data };
  }
}

/** rider 端（RIDER，deviceType=rider_app；与 A3 /rider/notifications 同构） */
@Controller('api/v1/rider/device-tokens')
@Roles('RIDER')
export class RiderDeviceTokenController {
  constructor(@Inject(DeviceTokenService) private readonly deviceTokens: DeviceTokenService) {}

  @Post()
  async register(@Request() req: { user: RequestUser }, @Body(new ZodValidationPipe(RegisterDeviceTokenRequest)) body: RegisterBody) {
    const data = await this.deviceTokens.register(req.user.sub, body);
    return { success: true as const, data };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @Audit({ resource: 'DeviceToken', skip: true })
  async unregister(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(DeleteDeviceTokenRequest)) body: DeleteBody,
  ) {
    const data = await this.deviceTokens.unregister(req.user.sub, body);
    return { success: true as const, data };
  }
}
