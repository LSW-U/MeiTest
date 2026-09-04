/**
 * Rider Module - 注册 RiderService + 4 个 Controller
 *
 * Controllers：
 *   - RiderApplicationController（common 前缀，customer role，入驻申请）
 *   - RiderController（rider 前缀，role=rider，工作台）
 *   - RiderApplicationAdminController（admin 前缀，role=super_admin，审核）
 *   - AdminRiderController（admin/riders 前缀，role=super_admin，骑手 CRUD W7-ext-D）
 */
import { Module } from '@nestjs/common';
import {
  RiderApplicationController,
  RiderController,
  RiderApplicationAdminController,
} from './rider.controller';
import { AdminRiderController } from './admin-rider.controller';
import { RiderLocationController } from './location.controller';
import { RiderService } from './rider.service';
import { RiderDepositController } from './deposit.controller';
import { RiderDepositService } from './deposit.service';
import { AdminDepositController, AdminDepositAggregateController } from './admin-deposit.controller';
import { AdminDepositService } from './admin-deposit.service';
import { DepositEligibilityService } from './deposit-eligibility.service';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  // RealtimeModule 提供 RealtimeGateway（RiderLocationController 注入，
  // 复用 WS 广播 order:location，与 dispatch.module 同模式）
  imports: [RealtimeModule],
  controllers: [
    RiderApplicationController,
    RiderController,
    RiderApplicationAdminController,
    AdminRiderController,
    RiderLocationController,
    // 保证金（批 B，2026-09-02）：骑手侧 3 端点
    RiderDepositController,
    // 保证金 admin 侧（批 C，2026-09-02）：tiers/locations/requests + 聚合详情/仓负载
    AdminDepositController,
    AdminDepositAggregateController,
  ],
  providers: [RiderService, RiderDepositService, AdminDepositService, DepositEligibilityService],
  exports: [RiderService, RiderDepositService, AdminDepositService, DepositEligibilityService],
})
export class RiderModule {}
