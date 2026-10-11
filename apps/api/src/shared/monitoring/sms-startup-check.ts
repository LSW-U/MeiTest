/**
 * SMS 启动软告警（批A R8 · 预研笔记⑤步骤5 + ④「R8 生产守卫挂点」）
 *
 * 语义（R8 原设计 → 安全专项收尾批1A 有意推翻 2026-10-11）：
 *   - gateway/tencent 凭据缺失两路：**保持软告警不退进程**（R8 原语义不变，
 *     SMS 拒发由 sendCode 运行时兜底 503 E-SMS-001，爆炸半径=登录而非整个 API）。
 *   - prod + SMS_STUB_ALLOWED=true（stub 逃生门开着）：三态判定（方案v3 §九 #1，
 *     总指挥 2026-10-11 拍板，取代 v2 的无条件 exit(1)）：
 *       · 未配置 SMS_STUB_ALLOWLIST（空/未配）→ **process.exit(1) fail-fast**
 *         （stub 逃生门在生产等价于向全网发固定验证码 123456，安全事故级配置，
 *         不允许带病运行——对 R8「不退进程」原语义的有意推翻点）；
 *       · 配置了非空白名单 → 放行启动（**演示形态**：仅白名单号码收固定码，
 *         配合 sendStub 内的白名单收窄，sms.strategy.ts R13）。
 * 本函数在 main.ts 的挂点（AppModule import 之后）。
 *
 * 检查覆盖：
 *   1. prod + SMS_STUB_ALLOWED=true + 无非空白名单 → process.exit(1)（fail-fast，方案v3 三态）
 *   1b. prod + SMS_STUB_ALLOWED=true + 非空白名单 → 放行（演示形态，不退进程）
 *   2. prod + SMS_PROVIDER=gateway + 网关凭据缺失 → error 日志（OTP 将拒发 E-SMS-001，软告警不变）
 *   3. prod + SMS_PROVIDER 未配置（默认解析为 tencent，批A2）+ 凭据缺失 → 同 2
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

  // 逃生门开着：三态判定（方案v3 §九 #1）——无非空白名单 = 全网固定码事故，exit(1)；
  // 有非空白名单 = 演示形态放行（sendStub 白名单收窄兜底，sms.strategy.ts R13）。
  // 英文报错便于运维日志检索，风格对齐 assertAllJwtSecrets。
  if (process.env.SMS_STUB_ALLOWED === 'true') {
    const allowlist = (process.env.SMS_STUB_ALLOWLIST ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowlist.length === 0) {
      logger.error({
        msg: 'SMS_STARTUP_FATAL',
        reason: 'STUB_ESCAPE_HATCH_ON',
        note: 'SMS_STUB_ALLOWED=true in production without a non-empty SMS_STUB_ALLOWLIST is a security incident: OTP codes would be the fixed stub code (123456) for everyone. Refusing to start (process.exit(1)). Remove the flag and configure a real SMS provider (tencent or gateway), or set SMS_STUB_ALLOWLIST (comma-separated E.164) for demo only.',
      });
      process.exit(1);
    }
    logger.warn({
      msg: 'SMS_STARTUP_WARNING',
      reason: 'STUB_ESCAPE_HATCH_ALLOWLISTED',
      count: allowlist.length,
      note: 'SMS_STUB_ALLOWED=true in production with SMS_STUB_ALLOWLIST configured (demo mode): only allowlisted phones receive the fixed stub code. Close the escape hatch once real SMS provider works.',
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
