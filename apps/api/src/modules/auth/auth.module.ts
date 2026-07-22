/**
 * Auth Module
 *
 * - JwtModule 注册（algorithm HS256）
 * - JwtStrategy 注册（passport-jwt）
 * - AuthService 导出
 * - AuthController 注册（正式生产端点：密码+SMS 登录注册刷新登出）
 * - MockLoginController 仅 dev/staging 注册（prod NODE_ENV=production 时路由不存在）
 */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthController } from './auth.controller';
import { UnifiedAuthController } from './unified-auth.controller';
import { UnifiedAuthService } from './unified-auth.service';
import { MockLoginController } from './mock-login.controller';

const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      // 每个 token 的 secret 在 signAsync / verifyAsync 时单独传
      signOptions: { algorithm: 'HS256' },
    }),
  ],
  controllers: isProduction
    ? [AuthController, UnifiedAuthController]
    : [AuthController, UnifiedAuthController, MockLoginController],
  providers: [AuthService, UnifiedAuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
