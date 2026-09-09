/**
 * User Module（W 流程 2026-06-24）
 *
 * 覆盖：profile / addresses / favorites / notifications 4 个 resource
 * 依赖：AuthService（复用 toContractRole helper）
 */
import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import {
  UserController,
  AddressController,
  FavoriteController,
  NotificationController,
} from './user.controller';
import { AdminUserController } from './admin-user.controller';
import { AuthModule } from '../auth/auth.module';
// 批A（2026-09-09）：通知实现收敛到 NotificationModule 的 NotificationService（委托注入）
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [AuthModule, NotificationModule],
  controllers: [
    UserController,
    AddressController,
    FavoriteController,
    NotificationController,
    AdminUserController,
  ],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
