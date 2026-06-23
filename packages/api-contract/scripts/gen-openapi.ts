/**
 * zod schema → OpenAPI 3.0.3 生成器
 *
 * 单一来源：所有 schema 在 src/schemas/*.ts 维护，此脚本拉 registry 生成 openapi.yaml。
 * 三端联调时：前端 mock server 用此 yaml 起 prism，后端 Swagger UI 也用此 yaml。
 *
 * 运行：pnpm --filter @meimart/api-contract gen:openapi
 */
import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// 必须在 schema 使用 .openapi() 之前调用，给 ZodType.prototype 注入 .openapi 方法
extendZodWithOpenApi(z);

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';

import {
  // auth
  JwtPayload,
  LoginRequest,
  LoginPasswordRequest,
  LoginSmsRequest,
  LoginResponseData,
  RegisterRequest,
  RefreshRequest,
  RefreshResponseData,
  LogoutRequest,
  SendSmsRequest,
  SendSmsCodeRequest,
  SendSmsResponseData,
  ResetPasswordRequest,
  PasswordResetRequest,
  // user
  User,
  UpdateProfileRequest,
  ChangePasswordRequest,
  Address,
  CreateAddressRequest,
  UpdateAddressRequest,
  FavoriteToggleRequest,
  FavoriteToggleResponse,
  NotificationItem,
  MarkNotificationReadResponse,
  // shop
  Shop,
  UpdateShopRequest,
  // warehouse
  Warehouse,
  UpsertWarehouseRequest,
  MatchWarehouseRequest,
  // order
  Order,
  OrderItem,
  CreateOrderRequest,
  CancelOrderRequest,
  OrderNo,
  PaymentMethod,
  OrderStatus,
  // common
  ErrorResponse,
} from '../src/index.js';

const registry = new OpenAPIRegistry();

// ===== Schemas 注册 =====
registry.register('JwtPayload', JwtPayload);
registry.register('ErrorResponse', ErrorResponse);

registry.register('LoginRequest', LoginRequest);
registry.register('LoginPasswordRequest', LoginPasswordRequest);
registry.register('LoginSmsRequest', LoginSmsRequest);
registry.register('LoginResponseData', LoginResponseData);
registry.register('RegisterRequest', RegisterRequest);
registry.register('RefreshRequest', RefreshRequest);
registry.register('RefreshResponseData', RefreshResponseData);
registry.register('LogoutRequest', LogoutRequest);
registry.register('SendSmsRequest', SendSmsRequest);
registry.register('SendSmsCodeRequest', SendSmsCodeRequest);
registry.register('SendSmsResponseData', SendSmsResponseData);
registry.register('ResetPasswordRequest', ResetPasswordRequest);
registry.register('PasswordResetRequest', PasswordResetRequest);

registry.register('User', User);
registry.register('UpdateProfileRequest', UpdateProfileRequest);
registry.register('ChangePasswordRequest', ChangePasswordRequest);
registry.register('Address', Address);
registry.register('CreateAddressRequest', CreateAddressRequest);
registry.register('UpdateAddressRequest', UpdateAddressRequest);
registry.register('FavoriteToggleRequest', FavoriteToggleRequest);
registry.register('FavoriteToggleResponse', FavoriteToggleResponse);
registry.register('NotificationItem', NotificationItem);
registry.register('MarkNotificationReadResponse', MarkNotificationReadResponse);

registry.register('Shop', Shop);
registry.register('UpdateShopRequest', UpdateShopRequest);

registry.register('Warehouse', Warehouse);
registry.register('UpsertWarehouseRequest', UpsertWarehouseRequest);
registry.register('MatchWarehouseRequest', MatchWarehouseRequest);

registry.register('Order', Order);
registry.register('OrderItem', OrderItem);
registry.register('CreateOrderRequest', CreateOrderRequest);
registry.register('CancelOrderRequest', CancelOrderRequest);
registry.register('OrderNo', OrderNo);
registry.register('PaymentMethod', PaymentMethod);
registry.register('OrderStatus', OrderStatus);

