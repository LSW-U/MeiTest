/**
 * Cart Controller — 客户端购物车路由
 *
 * 路由前缀 /api/v1/client/cart（deviceType=client_app，role=customer）
 *
 * 端点：
 *   GET    /                         获取购物车
 *   POST   /items                    加购（同 sku 累加）
 *   PATCH  /items/:id                修改数量 / 选中状态
 *   DELETE /items/:id                删除
 *   POST   /checkout-preview         结算前预览（按地址查仓库 + 校验库存 + 价格汇总）
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { z } from 'zod';
import { AddCartItemRequest, UpdateCartItemRequest, CheckoutPreviewRequest } from '@meimart/api-contract';
import { CartService } from './cart.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

interface RequestWithUser {
  user?: RequestUser;
}

@Controller('api/v1/client/cart')
@Roles('customer')
export class CartController {
  constructor(@Inject(CartService) private readonly cartService: CartService) {}

  @Get()
  async getCart(@Req() req: RequestWithUser) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const data = await this.cartService.getCart(user.sub);
    return { success: true as const, data };
  }

  @Post('items')
  @Audit({ resource: 'Cart' })
  async addItem(
    @Body(new ZodValidationPipe(AddCartItemRequest)) body: z.infer<typeof AddCartItemRequest>,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const data = await this.cartService.addItem({
      userId: user.sub,
      skuId: body.skuId,
      quantity: body.quantity,
    });
    return { success: true as const, data };
  }

  @Patch('items/:id')
  @Audit({ resource: 'Cart', resourceIdParam: 'id' })
  async updateItem(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCartItemRequest)) body: z.infer<typeof UpdateCartItemRequest>,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const data = await this.cartService.updateItem({
      userId: user.sub,
      itemId: id,
      quantity: body.quantity,
      isSelected: body.isSelected,
    });
    return { success: true as const, data };
  }

  @Delete('items/:id')
  @Audit({ resource: 'Cart', resourceIdParam: 'id' })
  async removeItem(@Param('id') id: string, @Req() req: RequestWithUser) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const data = await this.cartService.removeItem(user.sub, id);
    return { success: true as const, data };
  }

  @Post('checkout-preview')
  async checkoutPreview(
    @Body(new ZodValidationPipe(CheckoutPreviewRequest)) body: z.infer<typeof CheckoutPreviewRequest>,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const data = await this.cartService.previewCheckout(user.sub, body.addressId);
    return { success: true as const, data };
  }
}
