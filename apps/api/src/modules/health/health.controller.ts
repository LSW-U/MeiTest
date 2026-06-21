/**
 * Health Controller
 *
 * - GET /health → 进程存活（总是 200，k8s liveness probe）
 * - GET /ready → 依赖就绪检查（db + redis，k8s readiness probe）
 *
 * @Public() 让全局 JwtAuthGuard 启用后仍可被 k8s probe 访问
 */
import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { Public } from '../../shared/decorators/public.decorator';
import { db } from '../../shared/db';
import { redis } from '../../shared/cache';

async function checkDatabase(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  try {
    const start = Date.now();
    await db.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function checkRedis(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  try {
    const start = Date.now();
    const result = await redis.ping();
    if (result !== 'PONG') throw new Error(`Unexpected redis response: ${result}`);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

@Public()
@Controller('health')
export class HealthController {
  @Get()
  health() {
    return {
      success: true,
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
      },
    };
  }

  @Get('ready')
  async ready() {
    const [dbCheck, redisCheck] = await Promise.all([checkDatabase(), checkRedis()]);

    const allOk = dbCheck.ok && redisCheck.ok;
    const status = allOk ? 'ready' : 'not_ready';

    if (!allOk) {
      throw new HttpException(
        {
          success: false,
          data: { status, database: dbCheck, redis: redisCheck },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      success: true,
      data: {
        status,
        database: dbCheck,
        redis: redisCheck,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
