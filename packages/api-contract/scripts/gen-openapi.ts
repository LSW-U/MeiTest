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
  ChangePhoneRequest,
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
  NotificationPreferences,
  UpdateNotificationPreferencesRequest,
  UserSession,
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
  UpdatePricingConfigRequest,
  PricingConfigResponse,
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
  OrderCounts,
  // cart
  Cart,
  CartItem,
  AddCartItemRequest,
  UpdateCartItemRequest,
  CheckoutPreviewRequest,
  CheckoutPreview,
  BatchDeleteCartItemsRequest,
  // payment
  PaymentIntent,
  UploadReceiptRequest,
  PaymentMethodItem,
  PaymentIntentAdminView,
  PaymentIntentAdminDetail,
  ListPaymentIntentsQuery,
  PaymentIntentListResponse,
  MarkFailedRequest,
  ReconciliationItem,
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
  SupportConfig,
  SupportConfigResponse,
  LegalDocType,
  LegalDocument,
  LegalDocumentResponse,
  SocialLink,
  SocialLinkType,
  AboutStats,
  AboutProfile,
  AboutProfileResponse,
  // dispatch / rider / refund（schema 已有，path 注册放 W3-W5 联调时补）
  // W4-REVIEW P0-1 修复：admin orders + admin rider-applications path 注册
  RiderProfile,
  UpdateDutyStatusRequest,
  ApplyRiderRequest,
  UpdateRiderProfileRequest,
  ReportLocationRequest,
  DeliveryTask,
  AcceptTaskRequest,
  PickupTaskRequest,
  DeliverTaskRequest,
  ReportIssueRequest,
  StartDeliveringRequest,
  // 批次 4 admin dispatch
  ListAllTasksQuery,
  AdminDeliveryTaskView,
  AdminTaskListResponse,
  TaskOrderSummary,
  TaskRiderSummary,
  ReassignTaskRequest,
  CancelTaskRequest,
  AvailableRider,
  // 批次 5 admin inventory
  BatchAdjustRequest,
  BatchAdjustResult,
  TransferRequest,
  TransferResult,
  TransferRecord,
  ListTransfersQuery,
  ImportResult,
  // refund（W5 流程 C）
  Refund as RefundSchema,
  CreateRefundRequest as CreateRefundRequestSchema,
  ReviewRefundRequest as ReviewRefundRequestSchema,
  ListRefundsQuery as ListRefundsQuerySchema,
  RefundListResponse as RefundListResponseSchema,
  // settle（W3 M 流程：结算 + 提现，审查 P0-1 修复补注册）
  SettlementSchema,
  SettlementQuery,
  SettlementRunInput,
  SettlementListResponse,
  SettlementDetailResponse,
  WithdrawalRequestSchema,
  WithdrawalCreateInput,
  WithdrawalQuery,
  WithdrawalReviewInput,
  WithdrawalMarkPaidInput,
  WithdrawalListResponse,
  WithdrawalDetailResponse,
  // promotion（W7-ext-G）
  Promotion as PromotionSchema,
  CreatePromotionRequest as CreatePromotionRequestSchema,
  UpdatePromotionRequest as UpdatePromotionRequestSchema,
  ValidatePromotionRequest as ValidatePromotionRequestSchema,
  ValidatePromotionResponse as ValidatePromotionResponseSchema,
  ClientCoupon as ClientCouponSchema,
  MyCoupon as MyCouponSchema,
  RedeemCouponRequest as RedeemCouponRequestSchema,
  // unified-auth（W7-ext-H 统一手机号入口）
  UnifiedSendSmsRequest as SendSmsRequestSchema,
  UnifiedSendSmsResponse as SendSmsResponseSchema,
  UnifiedVerifySmsRequest as VerifySmsRequestSchema,
  UnifiedVerifySmsResponse as VerifySmsResponseSchema,
  UnifiedCompleteRegisterRequest as CompleteRegisterRequestSchema,
  UnifiedCompleteRegisterResponse as CompleteRegisterResponseSchema,
  // im（流程 M W3 自建 WS 用户签名接口）
  ImSignature,
  ConversationType,
  ImMessage,
  // geo（W7 P0-3 地址 geocoding）
  GeocodeRequest,
  GeocodeResponseData,
  // upload（W7-feature 商品图片上传）
  UploadResponseData,
  // home（活动入口 PromoDock）
  HomeEntry,
  // search（热搜 2026-07-31）
  HotSearchTermItem,
  HotSearchTerm,
  HotSearchType,
  SearchLang,
  CreateHotSearchTermRequest as CreateHotSearchTermRequestSchema,
  UpdateHotSearchTermRequest as UpdateHotSearchTermRequestSchema,
  ZeroResultTerm,
  // review（评论中心 reviews-2）
  Review,
  RiderReview,
  CreateReviewRequest,
  CreateRiderReviewRequest,
  AdminListReviewsQuery,
  AdminUpdateReviewRequest,
  // feedback（P22 反馈页 2026-08-19）
  Feedback,
  CreateFeedbackRequest,
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
registry.register('OrderCounts', OrderCounts);

registry.register('Cart', Cart);
registry.register('CartItem', CartItem);
registry.register('AddCartItemRequest', AddCartItemRequest);
registry.register('UpdateCartItemRequest', UpdateCartItemRequest);
registry.register('BatchDeleteCartItemsRequest', BatchDeleteCartItemsRequest);
registry.register('CheckoutPreviewRequest', CheckoutPreviewRequest);
registry.register('CheckoutPreview', CheckoutPreview);
registry.register('ClientCoupon', ClientCouponSchema);
registry.register('MyCoupon', MyCouponSchema);
registry.register('RedeemCouponRequest', RedeemCouponRequestSchema);

registry.register('PaymentIntent', PaymentIntent);
registry.register('UploadReceiptRequest', UploadReceiptRequest);
registry.register('PaymentMethodItem', PaymentMethodItem);
registry.register('PaymentMethodListResponseData', PaymentMethodListResponseData);
// 批次 3 admin payment
registry.register('PaymentIntentAdminView', PaymentIntentAdminView);
registry.register('PaymentIntentAdminDetail', PaymentIntentAdminDetail);
registry.register('ListPaymentIntentsQuery', ListPaymentIntentsQuery);
registry.register('PaymentIntentListResponse', PaymentIntentListResponse);
registry.register('MarkFailedRequest', MarkFailedRequest);
registry.register('ReconciliationItem', ReconciliationItem);

// 批次 4 admin dispatch
// 批次4 P3-AdminDeliveryTaskView（2026-08-28）：AdminDeliveryTaskView 的 $ref 化。
//   schema 文件里的 AdminDeliveryTaskView 是纯 DeliveryTask.extend（无 refId，
//   schema 文件里拿不到 registry 实例），故在这里用 DeliveryTaskRef.extend
//   重新构造同名字段集后 register → 输出 $ref:#/components/schemas/AdminDeliveryTaskView
//   而非 inline 4 份重复字段块。
//   ⚠️ 顺序：本块必须在 DeliveryTaskRef 定义之前只有 register 调用，
//   DeliveryTaskRef 在此声明后，下方 extend 消费。
//   已知残留：AdminTaskListResponse（PaginatedResponse 包裹）在 schema 文件里引用
//   原 AdminDeliveryTaskView 构造，其 items 仍 inline —— 要全 $ref 化需在 schema
//   文件里 extend，但那里拿不到 registry，属结构性限制，留现状。
const DeliveryTaskRef = registry.register('DeliveryTask', DeliveryTask);
// AdminDeliveryTaskViewRef：register 返回的带 refId 版本，下方 4 处端点响应
// 引用它（而非 import 的原 schema）才能输出 $ref（与 P3-1 同款 reassign 教训：
// register 不 mutate 原 const，引用谁就用谁）
//
// 批次4-fix P3-1-DRIFT（审查复核报告 2026-08-28）：AdminDeliveryTaskView 字段集在
//   schema 文件（dispatch.ts:158-163）与本脚本 DeliveryTaskRef.extend({...}）两处
//   LIVE 定义，未来改一处另一处不同步 → 列表响应（走 schema 文件 const）与单任务
//   响应（走本脚本 $ref）字段集漂移。
//   方向1（让 schema 文件 const 成唯一定义源）经 POC 证伪：zod-to-openapi 的
//   .extend() 不继承父 refId metadata，register 一个「从无 refId DeliveryTask extend
//   来」的 schema 会输出全 inline（丢失 allOf:[$ref DeliveryTask]），比现状更差。
//   故走方向2：build-time 校验两处字段 key 集合一致，不一致即 gen 失败（CI 红灯），
//   把漂移风险从「静默分歧」转成「显式失败」。
const ADMIN_DELIVERY_TASK_VIEW_EXTRA_FIELDS = {
  estimatedArrival: IsoTimestamp.nullable(),
  warehouseCode: z.string(),
  order: TaskOrderSummary,
  rider: TaskRiderSummary.nullable(),
} satisfies Record<string, z.ZodTypeAny>;

