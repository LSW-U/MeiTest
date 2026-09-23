/**
 * SMS 启动软告警（批A R8 · 预研笔记⑤步骤5 + ④「R8 生产守卫挂点」）
 *
 * 语义（R8 明确）：**不 throw 不退进程** —— 与 assertAllJwtSecrets / WS_URL /
 * CORS_ORIGIN 的 fail-fast 刻意不同。SMS 拒发已由策略 sendCode 运行时兜底
 * （P1-1 审查修复后：构造期不校验凭据，缺凭据在 sendCode 拒发 503 E-SMS-001，
 * 爆炸半径=登录而非整个 API），启动告警只负责「让运维在启动日志里提前看到
 * 漏配」，不因 SMS 配置问题阻断整个 API 服务——本函数在 main.ts 的挂点
 * （AppModule import 之后）因此恢复实际作用。
 *
 * 软告警覆盖：
 *   1. prod + SMS_PROVIDER=gateway + 网关凭据缺失 → error 日志（OTP 将拒发 E-SMS-001）
 *   2. prod + SMS_STUB_ALLOWED=true → error 日志（逃生门开着，生产在发 stub 码）
 *   3. prod + SMS_PROVIDER 未配置（默认解析为 tencent，批A2）+ 凭据缺失 → 同 1
 *   4. prod + SMS_PROVIDER=tencent + 腾讯云凭据缺失 → error 日志（批A2，不退进程）
 *
 * dev 不告警（dev 默认 stub 是正常形态）。挂点：main.ts assertAllJwtSecrets 之后。
 */
import { logger } from '../logger/logger';
import { readSmsGatewayConfig } from '../../infrastructure/otp/sms-gateway.client';
import { readTencentSmsConfig } from '../../infrastructure/otp/tencent-sms.strategy';
import { resolveProvider } from '../../infrastructure/otp/sms.strategy';

export function assertSmsStartupConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const provider = resolveProvider();

  // 逃生门开着：生产在发 stub 固定码，必须让运维看见
  if (process.env.SMS_STUB_ALLOWED === 'true') {
    logger.error({
      msg: 'SMS_STARTUP_WARNING',
      reason: 'STUB_ESCAPE_HATCH_ON',
      note: 'SMS_STUB_ALLOWED=true in production: OTP codes are stub (123456), real users cannot receive SMS. Close it once gateway credentials are fixed.',
    });
  }

  // 网关通道但凭据缺失：OTP 拒发（E-SMS-001），启动不退进程但要 loud
  if (provider === 'gateway' && !readSmsGatewayConfig()) {
    logger.error({
      msg: 'SMS_STARTUP_WARNING',
      reason: 'GATEWAY_CREDENTIALS_MISSING',
      provider,
      note: 'SMS_PROVIDER resolves to gateway but SMS_GATEWAY_URL / SMS_GATEWAY_AUTH_VALUE / SMS_GATEWAY_PAYLOAD_TEMPLATE are missing or invalid. OTP SMS will be refused (E-SMS-001). Set SMS_PROVIDER=stub or SMS_STUB_ALLOWED=true only as emergency.',
    });
  }

  // 批A2：tencent 通道但凭据缺失 —— 同款软告警语义（error 不退进程，拒发在 sendCode 运行时）
  if (provider === 'tencent' && !readTencentSmsConfig()) {
    logger.error({
      msg: 'SMS_STARTUP_WARNING',
      reason: 'TENCENT_CREDENTIALS_MISSING',
      provider,
      note: 'SMS_PROVIDER resolves to tencent but TENCENT_SMS_SECRET_ID / TENCENT_SMS_SECRET_KEY / TENCENT_SMS_SDK_APP_ID / TENCENT_SMS_TEMPLATE_ID are missing. OTP SMS will be refused (E-SMS-001). Set SMS_PROVIDER=stub or SMS_STUB_ALLOWED=true only as emergency.',
    });
  }
}
