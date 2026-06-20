/**
 * infrastructure 入口（外部服务抽象）
 *
 * 决策依据：CLAUDE.md §测试阶段支付/OTP 完整方案
 *   - 所有外部服务通过 interface 抽象
 *   - dev/staging/prod 三种环境配置走 .env
 *   - mock/stub 实现日志标 [MOCK] / [STUB] / [SMS_STUB] / [WA_STUB] / [GMAPS_STUB]
 */
// 支付（5 策略：2 真 + 3 mock/stub）
export * from './payment/payment.factory';

// OTP（3 策略：1 真 + 2 mock/stub）
export * from './otp/otp.factory';

// 密码策略（独立 export，不实现 OtpStrategy，LSP 修复）
export {
  passwordStrategy,
  PasswordStrategy,
  PasswordPolicyError,
  BCRYPT_COST,
} from './otp/password.strategy';

// 地图（stub，W6 切真）
export { mapClient } from './map/google-maps';
export type { MapClient, GeocodeResult, ReverseGeocodeInput, DistanceResult } from './map/map-client';

// 对象存储（MinIO dev / 阿里云 OSS prod）
export { minio, DEFAULT_BUCKET, uploadFile, deleteFile, presignUpload } from './oss/minio';
