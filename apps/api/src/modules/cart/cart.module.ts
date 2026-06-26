/**
 * Cart Module — 注册 CartService + Controller
 *
 * 暴露 CART_SERVICE_TOKEN 给 OrderService 用（避免 Order ↔ Cart 循环依赖）
 */
import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

/** CartService DI token（OrderService 用此 token 注入避免循环依赖） */
export const CART_SERVICE_TOKEN = Symbol('CART_SERVICE_TOKEN');

@Module({
  controllers: [CartController],
  providers: [
    CartService,
    { provide: CART_SERVICE_TOKEN, useExisting: CartService },
  ],
  exports: [CartService, CART_SERVICE_TOKEN],
})
export class CartModule {}
