/**
 * Health Controller（D4-T1 acceptance：全局过滤器/拦截器/pipe 就绪后 health 端点）
 *
 * D6-T5 会加 /ready 端点（db/redis 依赖就绪检查）
 */
import { Controller, Get } from '@nestjs/common';

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
}
