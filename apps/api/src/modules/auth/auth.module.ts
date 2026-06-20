/**
 * Auth Module
 *
 * - JwtModule 注册（algorithm HS256）
 * - JwtStrategy 注册（passport-jwt）
 * - AuthService 导出
 */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      // 每个 token 的 secret 在 signAsync / verifyAsync 时单独传
      signOptions: { algorithm: 'HS256' },
    }),
  ],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
