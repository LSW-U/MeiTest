/**
 * Auth Module
 *
 * - JwtModule 注册（algorithm HS256）
 * - JwtStrategy 注册（passport-jwt）
 * - AuthService 导出
 * - MockLoginController 仅 dev/staging 注册（prod NODE_ENV=production 时路由不存在）
 */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
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
  // prod 不注册 MockLoginController，路由根本不存在（比方法内 throw 404 更安全）
  controllers: isProduction ? [] : [MockLoginController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
