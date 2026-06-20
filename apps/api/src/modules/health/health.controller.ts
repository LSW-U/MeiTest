/**
 * Health Controller（D4-T1 acceptance：全局过滤器/拦截器/pipe 就绪后 health 端点）
 *
 * D6-T5 会加 /ready 端点（db/redis 依赖就绪检查）
 *
 * @Public() 让 W2+ 全局 JwtAuthGuard 启用后 /health 仍可被 k8s probe 访问
 */
import { Controller, Get } from '@nestjs/common';
import { Public } from '../../shared/decorators/public.decorator';

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
}