// ===== Paths 占位（详细 path 在 D4+ 各模块实现时补） =====
registry.registerPath({
  method: 'post',
  path: '/api/v1/common/auth/login-password',
  tags: ['auth'],
  description: '密码登录（W 流程正式 endpoint，2026-06-24 加；deviceType 服务端按 role 推断）',
  request: {
    body: { content: { 'application/json': { schema: LoginPasswordRequest } } },
  },
  responses: {
    200: {
      description: '登录成功',
      content: { 'application/json': { schema: LoginResponseData } },
    },
    401: { description: 'LOGIN_FAILED', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/common/auth/login-sms',
  tags: ['auth'],
  description: 'SMS 验证码登录（不存在自动注册 customer）',
  request: {
    body: { content: { 'application/json': { schema: LoginSmsRequest } } },
  },
  responses: {
    200: {
      description: '登录成功',
      content: { 'application/json': { schema: LoginResponseData } },
    },
    401: { description: 'SMS_CODE_INVALID', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/common/auth/sms-code',
  tags: ['auth'],
  description: '发送 SMS 验证码（stub 固定 123456，标 [SMS_STUB]，W6 切东帝汶本地）',
  request: {
    body: { content: { 'application/json': { schema: SendSmsCodeRequest } } },
  },
  responses: {
    200: {
      description: '已发送（stub）',
      content: { 'application/json': { schema: SendSmsResponseData } },
    },
    429: { description: 'SMS_RATE_LIMIT', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/common/auth/password-reset',
  tags: ['auth'],
  description: 'SMS 找回密码',
  request: {
    body: { content: { 'application/json': { schema: PasswordResetRequest } } },
  },
  responses: {
    200: { description: '重置成功' },
    401: { description: 'SMS_CODE_INVALID', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'PHONE_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/common/auth/register',
  tags: ['auth'],
  description: '注册（必传 smsCode，dev stub 固定 123456；email optional 走密码+SMS 主路径）',
  request: {
    body: { content: { 'application/json': { schema: RegisterRequest } } },
  },
  responses: {
    200: {
      description: '注册成功',
      content: { 'application/json': { schema: LoginResponseData } },
    },
    409: { description: 'PHONE_ALREADY_REGISTERED', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/common/auth/refresh',
  tags: ['auth'],
  request: {
    body: { content: { 'application/json': { schema: RefreshRequest } } },
  },
  responses: {
    200: {
      description: '刷新成功',
      content: { 'application/json': { schema: RefreshResponseData } },
    },
    401: { description: 'REFRESH_TOKEN_INVALID', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/common/auth/logout',
  tags: ['auth'],
  description: 'v0.3 决策 F：必传 refreshToken，服务端加 Redis 黑名单',
  request: {
    body: { content: { 'application/json': { schema: LogoutRequest } } },
  },
  responses: {
    200: { description: '登出成功' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/user/profile',
  tags: ['user'],
  responses: {
    200: {
      description: '获取个人信息',
      content: { 'application/json': { schema: User } },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/client/user/profile',
  tags: ['user'],
  request: {
    body: { content: { 'application/json': { schema: UpdateProfileRequest } } },
  },
  responses: {
    200: {
      description: '更新成功',
      content: { 'application/json': { schema: User } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/addresses',
  tags: ['address'],
  responses: {
    200: {
      description: '收货地址列表',
      content: { 'application/json': { schema: Address.array() } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/client/addresses',
  tags: ['address'],
  request: {
    body: { content: { 'application/json': { schema: CreateAddressRequest } } },
  },
  responses: {
    200: {
      description: '创建成功',
      content: { 'application/json': { schema: Address } },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/client/addresses/{id}',
  tags: ['address'],
  request: {
    body: { content: { 'application/json': { schema: UpdateAddressRequest } } },
  },
  responses: {
    200: {
      description: '更新成功',
      content: { 'application/json': { schema: Address } },
    },
    404: { description: 'ADDRESS_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/client/addresses/{id}',
  tags: ['address'],
  responses: {
    200: { description: '删除成功' },
    404: { description: 'ADDRESS_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/favorites',
  tags: ['favorite'],
  responses: {
    200: {
      description: '收藏列表',
      content: { 'application/json': { schema: FavoriteToggleResponse } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/client/favorites/toggle',
  tags: ['favorite'],
  request: {
    body: { content: { 'application/json': { schema: FavoriteToggleRequest } } },
  },
  responses: {
    200: {
      description: '切换成功',
      content: { 'application/json': { schema: FavoriteToggleResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/notifications',
  tags: ['notification'],
  responses: {
    200: {
      description: '通知列表（最新 100 条）',
      content: { 'application/json': { schema: NotificationItem.array() } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/notifications/unread-count',
  tags: ['notification'],
  responses: {
    200: {
      description: '未读数量',
      content: { 'application/json': { schema: z.object({ count: z.number() }) } },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/client/notifications/{id}/read',
  tags: ['notification'],
  responses: {
    200: {
      description: '标记已读',
      content: { 'application/json': { schema: MarkNotificationReadResponse } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/client/notifications/read-all',
  tags: ['notification'],
  responses: {
    200: {
      description: '全部标记已读',
      content: { 'application/json': { schema: MarkNotificationReadResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/common/shop',
  tags: ['shop'],
  responses: {
    200: {
      description: '获取店铺信息（单一商家）',
      content: { 'application/json': { schema: Shop } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/shop',
  tags: ['shop'],
  responses: {
    200: {
      description: '后台查看店铺信息',
      content: { 'application/json': { schema: Shop } },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/admin/shop',
  tags: ['shop'],
  description: '后台编辑店铺信息（super_admin）',
  request: {
    body: { content: { 'application/json': { schema: UpdateShopRequest } } },
  },
  responses: {
    200: {
      description: '更新成功',
      content: { 'application/json': { schema: Shop } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/common/warehouses',
  tags: ['warehouse'],
  responses: {
    200: {
      description: '仓库列表（多仓库 5-10 个）',
      content: { 'application/json': { schema: Warehouse.array() } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/warehouses',
  tags: ['warehouse'],
  responses: {
    200: {
      description: '后台仓库列表',
      content: { 'application/json': { schema: Warehouse.array() } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/warehouses/{id}',
  tags: ['warehouse'],
  responses: {
    200: {
      description: '仓库详情（含 coverageArea GeoJSON）',
      content: { 'application/json': { schema: Warehouse } },
    },
    404: { description: 'WAREHOUSE_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/warehouses',
  tags: ['warehouse'],
  description: '创建仓库（写 PostGIS center + coverage）',
  request: {
    body: { content: { 'application/json': { schema: UpsertWarehouseRequest } } },
  },
  responses: {
    200: {
      description: '创建成功',
      content: { 'application/json': { schema: Warehouse } },
    },
    409: { description: 'WAREHOUSE_CODE_DUPLICATE', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/admin/warehouses/{id}',
  tags: ['warehouse'],
  description: '更新仓库（普通字段 + 可选 PostGIS）',
  request: {
    body: { content: { 'application/json': { schema: UpsertWarehouseRequest } } },
  },
  responses: {
    200: {
      description: '更新成功',
      content: { 'application/json': { schema: Warehouse } },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/admin/warehouses/{id}/coverage',
  tags: ['warehouse'],
  description: '单独更新配送范围多边形（地图编辑器调）',
  request: {
    body: { content: { 'application/json': { schema: z.object({ coverageArea: UpsertWarehouseRequest.shape.coverageArea.unwrap() }) } } },
  },
  responses: {
    200: { description: '更新成功' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/admin/warehouses/{id}',
  tags: ['warehouse'],
  responses: {
    200: { description: '删除成功' },
    404: { description: 'WAREHOUSE_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/common/warehouses/match',
  tags: ['warehouse'],
  description: '按经纬度匹配最近仓库（PostGIS ST_Within）',
  request: {
    body: { content: { 'application/json': { schema: MatchWarehouseRequest } } },
  },
  responses: {
    200: {
      description: '匹配成功',
      content: { 'application/json': { schema: Warehouse } },
    },
    404: { description: 'OUT_OF_DELIVERY_RANGE', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/client/orders',
  tags: ['order'],
  description: '创建订单（同步事务 MVP，自动匹配仓库 + orderNo 16 位）',
  request: {
    body: { content: { 'application/json': { schema: CreateOrderRequest } } },
  },
  responses: {
    200: {
      description: '订单创建成功',
      content: { 'application/json': { schema: Order } },
    },
    400: { description: 'STOCK_NOT_ENOUGH', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ===== 生成 =====
const generator = new OpenApiGeneratorV3(registry.definitions);
const openapi = generator.generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'MeiMart API',
    version: '0.3',
    description: 'MeiMart 三端统一后端 API（契约 v0.2 基础 + v0.3 决策覆盖）',
  },
  servers: [
    { url: 'http://localhost:3000/api/v1', description: 'dev' },
    { url: 'https://staging-api.meimart.xxx/api/v1', description: 'staging' },
  ],
  tags: [
    { name: 'auth', description: '认证模块' },
    { name: 'user', description: '用户资料' },
    { name: 'address', description: '收货地址' },
    { name: 'favorite', description: '收藏' },
    { name: 'notification', description: '站内通知' },
    { name: 'shop', description: '商家（单一）' },
    { name: 'warehouse', description: '仓库（多）' },
    { name: 'order', description: '订单' },
  ],
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'openapi.yaml');
writeFileSync(outPath, YAML.stringify(openapi, { indent: 2 }), 'utf-8');
console.log(`✅ OpenAPI written: ${outPath}`);
console.log(`   paths: ${Object.keys(openapi.paths || {}).length}`);
console.log(`   schemas: ${Object.keys(openapi.components?.schemas || {}).length}`);
