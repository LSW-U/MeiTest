/**
 * Rider Module — 注册 RiderService + 3 个 Controller
 *
 * Controllers：
 *   - RiderApplicationController（common 前缀，any role，入驻申请）
 *   - RiderController（rider 前缀，role=rider，工作台）
 *   - RiderApplicationAdminController（admin 前缀，role=super_admin，审核）
 */
import { Module } from '@nestjs/common';
import {
  RiderApplicationController,
  RiderController,
  RiderApplicationAdminController,
} from './rider.controller';
import { RiderService } from './rider.service';

@Module({
  controllers: [RiderApplicationController, RiderController, RiderApplicationAdminController],
  providers: [RiderService],
  exports: [RiderService],
})
export class RiderModule {}