// 校验：schema 文件 AdminDeliveryTaskView 的【新增字段】与本脚本 extend 的字段 key 必须一致。
// DeliveryTask.extend(extra) 产出的新字段 = extra 的 key（DeliveryTask 自身字段不在 extra），
// 故比对 AdminDeliveryTaskView 相对 DeliveryTask 的增量字段 key 与 ADMIN_DELIVERY_TASK_VIEW_EXTRA_FIELDS 的 key。
{
  const schemaFileExtraKeys = Object.keys(
    // AdminDeliveryTaskView 是 DeliveryTask.extend(extra)，ZodObject.shape 返回合并后全字段；
    // 减去 DeliveryTask.shape 即得 extend 引入的增量字段 key。
    Object.fromEntries(
      Object.entries(AdminDeliveryTaskView.shape).filter(
        ([k]) => !(k in DeliveryTask.shape),
      ),
    ),
  ).sort();
  const scriptExtraKeys = Object.keys(ADMIN_DELIVERY_TASK_VIEW_EXTRA_FIELDS).sort();
  if (schemaFileExtraKeys.length !== scriptExtraKeys.length ||
      !schemaFileExtraKeys.every((k, i) => k === scriptExtraKeys[i])) {
    throw new Error(
      `[gen-openapi] AdminDeliveryTaskView 双定义漂移：schema 文件 extend 字段 [${schemaFileExtraKeys.join(', ')}] ` +
      `≠ gen 脚本 extend 字段 [${scriptExtraKeys.join(', ')}]。请同步两处定义（dispatch.ts:158-163 与本脚本 ADMIN_DELIVERY_TASK_VIEW_EXTRA_FIELDS）。`,
    );
  }
}

const AdminDeliveryTaskViewRef = registry.register(
  'AdminDeliveryTaskView',
  DeliveryTaskRef.extend(ADMIN_DELIVERY_TASK_VIEW_EXTRA_FIELDS),
);
registry.register('AdminTaskListResponse', AdminTaskListResponse);
registry.register('ListAllTasksQuery', ListAllTasksQuery);
registry.register('ReassignTaskRequest', ReassignTaskRequest);
registry.register('CancelTaskRequest', CancelTaskRequest);
registry.register('AvailableRider', AvailableRider);
// 批次2 审查报告 P3-1（2026-08-28）：DeliveryTask 注册到 registry 并就地 reassign，
//   使 14 处 dispatch 端点响应引用带 refId 的同一 schema → gen:openapi 输出
//   $ref:#/components/schemas/DeliveryTask 而非 inline 14 份重复字段块。
//   ⚠️ register(refId, schema) 内部走 schemaWithRefId → schema.openapi(refId)，
//   返回的是带 refId metadata 的【新 schema】，不就地 mutate 原 const；若只 register
//   不 reassign，14 处引用仍指向无 refId 的原 schema → 仍 inline（已实测）。
//   故必须 reassign，让后续所有引用（含 registerPath 响应 schema）拿到带 refId 版本。
//   （AdminDeliveryTaskView 的 $ref 化见上方批次4 注释块，用 DeliveryTaskRef.extend 方案。）

// 批次 5 admin inventory
registry.register('BatchAdjustRequest', BatchAdjustRequest);
registry.register('BatchAdjustResult', BatchAdjustResult);
registry.register('TransferRequest', TransferRequest);
registry.register('TransferResult', TransferResult);
registry.register('TransferRecord', TransferRecord);
registry.register('ListTransfersQuery', ListTransfersQuery);
registry.register('ImportResult', ImportResult);

registry.register('DashboardSummary', DashboardSummary);
registry.register('DashboardTimeRange', DashboardTimeRange);
registry.register('AuditLogListItem', AuditLogListItem);
registry.register('AuditLogDetail', AuditLogDetail);
registry.register('AuditLogQuery', AuditLogQuery);
registry.register('SystemConfigItem', SystemConfigItem);
registry.register('UpdateSystemConfigRequest', UpdateSystemConfigRequest);
registry.register('SupportConfig', SupportConfig);
// 批次3 灰度配置（2026-08-28）：pricing config 端点契约
registry.register('UpdatePricingConfigRequest', UpdatePricingConfigRequest);
registry.register('PricingConfigResponse', PricingConfigResponse);
registry.register('LegalDocType', LegalDocType);
registry.register('LegalDocument', LegalDocument);
registry.register('SocialLinkType', SocialLinkType);
registry.register('SocialLink', SocialLink);
registry.register('AboutStats', AboutStats);
registry.register('AboutProfile', AboutProfile);
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
  deprecated: true,
  description: '[DEPRECATED] SMS 验证码登录 — 已由统一入口 POST /sms/verify (action=LOGIN) 替代，将于消费者 App 切换后 2 周下线',
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
  deprecated: true,
  description: '[DEPRECATED] 发送 SMS 验证码 — 已由统一入口 POST /sms/send (challengeId 模式) 替代，将于消费者 App 切换后 2 周下线',
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

