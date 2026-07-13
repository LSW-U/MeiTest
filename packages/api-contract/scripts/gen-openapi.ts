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
  // admin users（W7 P1-2 + W7-feature 2026-07-10）
  AdminUserListItem,
  AdminUserListResponseData,
  ListUsersQuery,
  AdminUserDetail,
  UpdateAdminUserRequest,
  SuspendUserRequest,
  ActivateUserRequest,
  DeleteUserRequest,
  ResetPasswordResponseData,
  OrderSummary,
  // shop
  Shop,
  UpdateShopRequest,
  // warehouse
  Warehouse,
  UpsertWarehouseRequest,
  MatchWarehouseRequest,
  // catalog
  Product,
  ProductSummary,
  CreateProductRequest,
  UpdateProductRequest,
  UpdateProductStatusRequest,
  Sku,
  CreateSkuRequest,
  UpdateSkuRequest,
  Category,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  Banner,
  CreateBannerRequest,
  UpdateBannerRequest,
  // order
  Order,
  OrderItem,
  CreateOrderRequest,
  CancelOrderRequest,
  UpdateOrderRequest,
  OrderNo,
  PaymentMethod,
  OrderStatus,
  PaymentStatus,
  // cart
  Cart,
  CartItem,
  AddCartItemRequest,
  UpdateCartItemRequest,
  CheckoutPreviewRequest,
  CheckoutPreview,
  // payment
  PaymentIntent,
  UploadReceiptRequest,
  PaymentMethodItem,
  PaymentMethodListResponseData,
  // platform
  DashboardSummary,
  DashboardTimeRange,
  AuditLogListItem,
  AuditLogDetail,
  AuditLogQuery,
  AuditLogListResponse,
  AuditLogDetailResponse,
  SystemConfigItem,
  SystemConfigListResponse,
  SystemConfigResponse,
  UpdateSystemConfigRequest,
  // dispatch / rider / refund（schema 已有，path 注册放 W3-W5 联调时补）
  // W4-REVIEW P0-1 修复：admin orders + admin rider-applications path 注册
  RiderProfile,
  UpdateDutyStatusRequest,
  DeliveryTask,
  AcceptTaskRequest,
  PickupTaskRequest,
  DeliverTaskRequest,
  ReportIssueRequest,
  // refund（W5 流程 C）
  Refund as RefundSchema,
  CreateRefundRequest as CreateRefundRequestSchema,
  ReviewRefundRequest as ReviewRefundRequestSchema,
  // promotion（W7-ext-G）
  Promotion as PromotionSchema,
  CreatePromotionRequest as CreatePromotionRequestSchema,
  UpdatePromotionRequest as UpdatePromotionRequestSchema,
  // im（流程 M W3 自建 WS 用户签名接口）
  ImSignature,
  ConversationType,
  ImMessage,
  // geo（W7 P0-3 地址 geocoding）
  GeocodeRequest,
  GeocodeResponseData,
  // upload（W7-feature 商品图片上传）
  UploadResponseData,
  // common
  ErrorResponse,
  Id,
  IsoTimestamp,
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
registry.register('AdminUserListItem', AdminUserListItem);
registry.register('AdminUserListResponseData', AdminUserListResponseData);
registry.register('ListUsersQuery', ListUsersQuery);
registry.register('AdminUserDetail', AdminUserDetail);
registry.register('UpdateAdminUserRequest', UpdateAdminUserRequest);
registry.register('SuspendUserRequest', SuspendUserRequest);
registry.register('ActivateUserRequest', ActivateUserRequest);
registry.register('DeleteUserRequest', DeleteUserRequest);
registry.register('ResetPasswordResponseData', ResetPasswordResponseData);
registry.register('OrderSummary', OrderSummary);

registry.register('Shop', Shop);
registry.register('UpdateShopRequest', UpdateShopRequest);

registry.register('Warehouse', Warehouse);
registry.register('UpsertWarehouseRequest', UpsertWarehouseRequest);
registry.register('MatchWarehouseRequest', MatchWarehouseRequest);

registry.register('Product', Product);
registry.register('ProductSummary', ProductSummary);
registry.register('CreateProductRequest', CreateProductRequest);
registry.register('UpdateProductRequest', UpdateProductRequest);
registry.register('UpdateProductStatusRequest', UpdateProductStatusRequest);
registry.register('Sku', Sku);
registry.register('CreateSkuRequest', CreateSkuRequest);
registry.register('UpdateSkuRequest', UpdateSkuRequest);
registry.register('Category', Category);
registry.register('CreateCategoryRequest', CreateCategoryRequest);
registry.register('UpdateCategoryRequest', UpdateCategoryRequest);
registry.register('Banner', Banner);
registry.register('CreateBannerRequest', CreateBannerRequest);
registry.register('UpdateBannerRequest', UpdateBannerRequest);

registry.register('Order', Order);
registry.register('OrderItem', OrderItem);
registry.register('CreateOrderRequest', CreateOrderRequest);
registry.register('CancelOrderRequest', CancelOrderRequest);
registry.register('UpdateOrderRequest', UpdateOrderRequest);
registry.register('OrderNo', OrderNo);
registry.register('PaymentMethod', PaymentMethod);
registry.register('OrderStatus', OrderStatus);

registry.register('Cart', Cart);
registry.register('CartItem', CartItem);
registry.register('AddCartItemRequest', AddCartItemRequest);
registry.register('UpdateCartItemRequest', UpdateCartItemRequest);
registry.register('CheckoutPreviewRequest', CheckoutPreviewRequest);
registry.register('CheckoutPreview', CheckoutPreview);

