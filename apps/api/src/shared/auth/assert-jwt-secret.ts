/**
 * JWT secret bootstrap 校验
 *
 * 决策依据：W1 审查报告 P0-1
 *   - 原 JwtStrategy 构造函数 `secretOrKey: process.env.JWT_ACCESS_SECRET ?? ''`，空字符串
 *     不触发 `??`，passport-jwt 用空字符串 verify 全部静默失败
 *   - AuthService getter 已校验长度，但 Strategy 没用 → 两处不一致
 *
 * 修复策略：
 *   1. 抽 assertJwtSecret() 共享给 Strategy + AuthService
 *   2. main.ts 启动最早调 assertAllJwtSecrets()（NestFactory.create 之前）
 *      → 漏配时 bootstrap 直接 fail，运维看启动日志秒定位
 *   3. Strategy + Service 各自也调（DI 实例化时二次校验，防 main.ts 漏调）
 */

const MIN_LENGTH = 32;

export type JwtSecretEnvName = 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET';

/**
 * 校验单个 JWT secret env，返回原值
 *
 * 两种失败状态区分（便于运维定位）：
 *   - 未设（undefined）：env var 漏加
 *   - 长度 < 32（含空字符串）：env var 配置错误
 *
 * @throws Error env 未设 / 长度 < 32
 */
export function assertJwtSecret(envName: JwtSecretEnvName): string {
  const s = process.env[envName];
  if (s === undefined) {
    throw new Error(`${envName} is not set (env var missing). Generate with: openssl rand -base64 48`);
  }
  if (s.length < MIN_LENGTH) {
    throw new Error(
      `${envName} must be >= ${MIN_LENGTH} chars (current: ${s.length}). Generate with: openssl rand -base64 48`,
    );
  }
  return s;
}

/** 启动时一次性校验 access + refresh，main.ts 最早阶段调用 */
export function assertAllJwtSecrets(): void {
  assertJwtSecret('JWT_ACCESS_SECRET');
  assertJwtSecret('JWT_REFRESH_SECRET');
}