// P17 B2.1（2026-08-17）：登录态修改密码
registry.registerPath({
  method: 'post',
  path: '/api/v1/common/auth/change-password',
  tags: ['auth'],
  description:
    '登录态修改密码（需 Bearer accessToken）。password=null（SMS 注册用户）返 400 E-AUTH-007 引导走 /password-reset 首次设密；旧密码错 401 E-USER-006；成功撤销全部会话（前端引导重登）。',
  request: {
    body: { content: { 'application/json': { schema: ChangePasswordRequest } } },
  },
  responses: {
    200: { description: '修改成功（全部会话已撤销，需重新登录）' },
    400: { description: 'E-AUTH-007 未设置密码（SMS 注册用户），走 /password-reset 首次设密', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: 'E-USER-006 旧密码错误', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// P17 B2.2（2026-08-17）：登录态换绑手机号（双号验证）
registry.registerPath({
  method: 'post',
  path: '/api/v1/common/auth/change-phone',
  tags: ['auth'],
  description:
    '登录态换绑手机号（需 Bearer accessToken，双号验证）。前置：POST /sms-code 两次（旧号 + 新号，scene=BIND_PHONE）。新号已被注册 409 E-USER-004；验证码错 401 E-USER-003；成功撤销全部会话（强制重登）。',
  request: {
    body: { content: { 'application/json': { schema: ChangePhoneRequest } } },
  },
  responses: {
    200: { description: '换绑成功（全部会话已撤销，需重新登录）' },
    401: { description: 'E-USER-003 验证码无效或已过期（旧号/新号统一）', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'E-USER-004 新号已被注册或与当前号相同', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/common/auth/register',
  tags: ['auth'],
  deprecated: true,
  description: '[DEPRECATED] 密码注册 — 已由统一入口 POST /register/complete (ticket + SMS) 替代，将于消费者 App 切换后 2 周下线',
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

// P17 B1（2026-08-17）：通知偏好
registry.registerPath({
  method: 'get',
  path: '/api/v1/client/user/notification-preferences',
  tags: ['user'],
  description: '通知偏好（三分类开关，null/缺省兜底全 true）',
  responses: {
    200: {
      description: '偏好全量 {orderUpdates, promotions, system}',
      content: { 'application/json': { schema: NotificationPreferences } },
    },
  },
});

// P17 B2.3（2026-08-17）：登录设备列表
registry.registerPath({
  method: 'get',
  path: '/api/v1/client/user/sessions',
  tags: ['user'],
  description:
    '登录设备列表（Redis Token Family 只读聚合，family 维度一条，最新登录在前）。P17 决策 3：不补设备元数据（无机型/IP），只显示 deviceType + 登录/过期时间 + 状态。',
  responses: {
    200: {
      description: '会话列表',
      content: { 'application/json': { schema: UserSession.array() } },
    },
  },
});

// P17 B2.3：下线指定设备
registry.registerPath({
  method: 'delete',
  path: '/api/v1/client/user/sessions/{familyId}',
  tags: ['user'],
  description: '下线指定设备（按 familyId 撤销整族 refresh token，归属校验防撤他人会话）',
  responses: {
    200: { description: '已下线' },
    404: { description: 'E-USER-007 会话不存在或不属于当前用户', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/client/user/notification-preferences',
  tags: ['user'],
  description: '通知偏好部分更新（至少传一个 key，未传保持不变，返回更新后全量）。列表/未读数按偏好过滤（关 false 的 type 不返/不计数）。',
  request: {
    body: { content: { 'application/json': { schema: UpdateNotificationPreferencesRequest } } },
  },
  responses: {
    200: {
      description: '更新后偏好全量',
      content: { 'application/json': { schema: NotificationPreferences } },
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
  path: '/api/v1/client/products/{id}/skus',
  tags: ['product'],
  description: '商品规格列表（B6，只返 ACTIVE SKU，供 C 端规格选择器）',
  responses: {
    200: { description: 'SKU 列表', content: { 'application/json': { schema: Sku.array() } } },
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
          // 距离计费批次1（2026-08-27）：对齐 PricingService.DeliveryFeeResult 8 字段
          // 删旧 distance，加 freeKm/distanceKm(nullable)/distanceFee 明细
          schema: z.object({
            warehouseId: Id,
            baseFee: z.number().int().nonnegative(),
            perKmFee: z.number().int().nonnegative(),
            /** 免费起步距离（km） */
            freeKm: z.number().nonnegative(),
            /** 计费距离（km，PostGIS ST_DistanceSphere 仓库中心→收货地址）；无坐标时 null */
            distanceKm: z.number().nullable(),
            /** 距离加价（分）= max(0, distanceKm - freeKm) × perKmFee */
            distanceFee: z.number().int().nonnegative(),
            deliveryFee: z.number().int().nonnegative(),
            currency: z.literal('USD'),
          }),
        },
      },
    },
  },
});

// P2-3 修复（2026-08-27 审查报告）：移除 /client/pricing/min-order-check 路径注册
//   端点已删（pricing.controller），checkMinOrder 死代码清理。起送价需求激活时再恢复。

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
  description: '更新某仓库的基础配送费（旧端点，向后兼容；新代码用 /config）',
  request: {
    body: { content: { 'application/json': { schema: z.object({ baseFee: z.number().int().nonnegative() }) } } },
  },
  responses: {
    // 批次3 审查 P2-2（2026-08-28）：补 200 content schema，前端类型化（旧端点既有缺陷一并修）
    200: { description: '更新成功', content: { 'application/json': { schema: PricingConfigResponse } } },
  },
});

// 批次3 灰度配置（2026-08-28）：admin 配值端点，partial 改 baseFee/perKmFee/freeKm
registry.registerPath({
  method: 'patch',
  path: '/api/v1/admin/pricing/warehouses/{warehouseId}/config',
  tags: ['pricing'],
  description:
    '更新某仓库的配送费配置（批次3 灰度）。三字段全可选 partial——未传字段不动。' +
    '灰度节奏：perKmFee=0 上线（行为=现状）→ admin 配 50 分/km 生效 → 摸底校准。' +
    '至少传一个字段，否则 400。',
  request: {
    body: {
      content: {
        'application/json': {
          schema: UpdatePricingConfigRequest,
        },
      },
    },
  },
  responses: {
    // 批次3 审查 P2-2（2026-08-28）：补 200 content schema（PricingConfigResponse），前端返回体类型化
    200: { description: '更新成功（返回 warehouseId/baseFee/perKmFee/freeKm）', content: { 'application/json': { schema: PricingConfigResponse } } },
    400: { description: '至少传一个字段 / 字段非法', content: { 'application/json': { schema: ErrorResponse } } },
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

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/orders/counts',
  tags: ['order'],
  description: '订单状态计数（B3，个人中心 4 宫格 badge 数据源，per-status 计数）',
  responses: {
    200: { description: '各状态订单数', content: { 'application/json': { schema: OrderCounts } } },
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

// P5 #1 客服配置公开下发（2026-08-25）：骑手/客户端 help 页读 support.phone
registry.registerPath({
  method: 'get',
  path: '/api/v1/common/support/config',
  tags: ['platform'],
  description: '客服配置公开下发（phone + hours，help 页消费，无需登录）',
  responses: {
    200: {
      description: '客服配置（phone 可拨号，hours 展示）',
      content: { 'application/json': { schema: SupportConfigResponse } },
    },
    404: { description: 'SUPPORT_CONFIG_NOT_INITIALIZED', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// P5 #3 法律文档公开下发（2026-08-25）：注册/协议页读 TERMS / PRIVACY / LICENSE 正文
registry.registerPath({
  method: 'get',
  path: '/api/v1/common/legal/{docType}',
  tags: ['platform'],
  description: '法律文档公开下发（TERMS 服务条款 / PRIVACY 隐私政策 / LICENSE 营业资质，按 Accept-Language 切片，无需登录）',
  parameters: [
    {
      name: 'docType',
      in: 'path',
      required: true,
      schema: { type: 'string', enum: ['TERMS', 'PRIVACY', 'LICENSE'] },
      description: '文档类型：TERMS（服务条款）/ PRIVACY（隐私政策）/ LICENSE（营业资质）',
    },
  ],
  responses: {
    200: {
      description: '当前生效版本（按请求语言切片的单语言正文）',
      content: { 'application/json': { schema: LegalDocumentResponse } },
    },
    404: { description: 'LEGAL_DOCUMENT_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// P25 #2 关于页可配置数据下发（2026-08-25）：信任数据条 stats + 社交链接 socials，无需登录
registry.registerPath({
  method: 'get',
  path: '/api/v1/client/about/profile',
  tags: ['platform'],
  description: '关于页可配置数据下发（stats 信任数据条 + socials 社交链接，无需登录，Redis 缓存 1h）',
  responses: {
    200: {
      description: '信任数据条（regions/merchants/orders 原始数字）+ 社交链接列表',
      content: { 'application/json': { schema: AboutProfileResponse } },
    },
    404: { description: 'ABOUT_PROFILE_NOT_INITIALIZED', content: { 'application/json': { schema: ErrorResponse } } },
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
  path: '/api/v1/client/cart/items/batch-delete',
  tags: ['cart'],
  description: '批量删除购物车项（B2，管理模式批量删，替代 N 次单删）',
  request: {
    body: { content: { 'application/json': { schema: BatchDeleteCartItemsRequest } } },
  },
  responses: {
    200: {
      description: '批量删除后的购物车',
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
  path: '/api/v1/client/coupons/available',
  tags: ['promotion'],
  description:
    '领券中心（P1 领券体系）。返可领模板：ACTIVE + 有效期内 + 未超额 + 当前用户未领过。' +
    'Role: customer。返回 ClientCoupon[]（status 固定 available）。',
  responses: {
    200: {
      description: '可领模板列表',
      content: { 'application/json': { schema: ClientCouponSchema.array() } },
    },
    401: { description: 'UNAUTHORIZED', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/client/coupons/{promotionId}/claim',
  tags: ['promotion'],
  description:
    '领取优惠券（P1 领券体系）。按模板 id 领取，生成 UserCoupon(UNUSED)。' +
    '同券每人限领 1 张（@@unique），重复领抛 E-COUPON-003；模板不可领抛 E-COUPON-004。',
  request: { params: z.object({ promotionId: Id }) },
  responses: {
    200: {
      description: '领取成功',
      content: { 'application/json': { schema: MyCouponSchema } },
    },
    409: { description: 'E-COUPON-003 已领过 / E-COUPON-004 模板不可领', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/client/coupons/redeem',
  tags: ['promotion'],
  description:
    '码兑换领取（P1 领券体系）。输优惠码领到卡包（不再"即用"）。按 code 找模板后等同 claim。' +
    '码不存在/不可领抛 E-COUPON-004；已领过抛 E-COUPON-003。',
  request: { body: { content: { 'application/json': { schema: RedeemCouponRequestSchema } } } },
  responses: {
    200: {
      description: '兑换领取成功',
      content: { 'application/json': { schema: MyCouponSchema } },
    },
    400: { description: 'E-COUPON-004 码无效/模板不可领', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'E-COUPON-003 已领过', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/client/coupons',
  tags: ['promotion'],
  description:
    '我的卡包（P1 领券体系，精确查 UserCoupon）。?status=available|used|expired，默认 available。' +
    'available=UNUSED 且未过期；used=USED；expired=EXPIRED 或 UNUSED 但模板已过期（定时任务未跑的查询兜底）。' +
    '响应 MyCoupon（实例维度），status 枚举 available/used/expired（对齐前端/文档语义，2026-08-13 统一）。',
  request: {
    query: z.object({
      status: z.enum(['available', 'used', 'expired']).optional(),
    }),
  },
  responses: {
    200: { description: '我的卡包（按 status 过滤）', content: { 'application/json': { schema: MyCouponSchema.array() } } },
    400: { description: 'INVALID_STATUS', content: { 'application/json': { schema: ErrorResponse } } },
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
// Admin Payment（批次 3：admin payment 透视）
// ============================================================================

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/payments',
  tags: ['payment'],
  description: '支付列表（admin，游标分页 + join order，可按 status/method/orderNo/mockFlag 筛选；批次 3）',
  request: { query: ListPaymentIntentsQuery },
  responses: {
    200: { description: '支付列表（游标分页）', content: { 'application/json': { schema: PaymentIntentListResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/payments/reconciliation',
  tags: ['payment'],
  description: '对账汇总（group by status + method，运营对账用；批次 3）',
  responses: {
    200: {
      description: '对账汇总',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: z.array(ReconciliationItem) }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/payments/{id}',
  tags: ['payment'],
  description: '支付详情（含 order + order.refunds；批次 3）',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: {
      description: '支付详情',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: PaymentIntentAdminDetail }) } },
    },
    404: { description: 'PAYMENT_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/payments/{orderId}/confirm-receipt',
  tags: ['payment'],
  description: '确认收款（admin 审核银行转账凭证 → PAID + Order CONFIRMED，同事务编排；批次 3）',
  request: { params: z.object({ orderId: Id }) },
  responses: {
    200: {
      description: '确认成功',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: PaymentIntent }) } },
    },
    409: { description: 'PAYMENT_STATUS_CONFLICT / ORDER_STATUS_CONFLICT', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/payments/{orderId}/mark-failed',
  tags: ['payment'],
  description: '标 PaymentIntent FAILED（手动，不自动取消订单；批次 3）',
  request: {
    params: z.object({ orderId: Id }),
    body: { content: { 'application/json': { schema: MarkFailedRequest } } },
  },
  responses: {
    200: {
      description: '标失败成功',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: PaymentIntent }) } },
    },
    409: { description: 'PAYMENT_STATUS_CONFLICT', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ============================================================================
// Admin Dispatch（批次 4：admin dispatch 看板）
// ============================================================================

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/dispatch/tasks',
  tags: ['dispatch'],
  description: '任务监控列表（admin，游标分页 + filter status/warehouseId/riderId/orderNo；批次 4）',
  request: { query: ListAllTasksQuery },
  responses: {
    200: { description: '任务列表（游标分页）', content: { 'application/json': { schema: AdminTaskListResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/dispatch/tasks/{id}',
  tags: ['dispatch'],
  description: '任务详情（含 order + rider；批次 4）',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: { description: '任务详情', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: AdminDeliveryTaskViewRef }) } } },
    404: { description: 'DISPATCH_TASK_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/dispatch/tasks/{id}/reassign',
  tags: ['dispatch'],
  description: '改派骑手（仅 SUPER_ADMIN；第一期 ASSIGNED only；事务双写 delivery_tasks + order.riderId；批次 4）',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: ReassignTaskRequest } } },
  },
  responses: {
    200: { description: '改派成功', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: AdminDeliveryTaskViewRef }) } } },
    409: { description: 'DISPATCH_REASSIGN_STATUS_CONFLICT / RIDER_INVALID', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/dispatch/tasks/{id}/cancel',
  tags: ['dispatch'],
  description: '取消任务（仅 SUPER_ADMIN；PENDING_ASSIGN/ASSIGNED；事务双写 task FAILED + order.riderId=null；批次 4）',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: CancelTaskRequest } } },
  },
  responses: {
    200: { description: '取消成功', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: AdminDeliveryTaskViewRef }) } } },
    409: { description: 'DISPATCH_CANCEL_STATUS_CONFLICT', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/dispatch/riders/available',
  tags: ['dispatch'],
  description: '可派骑手列表（APPROVED + Redis isOnline 标记，在线优先；批次 4）',
  responses: {
    200: { description: '可派骑手', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.array(AvailableRider) }) } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/dispatch/orders/{orderId}/recreate',
  tags: ['dispatch'],
  description: '补建任务（仅 SUPER_ADMIN；复用 createTaskForOrder，幂等；批次 4）',
  request: { params: z.object({ orderId: Id }) },
  responses: {
    200: { description: '补建成功（已存在则返回现有 task）', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: AdminDeliveryTaskViewRef }) } } },
    404: { description: 'ORDER_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ============================================================================
// Admin Inventory（批次 5：批量调整 + 调拨 + CSV 导入导出）
// ============================================================================

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/inventory/stocks/batch-adjust',
  tags: ['inventory'],
  description: '批量调整库存（全事务，上限 100，一条失败全部回滚；批次 5）',
  request: { body: { content: { 'application/json': { schema: BatchAdjustRequest } } } },
  responses: {
    200: { description: '批量调整成功', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: BatchAdjustResult }) } } },
    400: { description: 'E-INVENTORY-008 超上限', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/inventory/transfer',
  tags: ['inventory'],
  description: '仓库间调拨（双仓原子：源 deductStock + 目标 create/update，referenceType=TRANSFER + referenceId 串联两条 StockLog；批次 5）',
  request: { body: { content: { 'application/json': { schema: TransferRequest } } } },
  responses: {
    200: { description: '调拨成功', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: TransferResult }) } } },
    400: { description: 'E-INVENTORY-001 源不足 / 005 同仓 / 006 空 / 007 超上限', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/inventory/transfers',
  tags: ['inventory'],
  description: '调拨记录列表（查 StockLog referenceType=TRANSFER，按 referenceId 聚合；批次 5）',
  request: { query: ListTransfersQuery },
  responses: {
    200: { description: '调拨记录', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.array(TransferRecord) }) } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/inventory/stocks/export',
  tags: ['inventory'],
  description: '导出库存快照 CSV（warehouseId,warehouseCode,skuId,quantity,safetyStock,status；批次 5）',
  responses: {
    200: { description: 'CSV 文件（text/csv; charset=utf-8）' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/inventory/stocks/import',
  tags: ['inventory'],
  description: '导入批量调整 CSV（multipart field=file，逐行部分成功返 failedRows；表头 warehouseId,skuId,deltaQty,reason?；批次 5）',
  responses: {
    200: { description: '导入结果', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: ImportResult }) } } },
    400: { description: 'E-INVENTORY-009 CSV 格式错', content: { 'application/json': { schema: ErrorResponse } } },
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

// ---- 客户端促销校验（W7-ext-G P1-3）----
registry.registerPath({
  method: 'post',
  path: '/api/v1/promotions/validate',
  tags: ['promotion'],
  description:
    '客户端校验促销码（W7-ext-G P1-3）。购物车实时预览折扣，不 increment usedCount。' +
    'Role: customer。返回 { valid, discount, reason?, type? }，reason 仅 valid=false 时有值。',
  request: {
    body: { content: { 'application/json': { schema: ValidatePromotionRequestSchema } } },
  },
  responses: {
    200: {
      description: '校验结果',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: ValidatePromotionResponseSchema,
          }),
        },
      },
    },
    401: { description: 'UNAUTHORIZED', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'FORBIDDEN', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ============================================================================
// W7-ext-H：统一手机号入口（3 endpoints，仅 BUYER）
// ============================================================================

registry.register('SendSmsRequest', SendSmsRequestSchema);
registry.register('SendSmsResponse', SendSmsResponseSchema);
registry.register('VerifySmsRequest', VerifySmsRequestSchema);
registry.register('VerifySmsResponse', VerifySmsResponseSchema);
registry.register('CompleteRegisterRequest', CompleteRegisterRequestSchema);
registry.register('CompleteRegisterResponse', CompleteRegisterResponseSchema);

registry.registerPath({
  method: 'post',
  path: '/api/v1/common/auth/sms/send',
  tags: ['auth'],
  description: '统一手机号入口：发送验证码。202 + challengeId（无论是否注册统一响应，防枚举）。仅 BUYER。',
  request: { body: { content: { 'application/json': { schema: SendSmsRequestSchema } } } },
  responses: {
    202: { description: '验证码已发送', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: SendSmsResponseSchema }) } } },
    429: { description: 'RATE_LIMIT', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/common/auth/sms/verify',
  tags: ['auth'],
  description: '统一手机号入口：验证码校验 + 分流（LOGIN/REGISTER/BLOCKED）。不暴露手机号是否已注册。',
  request: { body: { content: { 'application/json': { schema: VerifySmsRequestSchema } } } },
  responses: {
    200: { description: '校验结果', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: VerifySmsResponseSchema }) } } },
    401: { description: 'SMS_CODE_INVALID', content: { 'application/json': { schema: ErrorResponse } } },
    429: { description: 'RATE_LIMIT', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/common/auth/register/complete',
  tags: ['auth'],
  description: '统一手机号入口：完成注册（ticket GETDEL 原子消费 + DB 事务创建 BUYER）。强制 role=CUSTOMER。',
  request: { body: { content: { 'application/json': { schema: CompleteRegisterRequestSchema } } } },
  responses: {
    200: { description: '注册成功', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: CompleteRegisterResponseSchema }) } } },
    410: { description: 'TICKET_INVALID_OR_USED', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'PHONE_ALREADY_REGISTERED', content: { 'application/json': { schema: ErrorResponse } } },
    400: { description: 'MUST_AGREE_TERMS', content: { 'application/json': { schema: ErrorResponse } } },
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
  description:
    '骑手入驻申请（创建 RiderProfile applicationStatus=PENDING）。W3 骑手个人区（2026-08-24）：apply payload 改带 URL 字段（avatarUrl/idCardImageUrl/licenseImageUrl），前端先调 /common/rider/uploads/* 拿 URL 再提交；后端只存 URL 不收文件。',
  request: {
    body: { content: { 'application/json': { schema: ApplyRiderRequest } } },
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
  description: '获取当前骑手资料（含 applicationStatus + 在线状态 + avatarUrl/证件 URL + points/tier）',
  responses: {
    200: {
      description: '骑手资料',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: RiderProfile }) } },
    },
    404: { description: 'PROFILE_NOT_FOUND', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ---- 骑手自助改资料（W3 骑手个人区，2026-08-24）----
registry.registerPath({
  method: 'patch',
  path: '/api/v1/rider/profile',
  tags: ['rider'],
  description:
    '骑手自助改资料（W3 骑手个人区 2026-08-24）。idCardNumber 不可改（换号应重新 apply）；支持改 riderName/phone/vehicleType/vehiclePlate/avatarUrl/idCardImageUrl/licenseImageUrl；URL 字段传 null 清除。仅 APPROVED 骑手可改。',
  request: {
    body: { content: { 'application/json': { schema: UpdateRiderProfileRequest } } },
  },
  responses: {
    200: {
      description: '更新后的骑手资料',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: RiderProfile }) } },
    },
    403: { description: 'NOT_APPROVED', content: { 'application/json': { schema: ErrorResponse } } },
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
  description:
    '心跳续期（Redis rider:online:{riderId} SETEX 60s，骑手 App 每 50s 调一次）。P6 #6（2026-08-25）：返回 maybeOffline=false（刚续期 TTL=60s 远离 30s 宽限阈值）；profile 查询接口在 TTL≤30s 时返回 maybeOffline=true 供前端提示重连。',
  responses: {
    200: {
      description: '续期结果',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              renewed: z.boolean(),
              /** 是否处于宽限期（刚续期为 false；保留字段供未来按 TTL 反算） */
              maybeOffline: z.boolean(),
            }),
          }),
        },
      },
    },
  },
});