registry.register('PaymentIntent', PaymentIntent);
registry.register('UploadReceiptRequest', UploadReceiptRequest);
registry.register('PaymentMethodItem', PaymentMethodItem);
registry.register('PaymentMethodListResponseData', PaymentMethodListResponseData);

registry.register('DashboardSummary', DashboardSummary);
registry.register('DashboardTimeRange', DashboardTimeRange);
registry.register('AuditLogListItem', AuditLogListItem);
registry.register('AuditLogDetail', AuditLogDetail);
registry.register('AuditLogQuery', AuditLogQuery);
registry.register('SystemConfigItem', SystemConfigItem);
registry.register('UpdateSystemConfigRequest', UpdateSystemConfigRequest);
// Response 包装 schema 不注册到 components（gen-openapi 直接 inline 即可）

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
  method: 'get',
  path: '/api/v1/client/products',
  tags: ['product'],
  description: '商品列表（客户端公开浏览，默认只看 ACTIVE）',
  responses: {
    200: {
      description: '商品列表',
      content: { 'application/json': { schema: z.object({ items: ProductSummary.array(), total: z.number(), page: z.number(), pageSize: z.number(), hasMore: z.boolean() }) } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/products/{id}',
  tags: ['product'],
  responses: {
    200: {
      description: '商品详情（含 SKU）',
      content: { 'application/json': { schema: Product } },
    },
    404: { description: 'PRODUCT_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/products/recommendations',
  tags: ['product'],
  description: '推荐商品（按销量 top N）',
  responses: {
    200: { description: '推荐列表', content: { 'application/json': { schema: ProductSummary.array() } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/products/search',
  tags: ['product'],
  description: '搜索商品（按多语言 name 匹配）',
  responses: {
    200: { description: '搜索结果', content: { 'application/json': { schema: ProductSummary.array() } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/categories',
  tags: ['category'],
  responses: {
    200: { description: '分类列表', content: { 'application/json': { schema: Category.array() } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/banners',
  tags: ['banner'],
  responses: {
    200: { description: 'Banner 列表（仅 ACTIVE）', content: { 'application/json': { schema: Banner.array() } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/products',
  tags: ['product'],
  description: '创建商品',
  request: { body: { content: { 'application/json': { schema: CreateProductRequest } } } },
  responses: {
    200: { description: '创建成功', content: { 'application/json': { schema: Product } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/admin/products/{id}',
  tags: ['product'],
  request: { body: { content: { 'application/json': { schema: UpdateProductRequest } } } },
  responses: {
    200: { description: '更新成功', content: { 'application/json': { schema: Product } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/admin/products/{id}/status',
  tags: ['product'],
  description: '商品上下架',
  request: { body: { content: { 'application/json': { schema: UpdateProductStatusRequest } } } },
  responses: {
    200: { description: '更新成功', content: { 'application/json': { schema: Product } } },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/admin/products/{id}',
  tags: ['product'],
  responses: { 200: { description: '删除成功' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/products/{id}/skus',
  tags: ['sku'],
  description: '创建 SKU（自动重算 product.priceMin）',
  request: { body: { content: { 'application/json': { schema: CreateSkuRequest } } } },
  responses: {
    200: { description: '创建成功', content: { 'application/json': { schema: Sku } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/categories',
  tags: ['category'],
  request: { body: { content: { 'application/json': { schema: CreateCategoryRequest } } } },
  responses: {
    200: { description: '创建成功', content: { 'application/json': { schema: Category } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/banners',
  tags: ['banner'],
  request: { body: { content: { 'application/json': { schema: CreateBannerRequest } } } },
  responses: {
    200: { description: '创建成功', content: { 'application/json': { schema: Banner } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/client/inventory/match-warehouse',
  tags: ['inventory'],
  description: '按收货地址匹配最近仓库（PostGIS ST_Within + ST_Distance）',
  request: {
    body: { content: { 'application/json': { schema: MatchWarehouseRequest } } },
  },
  responses: {
    200: {
      description: '匹配成功（null 表示超出配送范围）',
      content: { 'application/json': { schema: z.object({ warehouseId: Id, code: z.string(), name: z.record(z.string(), z.string()), deliveryFee: z.number(), distance: z.number() }).nullable() } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/inventory/{skuId}',
  tags: ['inventory'],
  description: '切地址时刷新 SKU 在收货地址所属仓库的库存（关键 UX）',
  responses: {
    200: {
      description: '库存查询结果',
      content: {
        'application/json': {
          schema: z.object({
            warehouse: z.object({ warehouseId: Id, code: z.string(), deliveryFee: z.number() }).nullable(),
            quantity: z.number(),
            inStock: z.boolean(),
            outOfRange: z.boolean(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/inventory/stocks',
  tags: ['inventory'],
  description: '后台库存列表（可按 warehouseId / lowStockOnly 过滤）',
  responses: {
    200: { description: '库存列表', content: { 'application/json': { schema: z.array(z.object({ id: Id, warehouseId: Id, skuId: Id, quantity: z.number(), safetyStock: z.number() })) } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/admin/inventory/stocks',
  tags: ['inventory'],
  description: '后台调整库存（deltaQty 正负皆可，写入 StockLog）',
  request: {
    body: { content: { 'application/json': { schema: z.object({ skuId: Id, deltaQty: z.number().int(), reason: z.string().optional() }) } } },
  },
  responses: {
    200: { description: '调整成功' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/inventory/logs',
  tags: ['inventory'],
  description: '库存变更日志（按 createdAt desc）',
  responses: {
    200: { description: '日志列表' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/pricing/delivery-fee',
  tags: ['pricing'],
  description: '计算配送费（基础费 + 距离加价）',
  responses: {
    200: {
      description: '配送费结果',
      content: {
        'application/json': {
          schema: z.object({
            warehouseId: Id,
            baseFee: z.number(),
            perKmFee: z.number(),
            distance: z.number(),
            deliveryFee: z.number(),
            currency: z.literal('USD'),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/pricing/min-order-check',
  tags: ['pricing'],
  description: '起送价校验',
  responses: {
    200: {
      description: '校验结果',
      content: {
        'application/json': {
          schema: z.object({
            ok: z.boolean(),
            minOrderAmount: z.number(),
            cartTotal: z.number(),
            shortfall: z.number(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/pricing/config',
  tags: ['pricing'],
  description: '所有仓库的配送费配置',
  responses: {
    200: { description: '配置列表' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/admin/pricing/warehouses/{warehouseId}/base-fee',
  tags: ['pricing'],
  description: '更新某仓库的基础配送费',
  request: {
    body: { content: { 'application/json': { schema: z.object({ baseFee: z.number().int().nonnegative() }) } } },
  },
  responses: {
    200: { description: '更新成功' },
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

// ===== platform paths（流程 M） =====
registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/platform/dashboard/summary',
  tags: ['platform'],
  description: '平台 dashboard 汇总（GMV / 订单数 / 在线骑手 / 异常订单 / 仓库钻取）',
  request: {
    query: z.object({ range: DashboardTimeRange.default('today') }),
  },
  responses: {
    200: {
      description: '汇总数据',
      content: { 'application/json': { schema: DashboardSummary } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/platform/audit-logs',
  tags: ['platform'],
  description: '审计日志列表（按 user/resource/action/perspective/时间筛选，游标分页）',
  request: { query: AuditLogQuery },
  responses: {
    200: {
      description: '审计日志列表',
      content: { 'application/json': { schema: AuditLogListResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/platform/audit-logs/{id}',
  tags: ['platform'],
  description: '审计日志详情（含 before/after 快照）',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: '审计日志详情',
      content: { 'application/json': { schema: AuditLogDetailResponse } },
    },
    404: { description: 'AUDIT_LOG_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/platform/audit-logs/export',
  tags: ['platform'],
  description: '审计日志导出 CSV（同 query 参数，最多 10000 行）',
  request: { query: AuditLogQuery },
  responses: {
    200: { description: 'CSV 流（text/csv）' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/platform/system-configs',
  tags: ['platform'],
  description: '系统配置列表（抽成比例 / 配送费基础规则等 key-value）',
  responses: {
    200: {
      description: '配置列表',
      content: { 'application/json': { schema: SystemConfigListResponse } },
    },
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/admin/platform/system-configs/{key}',
  tags: ['platform'],
  description: '更新系统配置（变更审计自动写 AuditLog，Redis 缓存失效）',
  request: {
    params: z.object({ key: z.string() }),
    body: { content: { 'application/json': { schema: UpdateSystemConfigRequest } } },
  },
  responses: {
    200: {
      description: '更新成功',
      content: { 'application/json': { schema: SystemConfigResponse } },
    },
    404: { description: 'CONFIG_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ===== client paths（流程 C / W） =====
registry.registerPath({
  method: 'get',
  path: '/api/v1/client/orders',
  tags: ['order'],
  description: '客户端订单列表（按状态筛选 + 游标分页）',
  responses: {
    200: {
      description: '订单列表',
      content: { 'application/json': { schema: Order.array() } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/orders/{id}',
  tags: ['order'],
  description: '订单详情（含 items + events）',
  responses: {
    200: {
      description: '订单详情',
      content: { 'application/json': { schema: Order } },
    },
    404: { description: 'ORDER_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/client/orders/{id}/cancel',
  tags: ['order'],
  description: '取消订单（用户自助，PENDING_* / CONFIRMED 可取消）',
  request: {
    body: { content: { 'application/json': { schema: CancelOrderRequest } } },
  },
  responses: {
    200: { description: '取消成功' },
    409: { description: 'ORDER_STATUS_NOT_CANCELLABLE', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/cart',
  tags: ['cart'],
  description: '获取购物车（按用户 1 份，含 items + 选中金额汇总）',
  responses: {
    200: {
      description: '购物车详情',
      content: { 'application/json': { schema: Cart } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/client/cart/items',
  tags: ['cart'],
  description: '加购（同 sku 累加数量 + 刷新价格快照）',
  request: {
    body: { content: { 'application/json': { schema: AddCartItemRequest } } },
  },
  responses: {
    200: {
      description: '加购后的购物车',
      content: { 'application/json': { schema: Cart } },
    },
    409: { description: 'SKU_INACTIVE', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/client/cart/items/{id}',
  tags: ['cart'],
  description: '修改购物车项数量 / 选中状态',
  request: {
    body: { content: { 'application/json': { schema: UpdateCartItemRequest } } },
  },
  responses: {
    200: {
      description: '修改后的购物车',
      content: { 'application/json': { schema: Cart } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/client/cart/items/{id}',
  tags: ['cart'],
  description: '删除购物车项',
  responses: {
    200: {
      description: '删除后的购物车',
      content: { 'application/json': { schema: Cart } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/client/cart/checkout-preview',
  tags: ['cart'],
  description: '结算前预览（按地址匹配仓库 + 库存/价格校验 + 金额汇总）',
  request: {
    body: { content: { 'application/json': { schema: CheckoutPreviewRequest } } },
  },
  responses: {
    200: {
      description: '结算预览',
      content: { 'application/json': { schema: CheckoutPreview } },
    },
    409: { description: 'NO_SELECTED_ITEMS / OUT_OF_DELIVERY_RANGE', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/payments/methods',
  tags: ['payment'],
  description: '列出可用支付方式（W7 P1-1）。返回 5 种方式的多语言 name/subtitle + icon + isDefault + enabled + mockFlag。',
  responses: {
    200: {
      description: '支付方式列表',
      content: { 'application/json': { schema: PaymentMethodListResponseData } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/payments/{orderId}',
  tags: ['payment'],
  description: '查询订单支付状态（含 mock/stub 标识）',
  responses: {
    200: {
      description: 'PaymentIntent 详情',
      content: { 'application/json': { schema: PaymentIntent } },
    },
    404: { description: 'PAYMENT_INTENT_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/client/payments/{orderId}/mock-callback',
  tags: ['payment'],
  description: 'dev/staging 模拟第三方支付成功回调（仅 WECHAT/PAYPAL/STRIPE）',
  responses: {
    200: { description: '回调成功，订单自动进 CONFIRMED' },
    409: { description: 'METHOD_NOT_ALLOWED / DISABLED_IN_PROD', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/client/payments/{orderId}/receipt',
  tags: ['payment'],
  description: '银行转账凭证上传（BANK_TRANSFER 专用）',
  request: {
    body: { content: { 'application/json': { schema: UploadReceiptRequest } } },
  },
  responses: {
    200: {
      description: '凭证已上传，状态进 PROCESSING 等审核',
      content: { 'application/json': { schema: PaymentIntent } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/client/payments/{orderId}/confirm',
  tags: ['payment'],
  description: '客户端轮询查到 PAID 后触发订单确认',
  responses: {
    200: { description: '订单已确认' },
    409: { description: 'PAYMENT_NOT_PAID', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ============================================================================
// IM（流程 M W3 — 自建 WebSocket 用户签名接口）
// ============================================================================

registry.register('ImSignature', ImSignature);
registry.register('ImMessage', ImMessage);
registry.register('ConversationType', ConversationType);

registry.registerPath({
  method: 'get',
  path: '/api/v1/im/signature',
  tags: ['im'],
  description:
    '获取 IM 自建 WS 连接信息（URL / namespace / 事件名 / 会话 ID 模板）。三端 SDK 启动时调用一次。鉴权方式 = bearer（复用 access token）',
  responses: {
    200: {
      description: 'IM 连接信息',
      content: { 'application/json': { schema: ImSignature } },
    },
    401: { description: 'UNAUTHORIZED', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ============================================================================
// W4-REVIEW P0-1 修复：admin orders + admin rider-applications path 注册
// 后端已实现，OpenAPI 之前漏注册导致跨 repo 契约 drift
// ============================================================================

// ---- Admin Users（W7 P1-2 列表 + W7-feature 2026-07-10 详情/动作）----
registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/users',
  tags: ['user'],
  description:
    '后台用户列表（W7 P1-2）。支持 keyword/role/status 筛选 + 分页，含 orderCount + totalSpent 聚合。',
  request: {
    query: ListUsersQuery,
  },
  responses: {
    200: {
      description: '用户列表',
      content: { 'application/json': { schema: AdminUserListResponseData } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/users/{id}',
  tags: ['user'],
  description:
    '后台用户详情（W7-feature 2026-07-10）。返回 AdminUserDetail，含最近 5 笔已成交订单 + 全部收货地址。',
  request: {
    params: z.object({ id: Id }),
  },
  responses: {
    200: {
      description: '用户详情',
      content: { 'application/json': { schema: AdminUserDetail } },
    },
    404: { description: 'E-ADMIN-USER-001 用户不存在', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/admin/users/{id}',
  tags: ['user'],
  description:
    '编辑客户资料（W7-feature 2026-07-10）。支持 name/phone/email/avatarUrl/role/phoneVerified/emailVerified 字段。' +
    '安全：不能降级自己 role（E-ADMIN-USER-005）；phone/email unique 冲突抛 E-ADMIN-USER-002。',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: UpdateAdminUserRequest } } },
  },
  responses: {
    200: {
      description: '更新后的用户详情',
      content: { 'application/json': { schema: AdminUserDetail } },
    },
    404: { description: 'E-ADMIN-USER-001', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'E-ADMIN-USER-002 / E-ADMIN-USER-003', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'E-ADMIN-USER-005', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/users/{id}/suspend',
  tags: ['user'],
  description:
    '暂停用户（W7-feature 2026-07-10）。status -> SUSPENDED。' +
    '安全：不能暂停自己（E-ADMIN-USER-005）；不能暂停其他 super_admin（E-ADMIN-USER-004）。' +
    '副作用：用户当前 JWT 仍有效至过期，下次 refresh 时被拒（kill session 需 Redis 黑名单，W8 收尾）。',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: SuspendUserRequest } } },
  },
  responses: {
    200: {
      description: '暂停后的用户详情',
      content: { 'application/json': { schema: AdminUserDetail } },
    },
    404: { description: 'E-ADMIN-USER-001', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'E-ADMIN-USER-004 / E-ADMIN-USER-005', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'E-ADMIN-USER-003', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/users/{id}/activate',
  tags: ['user'],
  description:
    '激活用户（W7-feature 2026-07-10）。status -> ACTIVE，仅允许从 SUSPENDED 转。DELETED 是终态，不可激活。',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: ActivateUserRequest } } },
  },
  responses: {
    200: {
      description: '激活后的用户详情',
      content: { 'application/json': { schema: AdminUserDetail } },
    },
    404: { description: 'E-ADMIN-USER-001', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'E-ADMIN-USER-003', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/users/{id}/delete',
  tags: ['user'],
  description:
    '软删除用户（W7-ext-B 2026-07-10）。status -> DELETED（终态）。' +
    '约束：不能删除自己（E-ADMIN-USER-005）；不能删除其他 super_admin（E-ADMIN-USER-004）；' +
    'DELETED 是终态，不可恢复（再删抛 E-ADMIN-USER-003）。',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: DeleteUserRequest } } },
  },
  responses: {
    200: {
      description: '删除后的用户详情（status=DELETED）',
      content: { 'application/json': { schema: AdminUserDetail } },
    },
    403: { description: 'E-ADMIN-USER-004/005', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'E-ADMIN-USER-001', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'E-ADMIN-USER-003 已删除', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/users/{id}/reset-password',
  tags: ['user'],
  description:
    '重置密码（W7-feature 2026-07-10）。生成 12 字符 base64url 临时密码，bcrypt 哈希存库，明文一次性返回。' +
    '安全：明文不落库；audit maskFields 不记 temporaryPassword；不强制首登改密（MVP）。',
  request: {
    params: z.object({ id: Id }),
  },
  responses: {
    200: {
      description: '临时密码（明文，仅本次返回）',
      content: { 'application/json': { schema: ResetPasswordResponseData } },
    },
    404: { description: 'E-ADMIN-USER-001', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'E-ADMIN-USER-003 status=DELETED', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ---- Admin Orders（3 endpoints）----
registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/orders',
  tags: ['order'],
  description:
    'Admin 订单列表（W4 新增）。按 status/userId/warehouseId/orderNo 筛选 + 游标分页。' +
    'Role: super_admin / warehouse_staff / customer_service。',
  request: {
    query: z.object({
      status: OrderStatus.optional(),
      userId: Id.optional(),
      warehouseId: Id.optional(),
      orderNo: z.string().optional(),
      cursor: Id.optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      description: '订单列表（含 items + events）',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              items: z.array(Order),
              nextCursor: Id.nullable(),
              hasMore: z.boolean(),
            }),
          }),
        },
      },
    },
    401: { description: 'UNAUTHORIZED', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'FORBIDDEN', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/orders/{id}',
  tags: ['order'],
  description: 'Admin 订单详情（含 items + events，不校验 userId 归属）。',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: {
      description: '订单详情',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: Order,
          }),
        },
      },
    },
    404: { description: 'ORDER_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/orders/{id}/cancel',
  tags: ['order'],
  description:
    'Admin 取消订单（任何状态可取消，写 OrderEvent）。' +
    'W4-REVIEW P0-2：若 paymentStatus=PAID 抛 E-ORDER-006 防资金损失（推 W5 refund）。',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: CancelOrderRequest } } },
  },
  responses: {
    200: {
      description: '取消成功',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ id: Id, status: OrderStatus }),
          }),
        },
      },
    },
    404: { description: 'ORDER_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'PAID_ORDER_CANNOT_CANCEL', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ---- Admin Order edit（W7-ext-C）----
registry.registerPath({
  method: 'patch',
  path: '/api/v1/admin/orders/{id}',
  tags: ['order'],
  description:
    'Admin 编辑订单（W7-ext-C）。MVP 仅允许改 remark（备注）。' +
    'warehouseId 改动会破坏 orderNo，deliveryAddress 是快照，均不可改。' +
    '已 CANCELLED / COMPLETED 的订单不可编辑（409）。',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: UpdateOrderRequest } } },
  },
  responses: {
    200: {
      description: '编辑成功',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: Order,
          }),
        },
      },
    },
    404: { description: 'ORDER_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'ORDER_NOT_EDITABLE', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ---- Admin Rider Applications（2 endpoints）----
registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/rider-applications',
  tags: ['rider'],
  description: '骑手入驻申请列表（按 applicationStatus 过滤）。Role: super_admin。',
  request: {
    query: z.object({
      status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      description: '申请列表',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ items: z.array(RiderProfile) }),
          }),
        },
      },
    },
    401: { description: 'UNAUTHORIZED', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'FORBIDDEN', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/rider-applications/{id}/review',
  tags: ['rider'],
  description: '审核骑手申请（APPROVED/REJECTED）。Role: super_admin。',
  request: {
    params: z.object({ id: Id }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            decision: z.enum(['APPROVED', 'REJECTED']),
            rejectReason: z.string().max(500).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: '审核成功',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: RiderProfile,
          }),
        },
      },
    },
    404: { description: 'APPLICATION_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'APPLICATION_ALREADY_PROCESSED', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ============================================================================
// W7-ext-D：Admin 骑手 CRUD（6 endpoints）
// ============================================================================

const UpdateAdminRiderRequest = z.object({
  vehicleType: z.enum(['MOTORCYCLE', 'BICYCLE', 'CAR']).optional(),
  vehiclePlate: z.string().max(20).nullable().optional(),
  preferredWarehouseIds: z.array(Id).optional(),
});

const DeleteAdminRiderRequest = z.object({
  reason: z.string().min(1).max(200).optional(),
});

registry.register('UpdateAdminRiderRequest', UpdateAdminRiderRequest);
registry.register('DeleteAdminRiderRequest', DeleteAdminRiderRequest);

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/riders',
  tags: ['rider'],
  description: 'Admin 已审核骑手列表（W7-ext-D）。Role: super_admin。返回 applicationStatus=APPROVED 的骑手。',
  request: {
    query: z.object({
      status: z.enum(['OFFLINE', 'ONLINE', 'BUSY']).optional(),
      userStatus: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
      keyword: z.string().max(50).optional(),
      warehouseId: Id.optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      description: '骑手列表',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.array(RiderProfile),
          }),
        },
      },
    },
    401: { description: 'UNAUTHORIZED', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'FORBIDDEN', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/riders/{id}',
  tags: ['rider'],
  description: 'Admin 骑手详情（W7-ext-D）。含 User 状态 + 最近 10 订单 + 评分统计。',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: {
      description: '详情',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: RiderProfile }),
        },
      },
    },
    404: { description: 'RIDER_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/admin/riders/{id}',
  tags: ['rider'],
  description: 'Admin 编辑骑手（W7-ext-D）。仅允许改 vehicleType/vehiclePlate/preferredWarehouseIds。',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: UpdateAdminRiderRequest } } },
  },
  responses: {
    200: {
      description: '编辑成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: RiderProfile }),
        },
      },
    },
    404: { description: 'RIDER_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/riders/{id}/suspend',
  tags: ['rider'],
  description: 'Admin 停用骑手（W7-ext-D）。User.status=SUSPENDED + RiderProfile.status=OFFLINE + 清 Redis 在线状态。',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: {
      description: '停用成功',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              id: Id,
              userStatus: z.string(),
              riderStatus: z.string(),
            }),
          }),
        },
      },
    },
    404: { description: 'RIDER_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'RIDER_ALREADY_SUSPENDED', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/riders/{id}/activate',
  tags: ['rider'],
  description: 'Admin 恢复骑手（W7-ext-D）。User.status=ACTIVE。骑手自行 PATCH /duty 上班。',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: {
      description: '恢复成功',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ id: Id, userStatus: z.string() }),
          }),
        },
      },
    },
    404: { description: 'RIDER_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'ALREADY_ACTIVE / CANNOT_ACTIVATE_DELETED', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/riders/{id}/delete',
  tags: ['rider'],
  description: 'Admin 软删骑手（W7-ext-D）。User.status=DELETED + RiderProfile.status=OFFLINE。不能删自己。',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: DeleteAdminRiderRequest } } },
  },
  responses: {
    200: {
      description: '删除成功',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ id: Id, userStatus: z.string() }),
          }),
        },
      },
    },
    404: { description: 'RIDER_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'CANNOT_DELETE_SELF / ALREADY_DELETED', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ============================================================================
// W7-ext-G：促销管理（7 endpoints）
// ============================================================================

registry.register('Promotion', PromotionSchema);
registry.register('CreatePromotionRequest', CreatePromotionRequestSchema);
registry.register('UpdatePromotionRequest', UpdatePromotionRequestSchema);

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/promotions',
  tags: ['promotion'],
  description: 'Admin 促销列表（W7-ext-G）。Role: super_admin。按 status/type/keyword 筛选。',
  request: {
    query: z.object({
      status: z.enum(['ACTIVE', 'PAUSED', 'DELETED']).optional(),
      type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_DELIVERY']).optional(),
      keyword: z.string().max(50).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      description: '列表',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: z.array(PromotionSchema) }),
        },
      },
    },
    401: { description: 'UNAUTHORIZED', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'FORBIDDEN', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/promotions/{id}',
  tags: ['promotion'],
  description: 'Admin 促销详情（W7-ext-G）。',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: {
      description: '详情',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: PromotionSchema }),
        },
      },
    },
    404: { description: 'PROMO_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/promotions',
  tags: ['promotion'],
  description: '创建促销（W7-ext-G）。code 唯一（3-20 字母数字），type 决定 value 含义。',
  request: {
    body: { content: { 'application/json': { schema: CreatePromotionRequestSchema } } },
  },
  responses: {
    200: {
      description: '创建成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: PromotionSchema }),
        },
      },
    },
    400: { description: 'INVALID_INPUT', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'CODE_ALREADY_EXISTS', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/admin/promotions/{id}',
  tags: ['promotion'],
  description: '编辑促销（W7-ext-G）。status 用专门端点切换。DELETED 不可编辑。',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: UpdatePromotionRequestSchema } } },
  },
  responses: {
    200: {
      description: '编辑成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: PromotionSchema }),
        },
      },
    },
    404: { description: 'PROMO_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'CANNOT_EDIT_DELETED', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/promotions/{id}/activate',
  tags: ['promotion'],
  description: '激活促销（W7-ext-G）。PAUSED -> ACTIVE。',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: {
      description: '激活成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: PromotionSchema }),
        },
      },
    },
    404: { description: 'PROMO_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'ALREADY_ACTIVE / CANNOT_ACTIVATE_DELETED', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/promotions/{id}/pause',
  tags: ['promotion'],
  description: '暂停促销（W7-ext-G）。ACTIVE -> PAUSED。',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: {
      description: '暂停成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: PromotionSchema }),
        },
      },
    },
    404: { description: 'PROMO_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'ONLY_ACTIVE_CAN_PAUSE', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/promotions/{id}/delete',
  tags: ['promotion'],
  description: '软删促销（W7-ext-G）。status=DELETED，保留数据。',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: {
      description: '删除成功',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ id: Id, status: z.string() }),
          }),
        },
      },
    },
    404: { description: 'PROMO_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'ALREADY_DELETED', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ============================================================================
// W5 联调准备：骑手 App 端点 path 注册（9 endpoints）
// 后端 controller 已实现，此处补 OpenAPI 注册让前端 sync-api.sh 能拉到类型
// ============================================================================

// ---- 骑手入驻申请 ----
registry.registerPath({
  method: 'post',
  path: '/api/v1/common/rider/apply',
  tags: ['rider'],
  description: '骑手入驻申请（创建 RiderProfile applicationStatus=PENDING）',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            riderName: z.string(),
            phone: z.string(),
            vehicleType: z.enum(['MOTORCYCLE', 'BICYCLE', 'CAR']),
            vehiclePlate: z.string().optional(),
            idCardNumber: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: '申请成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: RiderProfile }),
        },
      },
    },
    409: { description: 'ALREADY_EXISTS', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ---- 骑手资料 ----
registry.registerPath({
  method: 'get',
  path: '/api/v1/rider/profile',
  tags: ['rider'],
  description: '获取当前骑手资料（含 applicationStatus + 在线状态）',
  responses: {
    200: {
      description: '骑手资料',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: RiderProfile }) } },
    },
    404: { description: 'PROFILE_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ---- 上/下班 ----
registry.registerPath({
  method: 'patch',
  path: '/api/v1/rider/duty',
  tags: ['rider'],
  description: '切换上下班状态（ONLINE → Redis SETEX 60s；OFFLINE → Redis DEL）',
  request: {
    body: { content: { 'application/json': { schema: UpdateDutyStatusRequest } } },
  },
  responses: {
    200: {
      description: '切换成功',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: RiderProfile }) } },
    },
    403: { description: 'NOT_APPROVED', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ---- 心跳 ----
registry.registerPath({
  method: 'post',
  path: '/api/v1/rider/heartbeat',
  tags: ['rider'],
  description: '心跳续期（Redis rider:online:{riderId} SETEX 60s，骑手 App 每 50s 调一次）',
  responses: {
    200: {
      description: '续期成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: z.object({ renewed: z.boolean() }) }),
        },
      },
    },
  },
});

// ---- 抢单大厅 ----
registry.registerPath({
  method: 'get',
  path: '/api/v1/rider/dispatch/tasks',
  tags: ['dispatch'],
  description: '获取待抢配送任务列表（status=PENDING_ASSIGN）',
  responses: {
    200: {
      description: '任务列表',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ items: z.array(DeliveryTask) }),
          }),
        },
      },
    },
  },
});

// ---- 接单 ----
registry.registerPath({
  method: 'post',
  path: '/api/v1/rider/dispatch/tasks/{id}/accept',
  tags: ['dispatch'],
  description: '骑手接单（乐观锁：UPDATE WHERE status=PENDING_ASSIGN）',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: AcceptTaskRequest } } },
  },
  responses: {
    200: {
      description: '接单成功',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: DeliveryTask }) } },
    },
    409: { description: 'TASK_ALREADY_ASSIGNED', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ---- 取货 ----
registry.registerPath({
  method: 'post',
  path: '/api/v1/rider/dispatch/tasks/{id}/pickup',
  tags: ['dispatch'],
  description: '骑手确认取货（PICKED_UP 状态）',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: PickupTaskRequest } } },
  },
  responses: {
    200: {
      description: '取货成功',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: DeliveryTask }) } },
    },
    409: { description: 'TASK_STATUS_INVALID', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ---- 送达 ----
registry.registerPath({
  method: 'post',
  path: '/api/v1/rider/dispatch/tasks/{id}/deliver',
  tags: ['dispatch'],
  description: '骑手确认送达（DELIVERED + COD 收款确认 + 创建 CashCollection）',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: DeliverTaskRequest } } },
  },
  responses: {
    200: {
      description: '送达成功',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: DeliveryTask }) } },
    },
    409: { description: 'TASK_STATUS_INVALID', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ---- 报异常 ----
registry.registerPath({
  method: 'post',
  path: '/api/v1/rider/dispatch/tasks/{id}/report-issue',
  tags: ['dispatch'],
  description: '骑手报告配送异常（WS 推 customer-service room + OrderEvent ISSUE_REPORTED）',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: ReportIssueRequest } } },
  },
  responses: {
    200: {
      description: '异常上报成功',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: DeliveryTask }) } },
    },
  },
});

// ============================================================================
// W5-prepare：mock-login + tracking 注册到 OpenAPI（联调前端需要类型）
// ============================================================================

// ---- mock-login（dev/staging 专用，prod AuthModule 不注册此 controller）----
registry.registerPath({
  method: 'post',
  path: '/api/v1/common/auth/mock-login',
  tags: ['auth'],
  description:
    'Mock 登录（仅 dev/staging，prod 不注册）。跳过密码校验，接受任意 role + deviceType 组合。' +
    '默认 userId = seed super_admin。',
  'x-internal': true,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            role: z.enum(['super_admin', 'customer', 'rider', 'warehouse_staff', 'customer_service']),
            deviceType: z.enum(['client_app', 'rider_app', 'admin_web']),
            userId: z.string().uuid().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: '登录成功',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              userId: z.string().uuid(),
              role: z.string(),
              accessToken: z.string(),
              refreshToken: z.string(),
              accessExpiresAt: z.number(),
              refreshExpiresAt: z.number(),
            }),
          }),
        },
      },
    },
    404: { description: 'MOCK_USER_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ---- tracking（HTTP 轮询兜底，WS 断线时前端降级）----
registry.registerPath({
  method: 'get',
  path: '/api/v1/client/orders/{id}/tracking',
  tags: ['order'],
  description: '配送追踪 HTTP 轮询兜底（WS 断线时前端 30s 降级轮询）。返回订单状态 + 配送任务状态。',
  request: {
    params: z.object({ id: Id }),
  },
  responses: {
    200: {
      description: '配送追踪信息',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              orderId: Id,
              orderNo: OrderNo,
              orderStatus: OrderStatus,
              paymentStatus: PaymentStatus,
              task: z
                .object({
                  taskId: Id,
                  taskStatus: z.string(),
                  riderId: z.string().nullable(),
                  pickedUpAt: IsoTimestamp.nullable(),
                  deliveredAt: IsoTimestamp.nullable(),
                  riderLocation: z.unknown().nullable(),
                  estimatedArrival: z.unknown().nullable(),
                })
                .nullable(),
            }),
          }),
        },
      },
    },
    404: { description: 'ORDER_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ============================================================================
// W5：Refund 端点注册（7 endpoints）
// ============================================================================

// ---- 客户端 ----
registry.registerPath({
  method: 'post',
  path: '/api/v1/client/refunds',
  tags: ['refund'],
  description: '客户申请退款（接单前自动通过，接单后待商家审核）',
  request: { body: { content: { 'application/json': { schema: CreateRefundRequestSchema } } } },
  responses: {
    200: { description: '退款创建成功', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: RefundSchema }) } } },
    409: { description: 'REFUND_IN_PROGRESS', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/refunds',
  tags: ['refund'],
  description: '我的退款列表',
  responses: { 200: { description: '退款列表', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.array(RefundSchema) }) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/refunds/{id}',
  tags: ['refund'],
  description: '退款详情',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: { description: '退款详情', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: RefundSchema }) } } },
    404: { description: 'REFUND_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/client/refunds/{id}/cancel',
  tags: ['refund'],
  description: '客户撤回退款申请（仅 PENDING 可撤）',
  request: { params: z.object({ id: Id }) },
  responses: { 200: { description: '撤回成功', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: RefundSchema }) } } } },
});

// ---- Admin ----
registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/refunds',
  tags: ['refund'],
  description: '退款列表（admin 可按 status 筛选）',
  request: { query: z.object({ status: z.string().optional() }) },
  responses: { 200: { description: '退款列表', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.array(RefundSchema) }) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/refunds/{id}',
  tags: ['refund'],
  description: '退款详情（admin）',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: { description: '退款详情', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: RefundSchema }) } } },
    404: { description: 'REFUND_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/refunds/{id}/review',
  tags: ['refund'],
  description: '审核退款（APPROVE → mock 退款 COMPLETED / REJECT）',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: ReviewRefundRequestSchema } } },
  },
  responses: {
    200: { description: '审核成功', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: RefundSchema }) } } },
    409: { description: 'REFUND_NOT_REVIEWABLE', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// W6 P1: admin confirm 订单
registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/orders/{id}/confirm',
  tags: ['order'],
  description: 'Admin 确认订单（COD 订单 PENDING_CONFIRM → CONFIRMED + 自动创建 dispatch 任务）',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: {
      description: '确认成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: z.object({ id: Id, status: OrderStatus }) }),
        },
      },
    },
    409: { description: 'ORDER_STATUS_INVALID', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/orders/{id}/pick',
  tags: ['order'],
  description: 'Admin 拣货完成（CONFIRMED → PICKED，骑手可取货出发）',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: {
      description: '拣货成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: z.object({ id: Id, status: OrderStatus }) }),
        },
      },
    },
    409: { description: 'ORDER_STATUS_INVALID', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ===== Geo（W7 P0-3 地址 geocoding） =====
registry.register('GeocodeRequest', GeocodeRequest);
registry.register('GeocodeResponseData', GeocodeResponseData);

registry.registerPath({
  method: 'get',
  path: '/api/v1/common/geo/geocode',
  tags: ['geo'],
  description:
    '地址 → 经纬度 geocoding（W7 P0-3）。后端调 Nominatim OpenStreetMap，失败/无结果 fallback Dili 中心坐标。前端保存地址时调一次，避免依赖 Google Maps SDK。',
  request: {
    query: GeocodeRequest,
  },
  responses: {
    200: {
      description: 'Geocoding 结果',
      content: { 'application/json': { schema: GeocodeResponseData } },
    },
    400: {
      description: 'E-COMMON-001 校验失败（address 长度 2-500），details 含 zod 具体 message',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

// ===== Upload（W7-feature 商品图片上传） =====
registry.register('UploadResponseData', UploadResponseData);

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/uploads/product-image',
  tags: ['upload'],
  description:
    '商品图片上传（W7-feature）。multipart/form-data，field name="file"。支持 jpg/png/webp，size ≤ 5MB，服务端校验 magic bytes（防 mime 伪造）。',
  // multipart/form-data 不在 zod 注册，request body 用 OpenAPI 原生描述
  responses: {
    200: {
      description: '上传成功，返回公开 URL + key + size',
      content: { 'application/json': { schema: UploadResponseData } },
    },
    400: {
      description: 'E-UPLOAD-001 不支持的 mime / 空文件 / magic bytes 不匹配',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: { description: 'E-AUTH-003 未授权', content: { 'application/json': { schema: ErrorResponse } } },
    413: { description: '文件超过 5MB 上限', content: { 'application/json': { schema: ErrorResponse } } },
    500: {
      description: 'E-UPLOAD-002 存储失败（MinIO 故障）',
      content: { 'application/json': { schema: ErrorResponse } },
    },
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
    { name: 'product', description: '商品' },
    { name: 'sku', description: '商品规格 SKU' },
    { name: 'category', description: '商品分类' },
    { name: 'banner', description: '首页 Banner' },
    { name: 'inventory', description: '库存（含仓库匹配）' },
    { name: 'pricing', description: '配送费 + 起送价' },
    { name: 'cart', description: '购物车' },
    { name: 'order', description: '订单' },
    { name: 'payment', description: '支付' },
    { name: 'platform', description: '平台 dashboard / 审计 / 系统配置' },
    { name: 'settle', description: '结算单 + 提现审核（M W3）' },
    { name: 'im', description: 'IM 自建 WebSocket 用户签名（M W3）' },
    { name: 'upload', description: '商品图片上传（W7-feature）' },
    { name: 'geo', description: '地址 geocoding（W7 P0-3）' },
  ],
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'openapi.yaml');
writeFileSync(outPath, YAML.stringify(openapi, { indent: 2 }), 'utf-8');
console.log(`✅ OpenAPI written: ${outPath}`);
console.log(`   paths: ${Object.keys(openapi.paths || {}).length}`);
console.log(`   schemas: ${Object.keys(openapi.components?.schemas || {}).length}`);
