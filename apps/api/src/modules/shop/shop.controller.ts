/**
 * Shop Controller（W 流程 2026-06-24）
 *
 * 2 个 endpoint：
 *   - GET   /api/v1/common/shop  公开（首页展示，无需登录）
 *   - GET   /api/v1/admin/shop   后台查看（super_admin）
 *   - PATCH /api/v1/admin/shop   后台编辑（super_admin）
 *
 * 单一商家：MVP 仅 1 条 shop 预置，故不传 shopId
 */
import { Controller, Get, Patch, Body, Inject } from '@nestjs/common';
import { UpdateShopRequest } from '@meimart/api-contract';
import { ShopService } from './shop.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Public } from '../../shared/decorators/public.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';

@Controller('api/v1')
export class ShopController {
  constructor(@Inject(ShopService) private readonly shops: ShopService) {}

  /** 客户端首页获取店铺信息（公开） */
  @Public()
  @Get('common/shop')
  async getPublic() {
    const data = await this.shops.getShop();
    return { success: true, data };
  }

  /** 后台查看（super_admin） */
  @Get('admin/shop')
  @Roles('SUPER_ADMIN')
  async getAdmin() {
    const data = await this.shops.getShop();
    return { success: true, data };
  }

  /** 后台编辑（super_admin） */
  @Patch('admin/shop')
  @Roles('SUPER_ADMIN')
  @Audit({ resource: 'Shop' })
  async update(@Body(new ZodValidationPipe(UpdateShopRequest)) body: Partial<{
    name: Record<string, string>;
    announcement: Record<string, string>;
    logoUrl: string | null;
    phone: string;
    address: string;
    status: 'ACTIVE' | 'INACTIVE';
    businessHours: unknown;
  }>) {
    const data = await this.shops.updateShop(body);
    return { success: true, data };
  }
}