// ---- 位置上报（后台定位 HTTP 通道，P0 规则 16）----
registry.registerPath({
  method: 'post',
  path: '/api/v1/rider/location/report',
  tags: ['rider'],
  description:
    '骑手上报位置（前台 WS location:update + 后台 HTTP /report 双通道，后端转发为 order:location WS 广播到 order:{orderId} room）。后台定位仅在「配送中」启用，orderId 必填。',
  request: {
    body: { content: { 'application/json': { schema: ReportLocationRequest } } },
  },
  responses: {
    200: {
      description: '上报成功（已广播到 order:{orderId} room）',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ broadcast: z.literal(true) }),
          }),
        },
      },
    },
    400: {
      description: 'E-RIDER-007 orderId required for background report',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: {
      description: 'E-AUTH-002 auth required',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: 'E-DISPATCH-003 order not assigned to this rider',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    404: {
      description: 'E-ORDER-001 order not found',
      content: { 'application/json': { schema: ErrorResponse } },
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
            data: z.object({ items: z.array(DeliveryTaskRef) }),
          }),
        },
      },
    },
  },
});

// ---- 我的任务（骑手视角：已接单/取货/配送中） ----
registry.registerPath({
  method: 'get',
  path: '/api/v1/rider/dispatch/my-tasks',
  tags: ['dispatch'],
  description: '获取当前骑手已接单/取货/配送中的任务列表（status in ASSIGNED/PICKED_UP/DELIVERING）',
  responses: {
    200: {
      description: '我的任务列表',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ items: z.array(DeliveryTaskRef) }),
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
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: DeliveryTaskRef }) } },
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
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: DeliveryTaskRef }) } },
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
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: DeliveryTaskRef }) } },
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
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: DeliveryTaskRef }) } },
    },
  },
});

