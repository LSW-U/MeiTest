/**
 * Auth Module
 *
 * - JwtModule 注册（algorithm HS256）
 * - JwtStrategy 注册（passport-jwt）
 * - AuthService 导出
 * - AuthController 注册（正式生产端点：密码+SMS 登录注册刷新登出）
 * - MockLoginController 仅 dev/test 注册（staging/prod 路由不存在，防公网 mock 登录拿 super_admin）
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

/** MockLogin 仅 dev/test 注册（对齐 loginWithSms 自动注册守卫）；staging/prod 公网部署时 mock-login 路由不存在 */
const enableMockLogin =
  process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      // 每个 token 的 secret 在 signAsync / verifyAsync 时单独传
      signOptions: { algorithm: 'HS256' },
    }),
  ],
  controllers: enableMockLogin
    ? [AuthController, UnifiedAuthController, MockLoginController]
    : [AuthController, UnifiedAuthController],
  providers: [AuthService, UnifiedAuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
