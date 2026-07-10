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
import { RiderService } from './rider.service';

@Module({
  controllers: [
    RiderApplicationController,
    RiderController,
    RiderApplicationAdminController,
    AdminRiderController,
  ],
  providers: [RiderService],
  exports: [RiderService],
})
export class RiderModule {}