// P14 ④：return 任务开始配送（PICKED_UP -> DELIVERING），打通原 DELIVERING 死状态
registry.registerPath({
  method: 'post',
  path: '/api/v1/rider/dispatch/tasks/{id}/start-delivering',
  tags: ['dispatch'],
  description:
    'P14 ④：骑手开始配送（PICKED_UP -> DELIVERING）。仅 taskType=return 任务可调，' +
    '打通原 DELIVERING 死状态（return 三步 PICKED_UP->DELIVERING->DELIVERED；delivery 两步跳过 DELIVERING 走 deliver）。' +
    '事务内：deliveryTask.update(DELIVERING) + refund.update(pickedAt)（前端 P14 时间轴 picked 步骤展示）。',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: StartDeliveringRequest } } },
  },
  responses: {
    200: {
      description: '开始配送成功（task 进入 DELIVERING；return 任务同时写 refund.pickedAt）',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: DeliveryTaskRef }) } },
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
  description: '退款列表（admin，游标分页，可按 status 筛选；批次 2.1 改造）',
  request: { query: ListRefundsQuerySchema },
  responses: { 200: { description: '退款列表（游标分页 items + nextCursor + hasMore）', content: { 'application/json': { schema: RefundListResponseSchema } } } },
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

// P3-3: admin 兜底重触发 return task（refund APPROVE 时 createTaskForReturn 失败的人工介入）
registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/refunds/{id}/retrigger-return-task',
  tags: ['refund'],
  description:
    'P3-3：admin 兜底重触发 return task（refund APPROVE 时 createTaskForReturn 失败，refund 已 COMPLETED 但 return task 未建时的人工介入）。' +
    '返新建的 DeliveryTask（taskType=return）。错误码：E-REFUND-003 refund 不存在 / E-DISPATCH-022 refund 不是 RETURN_REFUND / E-DISPATCH-021 已有 return task。',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: {
      description: '重触发成功（返新建的 return task）',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: DeliveryTaskRef }) } },
    },
    404: { description: 'E-REFUND-003 refund 不存在', content: { 'application/json': { schema: ErrorResponse } } },
    409: {
      description: 'E-DISPATCH-021 已有 return task / E-DISPATCH-022 refund 不是 RETURN_REFUND',
      content: { 'application/json': { schema: ErrorResponse } },
    },
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

