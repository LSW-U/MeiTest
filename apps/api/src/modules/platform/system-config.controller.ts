/**
 * SystemConfig Controller — 平台配置 CRUD
 *
 * 路径：
 *   GET  /api/v1/admin/platform/system-configs             列表
 *   PUT  /api/v1/admin/platform/system-configs/:key        更新（自动写 AuditLog）
 *
 * 权限：仅 super_admin
 */
import { Controller, Get, Put, Param, Body, Request, Inject } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { UpdateSystemConfigRequest } from '@meimart/api-contract';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

@Controller('api/v1/admin/platform/system-configs')
@Roles('super_admin')
export class SystemConfigController {
  constructor(
    @Inject(SystemConfigService) private readonly config: SystemConfigService,
  ) {}

  @Get()
  async list() {
    const items = await this.config.list();
    return { success: true as const, data: items };
  }

  @Put(':key')
  @Audit({ resource: 'SystemConfig', resourceIdParam: 'key' })
  async update(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(UpdateSystemConfigRequest))
    body: { value: string; description?: string },
    @Request() req: { user: RequestUser },
  ) {
    const data = await this.config.update(key, body.value, body.description, req.user.sub);
    return { success: true as const, data };
  }
}
