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
  LoginResponseData,
  RegisterRequest,
  RefreshRequest,
  RefreshResponseData,
  LogoutRequest,
  SendSmsRequest,
  SendSmsResponseData,
  ResetPasswordRequest,
  // user
  User,
  UpdateProfileRequest,
  ChangePasswordRequest,
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
  // common
  ErrorResponse,
} from '../src/index.js';

const registry = new OpenAPIRegistry();

// ===== Schemas 注册 =====
registry.register('JwtPayload', JwtPayload);
registry.register('ErrorResponse', ErrorResponse);

registry.register('LoginRequest', LoginRequest);
registry.register('LoginResponseData', LoginResponseData);
registry.register('RegisterRequest', RegisterRequest);
registry.register('RefreshRequest', RefreshRequest);
registry.register('RefreshResponseData', RefreshResponseData);
registry.register('LogoutRequest', LogoutRequest);
registry.register('SendSmsRequest', SendSmsRequest);
registry.register('SendSmsResponseData', SendSmsResponseData);
registry.register('ResetPasswordRequest', ResetPasswordRequest);

registry.register('User', User);
registry.register('UpdateProfileRequest', UpdateProfileRequest);
registry.register('ChangePasswordRequest', ChangePasswordRequest);

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
  description: '密码登录（v0.3：deviceType 由前端 App 配置写死）',
  request: {
    body: { content: { 'application/json': { schema: LoginRequest } } },
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
  path: '/api/v1/common/auth/register',
  tags: ['auth'],
  description: '注册（v0.3 冲突 11：smsCode 可选，W6 强制）',
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
  method: 'post',
  path: '/api/v1/common/auth/send-sms',
  tags: ['auth'],
  description: 'SMS stub（固定 123456，标 [SMS_STUB]），W6 切东帝汶本地',
  request: {
    body: { content: { 'application/json': { schema: SendSmsRequest } } },
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
  method: 'get',
  path: '/api/v1/client/profile',
  tags: ['user'],
  responses: {
    200: {
      description: '获取个人信息',
      content: { 'application/json': { schema: User } },
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