// ===== Client Upload（P13 售后凭证上传，2026-08-10）=====
registry.registerPath({
  method: 'post',
  path: '/api/v1/client/uploads/refund-evidence',
  tags: ['upload'],
  description:
    '退款凭证上传（P13 售后图片 2026-08-10）。multipart/form-data，field name="file"。CUSTOMER 权限 + DeviceTypeGuard 自动校验 client_app deviceType。支持 jpg/png/webp，size ≤ 5MB，最小 100×100（无 1:1 约束，售后凭证任意比例），服务端校验 magic bytes（防 mime 伪造）。',
  // multipart/form-data 不在 zod 注册，request body 用 OpenAPI 原生描述
  responses: {
    200: {
      description: '上传成功，返回公开 URL + key + size（前端拿到 URL 后提交 POST /client/refunds 的 photos[]）',
      content: { 'application/json': { schema: UploadResponseData } },
    },
    400: {
      description: '不支持的 mime / 空文件 / magic bytes 不匹配 / 尺寸过小（< 100×100）',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: { description: 'E-AUTH-003 未授权', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'E-AUTH-001 跨端调用或 E-AUTH-012 非本人', content: { 'application/json': { schema: ErrorResponse } } },
    413: { description: '文件超过 5MB 上限', content: { 'application/json': { schema: ErrorResponse } } },
    500: {
      description: 'E-UPLOAD-001 存储服务错误（StorageError）/ E-UPLOAD-002 其他上传错误',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

// ===== Client Upload - review-image（P15 B2 评价图上传，2026-08-11）=====
registry.registerPath({
  method: 'post',
  path: '/api/v1/client/uploads/review-image',
  tags: ['upload'],
  description:
    '评价图片上传（P15 B2 评价图 2026-08-11）。multipart/form-data，field name="file"。CUSTOMER 权限 + DeviceTypeGuard 自动校验 client_app deviceType。支持 jpg/png/webp，size ≤ 5MB，最小 100×100（无 1:1 约束，评价图任意比例），服务端校验 magic bytes（防 mime 伪造）。MinIO 路径前缀 reviews/（与 refund-evidence 的 refunds/ 区分，便于审计/清理）。',
  // multipart/form-data 不在 zod 注册，request body 用 OpenAPI 原生描述
  responses: {
    200: {
      description: '上传成功，返回公开 URL + key + size（前端拿到 URL 后提交 POST /client/orders/:id/review 的 images[]）',
      content: { 'application/json': { schema: UploadResponseData } },
    },
    400: {
      description: '不支持的 mime / 空文件 / magic bytes 不匹配 / 尺寸过小（< 100×100）',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: { description: 'E-AUTH-003 未授权', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'E-AUTH-001 跨端调用或 E-AUTH-012 非本人', content: { 'application/json': { schema: ErrorResponse } } },
    413: { description: '文件超过 5MB 上限', content: { 'application/json': { schema: ErrorResponse } } },
    500: {
      description: 'E-UPLOAD-001 存储服务错误（StorageError）/ E-UPLOAD-002 其他上传错误',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

// ===== Client Upload - feedback-image（P22 F2 反馈截图上传，2026-08-19）=====
registry.registerPath({
  method: 'post',
  path: '/api/v1/client/uploads/feedback-image',
  tags: ['upload'],
  description:
    '反馈截图上传（P22 F2 2026-08-19）。multipart/form-data，field name="file"。CUSTOMER 权限 + DeviceTypeGuard 自动校验 client_app deviceType。支持 jpg/png/webp，size ≤ 5MB，最小 100×100（无 1:1 约束，反馈截图任意比例），服务端校验 magic bytes（防 mime 伪造）。MinIO 路径前缀 feedbacks/（与 reviews/、refunds/ 区分，便于审计/清理）。止血用途：反馈页此前复用 review-image，real 模式上传 URL 无消费方 → 孤儿文件 + reviews/ 前缀语义污染。',
  // multipart/form-data 不在 zod 注册，request body 用 OpenAPI 原生描述
  responses: {
    200: {
      description: '上传成功，返回公开 URL + key + size（前端拿到 URL 后提交 POST /client/feedback 的 images[]）',
      content: { 'application/json': { schema: UploadResponseData } },
    },
    400: {
      description: '不支持的 mime / 空文件 / magic bytes 不匹配 / 尺寸过小（< 100×100）',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: { description: 'E-AUTH-003 未授权', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'E-AUTH-001 跨端调用或 E-AUTH-012 非本人', content: { 'application/json': { schema: ErrorResponse } } },
    413: { description: '文件超过 5MB 上限', content: { 'application/json': { schema: ErrorResponse } } },
    500: {
      description: 'E-UPLOAD-001 存储服务错误（StorageError）/ E-UPLOAD-002 其他上传错误',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});
// ===== Rider Upload - avatar/id-card-image/license-image（W3 骑手个人区，2026-08-24）=====
// common 前缀：apply 阶段用户尚持 client_app token（role=CUSTOMER），审核通过后才变 rider_app。
// apply payload 改带 URL 方案：前端先调这三个端点拿 URL，再提交到 POST /common/rider/apply。
registry.registerPath({
  method: 'post',
  path: '/api/v1/common/rider/uploads/avatar',
  tags: ['upload', 'rider'],
  description:
    '骑手头像上传（W3 骑手个人区 2026-08-24）。multipart/form-data，field name="file"。CUSTOMER 权限（apply 阶段用户）。支持 jpg/png/webp，size ≤ 5MB，最小 200×200，强制 1:1 正方形（容差 5%）。MinIO 路径前缀 riders/avatar-。',
  responses: {
    200: {
      description: '上传成功，返回公开 URL + key + size（apply 阶段填入 avatarUrl）',
      content: { 'application/json': { schema: UploadResponseData } },
    },
    400: {
      description: '不支持的 mime / 空文件 / magic bytes 不匹配 / 尺寸过小（< 200×200）/ 非 1:1',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: { description: 'E-AUTH-003 未授权', content: { 'application/json': { schema: ErrorResponse } } },
    413: { description: '文件超过 5MB 上限', content: { 'application/json': { schema: ErrorResponse } } },
    500: {
      description: 'E-UPLOAD-001 存储服务错误（StorageError）/ E-UPLOAD-002 其他上传错误',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/common/rider/uploads/id-card-image',
  tags: ['upload', 'rider'],
  description:
    '骑手身份证图上传（W3 骑手个人区 2026-08-24）。multipart/form-data，field name="file"。CUSTOMER 权限（apply 阶段用户）。支持 jpg/png/webp，size ≤ 5MB，最小 300×200（任意比例，防模糊）。MinIO 路径前缀 riders/idcard-。',
  responses: {
    200: {
      description: '上传成功，返回公开 URL + key + size（apply 阶段填入 idCardImageUrl）',
      content: { 'application/json': { schema: UploadResponseData } },
    },
    400: {
      description: '不支持的 mime / 空文件 / magic bytes 不匹配 / 尺寸过小（< 300×200）',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: { description: 'E-AUTH-003 未授权', content: { 'application/json': { schema: ErrorResponse } } },
    413: { description: '文件超过 5MB 上限', content: { 'application/json': { schema: ErrorResponse } } },
    500: {
      description: 'E-UPLOAD-001 存储服务错误（StorageError）/ E-UPLOAD-002 其他上传错误',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/common/rider/uploads/license-image',
  tags: ['upload', 'rider'],
  description:
    '骑手驾照/车辆证件图上传（W3 骑手个人区 2026-08-24）。multipart/form-data，field name="file"。CUSTOMER 权限（apply 阶段用户）。支持 jpg/png/webp，size ≤ 5MB，最小 300×200（任意比例，防模糊）。MinIO 路径前缀 riders/license-。',
  responses: {
    200: {
      description: '上传成功，返回公开 URL + key + size（apply 阶段填入 licenseImageUrl）',
      content: { 'application/json': { schema: UploadResponseData } },
    },
    400: {
      description: '不支持的 mime / 空文件 / magic bytes 不匹配 / 尺寸过小（< 300×200）',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: { description: 'E-AUTH-003 未授权', content: { 'application/json': { schema: ErrorResponse } } },
    413: { description: '文件超过 5MB 上限', content: { 'application/json': { schema: ErrorResponse } } },
    500: {
      description: 'E-UPLOAD-001 存储服务错误（StorageError）/ E-UPLOAD-002 其他上传错误',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

// ===== Home Entries（活动入口 PromoDock，路线 A 配置接口）=====
registry.registerPath({
  method: 'get',
  path: '/api/v1/client/home-entries',
  tags: ['home'],
  description: '首页活动入口（PromoDock 常驻 4 入口配置，@Public。按 sortOrder 升序，仅返 ACTIVE）',
  responses: {
    200: {
      description: '活动入口列表',
      content: { 'application/json': { schema: HomeEntry.array() } },
    },
  },
});

// ===== Search（热搜，2026-07-31）=====
registry.registerPath({
  method: 'get',
  path: '/api/v1/client/search/hot',
  tags: ['search'],
  description: '热搜榜（Redis ZSET 计数排行 + 运营种子词，@Public）。返 HotSearchTermItem[]，word 是实际搜索词非 i18n key。',
  request: {
    query: z.object({
      limit: z.number().int().min(1).max(20).optional(),
      lang: z.enum(['en', 'zh', 'id', 'pt', 'tet']).optional(),
    }),
  },
  responses: {
    200: {
      description: '热搜列表（PINNED 前置 + BLOCKED 剔除 + ZSET 真实 + MANUAL 兜底）',
      content: { 'application/json': { schema: HotSearchTermItem.array() } },
    },
  },
});

// 搜索建议 / 输入联想（C 方案词联想，2026-08-05）
registry.registerPath({
  method: 'get',
  path: '/api/v1/client/search/suggest',
  tags: ['search'],
  description:
    '搜索建议 / 输入联想（C 方案词联想，@Public）。三源合并去重：HotSearchTerm 词库前缀匹配（PINNED/MANUAL）+ Redis ZSET 真实词前缀 + 商品名前缀兜底。返 HotSearchTermItem[]，word 是建议词非 i18n key。prefix < 1 字符返空数组。',
  request: {
    query: z.object({
      prefix: z.string().min(1).max(50),
      limit: z.number().int().min(1).max(20).optional(),
    }),
  },
  responses: {
    200: {
      description: '建议词列表（词库 > ZSET > 商品名，BLOCKED 全链路剔除）',
      content: { 'application/json': { schema: HotSearchTermItem.array() } },
    },
  },
});

// ===== Admin hot-search（运营管理，2026-08-28 契约补全）=====
// 后端 AdminHotSearchController 已实现 6 端点，此处补 OpenAPI 注册（Role: SUPER_ADMIN）。
// 统一响应包装 { success: true, data: ... }，沿用 controller 返回形态。

/** Admin 热搜项（P2-1 修复 2026-08-28）：与客户端 HotSearchTermItem 分离——
 *  adminListHot 跨语言聚合时每条带 lang 标记来源 ZSET（search.service.ts 返回
 *  {word, lang, searchCount}），客户端 /client/search/hot 故意无 lang（语义不同），
 *  故不复用 HotSearchTermItem，独立定义对齐实现 */
const AdminHotListItem = z.object({
  word: z.string(),
  lang: SearchLang,
  searchCount: z.number().int(),
});

/** Admin 热搜响应包装（ZSET 真实热度 top N） */
const AdminHotListResponse = z.object({
  success: z.literal(true),
  data: AdminHotListItem.array(),
});

/** Admin 种子词 / 零结果词响应包装 */
const AdminHotSearchTermsResponse = z.object({
  success: z.literal(true),
  data: HotSearchTerm.array(),
});

const AdminZeroResultResponse = z.object({
  success: z.literal(true),
  data: ZeroResultTerm.array(),
});

/** Admin 种子词操作（create/update）响应包装 */
const AdminHotSearchTermMutationResponse = z.object({
  success: z.literal(true),
  data: HotSearchTerm,
});

/** Admin 删除种子词响应包装 */
const AdminHotSearchTermDeleteResponse = z.object({
  success: z.literal(true),
  data: z.object({ id: Id }),
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/hot-search',
  tags: ['search'],
  description:
    'ZSET 真实热搜 top N（运营看热度，Role: SUPER_ADMIN）。返 AdminHotListItem[]（word + lang + searchCount，lang 标记来源语言 ZSET）。limit 默认 50 最大 200，可按 lang 筛选。',
  request: {
    query: z.object({
      lang: SearchLang.optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: {
      description: 'ZSET 真实热度排行',
      content: { 'application/json': { schema: AdminHotListResponse } },
    },
    401: { description: '未认证', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: '非 SUPER_ADMIN', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/hot-search/terms',
  tags: ['search'],
  description:
    '运营种子词列表（HotSearchTerm 表，Role: SUPER_ADMIN）。可按 lang/type 筛选，返 HotSearchTerm[]（含 id/word/lang/type/sortOrder/status/时间戳）。',
  request: {
    query: z.object({
      lang: SearchLang.optional(),
      type: HotSearchType.optional(),
    }),
  },
  responses: {
    200: {
      description: '种子词列表',
      content: { 'application/json': { schema: AdminHotSearchTermsResponse } },
    },
    401: { description: '未认证', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: '非 SUPER_ADMIN', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/hot-search/zero-result',
  tags: ['search'],
  description:
    '零结果词聚合（运营补商品/补词依据，Role: SUPER_ADMIN）。从 SearchLog 聚合「用户搜了但无商品」的词，返 ZeroResultTerm[]（word + lang + count）。可按 lang 筛选。',
  request: {
    query: z.object({
      lang: SearchLang.optional(),
    }),
  },
  responses: {
    200: {
      description: '零结果词排行',
      content: { 'application/json': { schema: AdminZeroResultResponse } },
    },
    401: { description: '未认证', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: '非 SUPER_ADMIN', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/hot-search/terms',
  tags: ['search'],
  description:
    '新增运营种子词（Role: SUPER_ADMIN）。type=PINNED 置顶 / MANUAL 兜底 / BLOCKED 屏蔽。word 1-50 字符，lang 五语言之一。',
  request: {
    body: { content: { 'application/json': { schema: CreateHotSearchTermRequestSchema } } },
  },
  responses: {
    200: {
      description: '创建后的种子词',
      content: { 'application/json': { schema: AdminHotSearchTermMutationResponse } },
    },
    400: { description: '请求体校验失败', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: '未认证', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: '非 SUPER_ADMIN', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/admin/hot-search/terms/{id}',
  tags: ['search'],
  description:
    '编辑运营种子词（Role: SUPER_ADMIN）。支持 word/lang/type/sortOrder/status 局部更新。',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: UpdateHotSearchTermRequestSchema } } },
  },
  responses: {
    200: {
      description: '更新后的种子词',
      content: { 'application/json': { schema: AdminHotSearchTermMutationResponse } },
    },
    400: { description: '请求体校验失败', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: '未认证', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: '非 SUPER_ADMIN', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'E-SEARCH-001 种子词不存在', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/admin/hot-search/terms/{id}',
  tags: ['search'],
  description: '删除运营种子词（Role: SUPER_ADMIN）。返 { id }。',
  request: {
    params: z.object({ id: Id }),
  },
  responses: {
    200: {
      description: '删除成功',
      content: { 'application/json': { schema: AdminHotSearchTermDeleteResponse } },
    },
    401: { description: '未认证', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: '非 SUPER_ADMIN', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'E-SEARCH-001 种子词不存在', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ===== 生成 =====
// ===== review schemas + paths（评论中心 reviews-2）=====
registry.register('Review', Review);
registry.register('RiderReview', RiderReview);
registry.register('CreateReviewRequest', CreateReviewRequest);
registry.register('CreateRiderReviewRequest', CreateRiderReviewRequest);
registry.register('HomeEntry', HomeEntry);
registry.register('HotSearchTermItem', HotSearchTermItem);
registry.register('HotSearchTerm', HotSearchTerm);
registry.register('CreateHotSearchTermRequest', CreateHotSearchTermRequestSchema);
registry.register('UpdateHotSearchTermRequest', UpdateHotSearchTermRequestSchema);
registry.register('ZeroResultTerm', ZeroResultTerm);

// C 端：提交订单/商品评论
registry.registerPath({
  method: 'post',
  path: '/api/v1/client/orders/{id}/review',
  tags: ['review'],
  description: '客户提交订单/商品评论。校验：订单已送达（DELIVERED/DELIVERED_PAID/DELIVERED_UNPAID/COMPLETED）+ 一订单一条（F2/F5）',
  request: {
    body: { content: { 'application/json': { schema: CreateReviewRequest } } },
  },
  responses: {
    200: { description: '评论创建成功', content: { 'application/json': { schema: Review } } },
    403: { description: 'E-REVIEW-005 无权', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'E-REVIEW-002 未送达 / E-REVIEW-003 已评论', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// C 端：提交骑手评价
registry.registerPath({
  method: 'post',
  path: '/api/v1/client/orders/{id}/rider-review',
  tags: ['review'],
  description: '客户提交骑手评价。校验：订单已送达 + 有骑手 + 一订单一条。写入后全量重算 RiderProfile.rating（F4/F6）',
  request: {
    body: { content: { 'application/json': { schema: CreateRiderReviewRequest } } },
  },
  responses: {
    200: { description: '骑手评价创建成功', content: { 'application/json': { schema: RiderReview } } },
    409: { description: 'E-REVIEW-002/003/004', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// C 端：商品评论列表（商品详情页，仅 APPROVED）
registry.registerPath({
  method: 'get',
  path: '/api/v1/client/products/{id}/reviews',
  tags: ['review'],
  description: '商品评论列表（仅 APPROVED，游标分页）',
  responses: {
    200: { description: '评论列表', content: { 'application/json': { schema: Review } } },
  },
});

// C 端：订单的骑手评价（订单详情展示）
registry.registerPath({
  method: 'get',
  path: '/api/v1/client/orders/{id}/rider-review',
  tags: ['review'],
  description: '订单的骑手评价（无则 data=null）',
  responses: {
    200: { description: '骑手评价', content: { 'application/json': { schema: RiderReview } } },
  },
});

// C 端：订单的所有评价（评价页判断哪些商品已评 + 标记，P15 多商品评价）
registry.registerPath({
  method: 'get',
  path: '/api/v1/client/orders/{id}/reviews',
  tags: ['review'],
  description:
    '订单的所有评价（自己提交的，含 PENDING/REJECTED，按 createdAt 升序）。评价页用于判断哪些商品已评 + 标记（P15 多商品评价）。需订单归属（E-REVIEW-005 非自己订单拒）。',
  responses: {
    200: { description: '订单评价列表', content: { 'application/json': { schema: Review.array() } } },
    403: { description: 'E-REVIEW-005 订单不归属', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'E-REVIEW-001 订单不存在', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// Admin：评论列表（type=customer|rider + 多维筛选 + 分页）
registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/reviews',
  tags: ['review'],
  description: 'Admin 评论列表。query: type(customer|rider) / category(PRODUCT|DELIVERY) / status(PENDING|APPROVED|REJECTED) / rating(1-5) / keyword / cursor / limit',
  responses: {
    200: { description: '列表（items 按 type 是客户评论或骑手评价）', content: { 'application/json': { schema: Review } } },
  },
});

// Admin：评论详情
registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/reviews/{id}',
  tags: ['review'],
  description: 'Admin 评论详情（?type=customer|rider 区分表）',
  responses: {
    200: { description: '详情', content: { 'application/json': { schema: Review } } },
    404: { description: 'E-REVIEW-001 不存在', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// Admin：审核 status + 商家回复 reply
registry.registerPath({
  method: 'patch',
  path: '/api/v1/admin/reviews/{id}',
  tags: ['review'],
  description: 'Admin 审核 status + 商家回复 reply（?type 区分表；骑手评价仅 status）',
  request: {
    body: { content: { 'application/json': { schema: AdminUpdateReviewRequest } } },
  },
  responses: {
    200: { description: '更新成功', content: { 'application/json': { schema: Review } } },
    404: { description: 'E-REVIEW-001', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// Admin：硬删（决策4）
registry.registerPath({
  method: 'delete',
  path: '/api/v1/admin/reviews/{id}',
  tags: ['review'],
  description: 'Admin 硬删评论（?type 区分表；删骑手评价后重算 rating）',
  responses: {
    200: { description: '删除成功' },
    404: { description: 'E-REVIEW-001', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ===== feedback（P22 反馈页 2026-08-19）=====
registry.register('Feedback', Feedback);
registry.register('CreateFeedbackRequest', CreateFeedbackRequest);

// C 端：提交反馈
registry.registerPath({
  method: 'post',
  path: '/api/v1/client/feedback',
  tags: ['feedback'],
  description:
    '客户提交反馈（P22 F1 2026-08-19）。category 六值纯枚举（feature/product/order/payment/shipping/other，前端 FEEDBACK_TYPE_KEYS 提交前 .split(\'.\').pop() 转尾段）。content 10-500 字单语言原话。截图先调 POST /client/uploads/feedback-image 拿 URL 传 images[]（isOwnUrl 校验防外链）。限流：user 维度 5 次/小时 + ip 维度 20 次/小时。',
  request: {
    body: { content: { 'application/json': { schema: CreateFeedbackRequest } } },
  },
  responses: {
    200: { description: '反馈创建成功，返回 feedbackId', content: { 'application/json': { schema: Feedback } } },
    400: { description: '校验失败（category 枚举外 / content 长度 / images > 9）', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'E-FEEDBACK-001 图片 URL 非本服务上传（防 SSRF/外链）', content: { 'application/json': { schema: ErrorResponse } } },
    429: { description: '限流（5 次/小时/用户）', content: { 'application/json': { schema: ErrorResponse } } },
  },
});


// ============================================================================
// settle 端点（W3 M 流程：结算 + 提现，审查 P0-1 修复补注册，之前零注册）
// ============================================================================

// ---- 结算单 settlement ----
registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/settle/settlements',
  tags: ['settle'],
  description: '结算单列表（offset 分页 page/pageSize/total）。Role: super_admin。',
  request: { query: SettlementQuery },
  responses: {
    200: { description: '结算单列表', content: { 'application/json': { schema: SettlementListResponse } } },
    401: { description: 'UNAUTHORIZED', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'FORBIDDEN', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/settle/settlements/{id}',
  tags: ['settle'],
  description: '结算单详情',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: { description: '详情', content: { 'application/json': { schema: SettlementDetailResponse } } },
    404: { description: 'E-SETTLE-004', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/settle/settlements/{id}/confirm',
  tags: ['settle'],
  description: '确认结算单（PENDING → CONFIRMED，乐观锁 updateMany 防双过）',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: { description: '确认成功', content: { 'application/json': { schema: SettlementDetailResponse } } },
    404: { description: 'E-SETTLE-004 not found', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'E-SETTLE-003 状态不对/race', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/settle/settlements/run',
  tags: ['settle'],
  description: '手动触发结算（T+1 兜底/调试；幂等：同 periodDate+subject 唯一，重复返已有）',
  request: { body: { content: { 'application/json': { schema: SettlementRunInput } } } },
  responses: {
    200: { description: '触发成功（新建或返回已有）', content: { 'application/json': { schema: SettlementDetailResponse } } },
    409: { description: 'E-SETTLE-003 race', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ---- 提现申请 withdrawal ----
registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/settle/withdrawals',
  tags: ['settle'],
  description: '创建提现申请（super_admin 代录；金额超可用余额抛 E-SETTLE-001）',
  request: { body: { content: { 'application/json': { schema: WithdrawalCreateInput } } } },
  responses: {
    200: { description: '创建成功', content: { 'application/json': { schema: WithdrawalDetailResponse } } },
    400: { description: 'E-SETTLE-001 余额不足', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/settle/withdrawals',
  tags: ['settle'],
  description: '提现申请列表（offset 分页）。super_admin 写权限；warehouse_staff/customer_service 只读。',
  request: { query: WithdrawalQuery },
  responses: {
    200: { description: '提现列表', content: { 'application/json': { schema: WithdrawalListResponse } } },
    401: { description: 'UNAUTHORIZED', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'FORBIDDEN', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/settle/withdrawals/{id}',
  tags: ['settle'],
  description: '提现申请详情',
  request: { params: z.object({ id: Id }) },
  responses: {
    200: { description: '详情', content: { 'application/json': { schema: WithdrawalDetailResponse } } },
    404: { description: 'E-SETTLE-002', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/settle/withdrawals/{id}/review',
  tags: ['settle'],
  description: '审核提现（APPROVE/REJECT，REJECT 必填 rejectReason）。仅 super_admin。',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: WithdrawalReviewInput } } },
  },
  responses: {
    200: { description: '审核成功', content: { 'application/json': { schema: WithdrawalDetailResponse } } },
    404: { description: 'E-SETTLE-002', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'E-SETTLE-003 状态不对/race', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/settle/withdrawals/{id}/mark-paid',
  tags: ['settle'],
  description: '标记线下打款完成（必填 payoutReference，APPROVED → PAID）。仅 super_admin。',
  request: {
    params: z.object({ id: Id }),
    body: { content: { 'application/json': { schema: WithdrawalMarkPaidInput } } },
  },
  responses: {
    200: { description: '标记成功', content: { 'application/json': { schema: WithdrawalDetailResponse } } },
    404: { description: 'E-SETTLE-002', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'E-SETTLE-003 非 APPROVED', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

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
    { name: 'review', description: '评论中心（客户评论 + 骑手评价，reviews-2）' },
    { name: 'feedback', description: '用户反馈（P22 反馈页）' },
    { name: 'home', description: '首页活动入口（PromoDock）' },
    { name: 'search', description: '热搜词（Redis ZSET + 运营种子词）' },
  ],
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'openapi.yaml');
writeFileSync(outPath, YAML.stringify(openapi, { indent: 2 }), 'utf-8');
console.log(`✅ OpenAPI written: ${outPath}`);
console.log(`   paths: ${Object.keys(openapi.paths || {}).length}`);
console.log(`   schemas: ${Object.keys(openapi.components?.schemas || {}).length}`);
