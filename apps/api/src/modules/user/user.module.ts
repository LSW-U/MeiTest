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

@Module({
  imports: [AuthModule],
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
