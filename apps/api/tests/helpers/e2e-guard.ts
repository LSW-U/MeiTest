/**
 * e2e 探活守卫（批A2-3 · 增补#5：本地 API server 不在则 skip）
 *
 * 背景（批A2-1 审查定责产物）：e2e 套件打真 HTTP（E2E_API_URL 或 localhost:3000），
 * dev server 没起时 5 个 e2e 文件全红（连接拒绝），与「测试通过」混淆。
 * 决策9 列账项 → 守卫语义：server 不在 → describe.skip（整个文件跳过，非 fail）。
 *
 * 实现：模块加载时 top-level await 探活一次 GET {origin}/health（HealthController
 * @Public() liveness，无 /api/v1 前缀，main.ts 未设 setGlobalPrefix——路由字面量
 * 'api/v1/...' 挂在 controller 上）。fetch 任何网络错误/非 2xx → 视为 server 不在。
 *
 * 用法（每个 e2e 文件顶部）：
 *   import { describeWhenApiUp } from './helpers/e2e-guard';
 *   describeWhenApiUp('e2e: xxx', () => { ...原 describe body... });
 *
 * 注意：探活一次（模块加载后首个 describe 求值时），不做逐 it 重试——
 * 套件运行中途 server 挂掉属环境故障，应显式失败而非静默 skip。
 */
import { describe } from 'vitest';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';

/** 从 E2E_API_URL（…/api/v1）取 origin（http://localhost:3000），探 /health 用 */
function originOf(apiUrl: string): string {
  try {
    return new URL(apiUrl).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

/** server 是否在线（/health 2xx 即在；网络错误/非 2xx 一律视为不在线） */
export async function isApiServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${originOf(API)}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * e2e describe 守卫包装（同步版——vitest 的 describe 必须在模块加载（collection）
 * 阶段同步注册，异步包装会「No test suite found」）：
 * 模块加载时 top-level await 先探活一次，之后 describeWhenApiUp 同步分发
 * describe / describe.skip。
 */
export const API_SERVER_UP = await isApiServerUp();

if (!API_SERVER_UP) {
  console.warn(
    `[e2e-guard] API server 不在线（${originOf(API)}/health 不通）→ e2e 套件全部 skip。` +
      '先 docker compose up -d + pnpm --filter @meimart/api dev，或设 E2E_API_URL 指向运行中的实例。',
  );
}

/**
 * e2e describe 守卫：server 在线 → 正常 describe；不在线 → describe.skip 全文件跳过。
 * 与原生 describe 签名一致（name + fn），fn 内 it/beforeAll/afterAll 照常写。
 */
export function describeWhenApiUp(name: string, fn: () => void): void {
  (API_SERVER_UP ? describe : describe.skip)(name, fn);
}
