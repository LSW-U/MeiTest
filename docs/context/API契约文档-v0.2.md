---
title: MeiMart 三端统一后端 — API 契约文档 v0.2
category: Backend
tags:
  - api
  - contract
  - backend
  - frontend-collaboration
created_date: 2026-06-15
last_updated: 2026-06-15
version: "0.2"
status: "审核后修订版 — 待负责人确认商家端范围"
related:
  - "[[技术栈选型与问题深度分析]]"
  - "[[MeiMart-客户端-HTML转RN全流程方案-v0.2]]"
---

# MeiMart API 契约文档 v0.2

> **本文档是三端（客户端App / 骑手端App / 商家端Web）与后端之间的唯一接口约定。**
> 任何一方修改接口字段前必须通知所有相关方，并更新本文档。
>
> **规则：契约优先于实现。后端开发按本文档写，前端 Mock 按本文档造数据。**

---

## v0.1 → v0.2 变更摘要

| # | 变更 | 原因 |
|---|------|------|
| 1 | 删除 OrderStatus.PENDING_PAYMENT，重画 COD 状态机 | COD 模式下客户不预付，PENDING_PAYMENT 永不触发 |
| 2 | Order 接口补 `remark` 字段 | 创建订单 Request 有 remark 但 Order 模型缺失 |
| 3 | 认证路径统一 `/common/auth/*` + clientType | 删除 `/rider/auth/login`，避免三套 refresh/logout 逻辑 |
| 4 | REQUEST_EXPIRED 改 400，INVALID_SIGNATURE 改 403 | 防止前端拦截器 401 刷新死循环 |
| 5 | 删除 `/client/orders/:id/pay` | COD 模式客户端无需发起支付 |
| 6 | 删除 6 个预留字段 | 契约反映当前现实，未来功能到时再加 |
| 7 | Product 补 salesCount、unit | 列表/详情展示需要 |
| 8 | 补充缺失接口：reorder、review查看、version-check、regions | 高频业务 |
| 9 | 配送追踪 MVP 用轮询（10s），预留 WS 升级 | 小团队+弱网，轮询性价比最高 |
| 10 | 弱类型字段强化（paymentMethod、SkuAttribute） | 类型安全 |
| 11 | JWT payload 删 phone；补 SMS 限流规则 | 安全 |
| 12 | 补 GET /health、图片上传限制 | 部署需要 |
| 13 | 时区/多语言规则明确 | 东帝汶单一市场 |
| 14 | 「待确认」拆分为「决策记录」+「待确认」 | 减少冗余 |
| 15 | 删除 REFUNDING/REFUNDED 状态 | COD 模式退款是线下操作，API 无触发入口 |

---

## 目录

- [一、通用约定](#一通用约定)
- [二、认证体系](#二认证体系)
- [三、前后端协作协议（关键！）](#三前后端协作协议关键)
- [四、错误码规范](#四错误码规范)
- [五、数据模型（核心实体）](#五数据模型核心实体)
- [六、接口清单](#六接口清单)
  - [6.1 认证模块](#61-认证模块)
  - [6.2 商品模块](#62-商品模块)
  - [6.3 购物车模块](#63-购物车模块)
  - [6.4 订单模块](#64-订单模块)
  - [6.5 地址模块](#65-地址模块)
  - [6.6 用户模块](#66-用户模块)
  - [6.7 骑手模块](#67-骑手模块)
  - [6.8 支付模块](#68-支付模块)
  - [6.9 公共模块](#69-公共模块)
  - [6.10 商家端模块](#610-商家端模块)
- [七、决策记录（已定）](#七决策记录已定)
- [八、待确认事项](#八待确认事项)
- [附录：订单状态流转图（COD 模式）](#附录订单状态流转图cod-模式)

---

## 一、通用约定

### 1.1 Base URL

```
开发环境:   http://localhost:13000/api/v1
Staging:    https://staging-api.meimart.xxx/api/v1
Production: https://api.meimart.xxx/api/v1
```

> 域名待确认，前端用环境变量 `API_BASE_URL` 配置。

### 1.2 路由前缀

三端共用同一后端，通过路由前缀区分端：

| 前缀 | 端 | 说明 |
|------|-----|------|
| `/api/v1/client/*` | 客户端 App（消费者端） | A 负责 |
| `/api/v1/rider/*` | 骑手端 App | B 负责 |
| `/api/v1/merchant/*` | 商家端 Web | B 负责 |
| `/api/v1/common/*` | 公共接口（含三端统一认证） | — |
| `/api/v1/admin/*` | 后台管理（后期） | — |

### 1.3 命名规范

| 维度 | 规范 | 示例 |
|------|------|------|
| **URL 路径** | 全小写，kebab-case | `/api/v1/client/product-categories` |
| **JSON 字段** | **camelCase**（统一，前后端一致） | `productName`, `orderNo`, `createdAt` |
| **数据库表名** | snake_case（Prisma 层做映射） | `product_skus` → Prisma `ProductSku` |
| **数据库字段** | snake_case（Prisma 层做映射） | `created_at` → Prisma `createdAt` |
| **时间格式** | ISO 8601 UTC 字符串（存储/传输） | `"2026-06-15T08:30:00.000Z"` |
| **前端展示时区** | 硬编码 UTC+9（东帝汶 Asia/Dili） | 不做系统时区自适应 |
| **ID 格式** | UUID v4 | `"f47ac10b-58cc-4372-a567-0e02b2c3d479"` |
| **金额格式** | **整数，单位：分**（避免浮点精度） | `$9.99` → `price: 999` |
| **布尔值** | JSON `true` / `false` | `isAvailable: true` |
| **分页游标** | 字符串 cursor（base64编码） | `"eyJjdXJzb3Ii..."` |

> **金额特别说明**：所有金额字段统一用整数（分），前端展示时 `/100` 并格式化。不要用 float。
>
> **时区特别说明**：目标市场单一（东帝汶 UTC+9），前端展示一律转 UTC+9，硬编码，避免开发者（中国 UTC+8）调试时的时区混乱。

### 1.4 统一响应格式

#### 成功响应

```json
{
  "success": true,
  "data": { ... },
  "message": "操作成功"
}
```

- `success`: 固定 `true`
- `data`: 业务数据，可以是对象、数组或 `null`
- `message`: 可选，成功提示信息

#### 列表 + 分页响应

```json
{
  "success": true,
  "data": {
    "items": [ ... ],
    "nextCursor": "***...",
    "hasMore": true,
    "total": 156
  }
}
```

- `items`: 当前页数据数组
- `nextCursor`: 下一页游标，`null` 表示没有更多
- `hasMore`: 是否还有更多数据
- `total`: 总记录数（仅首页返回，后续页可省略）

> **分页方式**：统一用 cursor-based 分页（游标分页），不用 offset/limit。前端通过 `?cursor=xxx` 请求下一页。

#### 错误响应

```json
{
  "success": false,
  "error": {
    "code": "STOCK_NOT_ENOUGH",
    "message": "部分商品库存不足",
    "details": {
      "failedItems": [
        { "skuId": "xxx", "available": 3, "requested": 5 }
      ]
    }
  }
}
```

- `code`: 大写下划线的错误码（见[错误码规范](#四错误码规范)）
- `message`: 面向用户的友好提示
- `details`: 可选，补充信息（如哪些商品缺货）

### 1.5 HTTP 状态码使用

| 状态码 | 含义 | 使用场景 |
|--------|------|---------|
| `200 OK` | 请求成功 | 所有成功的 GET / POST / PATCH / DELETE |
| `201 Created` | 资源创建成功 | 创建订单、地址等（也可统一用 200） |
| `400 Bad Request` | 参数错误 | Zod 校验失败、业务逻辑错误、**请求时间戳过期** |
| `401 Unauthorized` | 未认证 | Token 缺失 / 过期 |
| `403 Forbidden` | 无权限 | 越权访问、角色不足、**签名校验失败** |
| `404 Not Found` | 资源不存在 | 商品/订单不存在 |
| `409 Conflict` | 冲突 | 重复操作、状态冲突 |
| `429 Too Many Requests` | 限流 | 触发限流策略 |
| `500 Internal Server Error` | 服务器错误 | 未捕获异常 |

> **注意**：业务错误（如库存不足）返回 `400`，响应体里的 `error.code` 区分具体类型。不要把业务错误用 `200` 返回。
>
> **401 vs 403 vs 400**：401 表示"你是谁？"（Token 问题）；403 表示"我知道你是谁，但你不能这么做"；400 表示"你的请求参数有问题"。前端拦截器只对 401 触发 refreshToken 刷新。

### 1.6 请求头约定

| Header | 说明 | 是否必须 |
|--------|------|---------|
| `Authorization` | `Bearer <accessToken>` | 认证接口必须 |
| `Content-Type` | `application/json` | POST/PATCH 必须 |
| `Accept-Language` | `zh` / `en` / `pt` / `id` / `tet` | 可选，影响 `error.message` 语言 |
| `X-Request-Id` | 请求唯一标识（幂等控制） | 写操作建议带上 |
| `X-Timestamp` | 请求时间戳（毫秒） | 见协作协议 |
| `X-Nonce` | 随机串（防重放） | 见协作协议 |
| `X-Signature` | 请求签名 | MVP 不强制，上线前开启 |

---

## 二、认证体系

### 2.1 认证流程

```
登录成功
  → 返回 accessToken（有效期 15 分钟）+ refreshToken（有效期 30 天）
  → 前端存 expo-secure-store
  → 每次请求带 Authorization: Bearer ***

accessToken 过期（401）
  → 前端自动用 refreshToken 换新 accessToken
  → 换取成功 → 重发原请求
  → 换取失败 → 清除登录态 → 跳转登录页
```

### 2.2 Token 规范

| 项 | accessToken | refreshToken |
|----|------------|-------------|
| 格式 | JWT | JWT（或 opaque token） |
| 有效期 | 15 分钟 | 30 天 |
| 存储 | 内存 / expo-secure-store | expo-secure-store |
| 刷新方式 | — | POST `/common/auth/refresh` |
| 失效条件 | 过期 / 主动登出 | 过期 / 登出 / 被踢 |

### 2.3 JWT Payload

```json
{
  "sub": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "role": "CUSTOMER",
  "iat": 1718444400,
  "exp": 1718445300
}
```

> **安全说明**：JWT payload 是 base64 编码（非加密），**不存放任何敏感信息**（phone、密码等）。
> `sub` 是用户 UUID，需要手机号等用户信息时通过 `GET /client/profile` 或 `GET /rider/profile` 查询。

### 2.4 角色定义

| 角色 | 值 | 端 | 权限 |
|------|-----|-----|------|
| 消费者 | `CUSTOMER` | 客户端 App | 自己的订单、地址、购物车 |
| 骑手 | `RIDER` | 骑手端 App | 分配的配送任务、自己的位置 |
| 商家 | `MERCHANT` | 商家端 Web | 自己店铺的商品、订单 |
| 管理员 | `ADMIN` | 后台 | 全部 |

### 2.5 三端统一认证

所有端共用 `/common/auth/*` 接口，通过请求体中的 `clientType` 区分端：

```json
{
  "clientType": "CUSTOMER" | "RIDER" | "MERCHANT"
}
```

**后端校验**：`user.role` 必须与 `clientType` 匹配，不匹配返回 `403 FORBIDDEN`。

**差异化返回**：
- `clientType: CUSTOMER` → 返回 `user`
- `clientType: RIDER` → 返回 `user` + `rider`（RiderProfile）
- `clientType: MERCHANT` → 返回 `user` + `store`（Store）

---

## 三、前后端协作协议（关键！）

> ⚠️ 这一节解决之前识别的三个前后端冲突，所有端必须遵守。

### 3.1 幂等性规则（解决「重复加购」冲突）

**规则**：前端每个**用户操作**（不是每个 HTTP 请求）生成一个唯一的 `X-Request-Id`。

| 场景 | requestId 来源 | 说明 |
|------|---------------|------|
| 首次加购 | `crypto.randomUUID()` | 用户点击「加入购物车」时生成 |
| 网络重试同一个加购 | **复用同一个** requestId | 不要生成新的 |
| 弱网离线后队列重放 | **复用同一个** requestId | 操作入队时生成，重放时带上 |
| 用户再次点击加购（新操作） | 生成**新的** requestId | 这是新的一次操作 |

**后端约定**：
- 收到相同 `X-Request-Id` 的写操作 → 直接返回上次的结果，不重复执行
- `X-Request-Id` 在 Redis 中保留 24 小时
- 前端**必须**在所有 POST / PATCH / DELETE 操作中带上 `X-Request-Id`

### 3.2 签名 & 时间戳规则（解决「离线重放过期」冲突）

**规则**：签名和时间戳在**发送时刻**生成，不是在「操作发起」时刻生成。

| 场景 | timestamp 取值 | 说明 |
|------|---------------|------|
| 正常请求 | 当前时间 | `Date.now()` |
| 离线队列重放 | **重放时刻的当前时间** | 不是入队时的时间 |
| 网络重试 | **重试时刻的当前时间** | 不是首次请求的时间 |

**后端约定**：
- 时间戳容差：±5 分钟（东帝汶弱网环境给宽一点）
- nonce 防重放：同一 nonce 5 分钟内不可重复使用（Redis SETNX）
- 签名算法：`HMAC-SHA256(body + timestamp + nonce, API_SIGN_SECRET)`
- **MVP 阶段**：timestamp + nonce 防重放**必须做**（成本低），签名校验作为可选项先不强制，上线前开启

### 3.3 响应字段映射（解决「前后端数据结构不一致」冲突）

**规则**：后端 API 返回的 JSON 字段统一用 **camelCase**，与前端 TypeScript 类型完全一致。

```
数据库 (snake_case) → Prisma (自动 camelCase) → API 响应 (camelCase) → 前端 TS 类型 (camelCase)
```

后端在 Prisma schema 层统一用 `@map` 映射：

```prisma
model Product {
  id            String   @id @default(uuid())
  productName   String   @map("product_name")
  createdAt     DateTime @default(now()) @map("created_at")

  @@map("products")
}
```

API 响应直接用 Prisma 返回的对象（camelCase），不需要额外转换层。

### 3.4 Mock 数据对齐规则

前端 Mock 数据**必须**严格按本文档第五节的「数据模型」定义来造。

前端类型定义文件 `src/types/api.ts` 应与本文档同步：

```typescript
// src/types/api.ts — 与后端契约文档保持一致

export interface Product {
  id: string;
  productName: string;
  // ... 完全按本文档定义
}
```

如果前端发现需要文档中没有的字段 → **暂停并提出来**，不要自行添加。
如果后端需要修改字段 → **先改本文档**，再改代码。

---

## 四、错误码规范

### 4.1 通用错误码

| Code | HTTP | 含义 |
|------|------|------|
| `VALIDATION_ERROR` | 400 | 参数校验失败 |
| `UNAUTHORIZED` | 401 | 未登录或 Token 失效 |
| `TOKEN_EXPIRED` | 401 | Token 过期，请刷新 |
| `REFRESH_TOKEN_INVALID` | 401 | Refresh Token 无效，需重新登录 |
| `FORBIDDEN` | 403 | 无权限 / 角色不匹配 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `CONFLICT` | 409 | 状态冲突 / 重复操作 |
| `RATE_LIMIT_EXCEEDED` | 429 | 请求过于频繁 |
| `REQUEST_EXPIRED` | **400** | 请求时间戳过期（参数过期，非认证问题） |
| `INVALID_SIGNATURE` | **403** | 签名校验失败（请求被拒绝执行） |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

> **关键**：REQUEST_EXPIRED 和 INVALID_SIGNATURE **不是 401**。前端拦截器看到 401 会自动刷新 Token，但时间戳过期/签名错误刷新 Token 无用，会导致无限循环。

### 4.2 业务错误码

| Code | HTTP | 含义 | 模块 |
|------|------|------|------|
| `USER_NOT_FOUND` | 404 | 用户不存在 | 认证 |
| `PHONE_ALREADY_REGISTERED` | 409 | 手机号已注册 | 认证 |
| `SMS_CODE_INVALID` | 400 | 验证码错误 | 认证 |
| `SMS_CODE_EXPIRED` | 400 | 验证码已过期 | 认证 |
| `SMS_RATE_LIMIT` | 429 | 短信发送频率超限 | 认证 |
| `LOGIN_FAILED` | 401 | 手机号或密码错误 | 认证 |
| `PRODUCT_NOT_FOUND` | 404 | 商品不存在 | 商品 |
| `SKU_NOT_FOUND` | 404 | SKU 不存在 | 商品 |
| `STOCK_NOT_ENOUGH` | 400 | 库存不足 | 订单 |
| `CART_EMPTY` | 400 | 购物车为空 | 购物车 |
| `ORDER_NOT_FOUND` | 404 | 订单不存在 | 订单 |
| `ORDER_STATUS_INVALID` | 409 | 订单状态不允许此操作 | 订单 |
| `ORDER_CANNOT_CANCEL` | 409 | 订单无法取消 | 订单 |
| `ADDRESS_NOT_FOUND` | 404 | 地址不存在 | 地址 |
| `RIDER_NOT_AVAILABLE` | 400 | 骑手不可用 | 骑手 |
| `DELIVERY_TASK_NOT_FOUND` | 404 | 配送任务不存在 | 骑手 |

> 后续根据业务需要扩展，新错误码必须先加到本文档。

### 4.3 SMS 短信限流策略

| 维度 | 限制 |
|------|------|
| 同手机号 | 60 秒内 1 条，1 小时内 5 条，24 小时内 10 条 |
| 同 IP | 1 小时内 20 条 |
| 超限响应 | `RATE_LIMIT_EXCEEDED`（429），`details: { retryAfter: 45 }`（秒） |

---

## 五、数据模型（核心实体）

> 以下定义前端 TypeScript 接口 + 后端 Prisma 模型的共同基准。字段名是 camelCase。

### 5.1 User（用户）

```typescript
interface User {
  id: string;                    // UUID
  phone: string;                 // 手机号（脱敏返回：770****234）
  name: string | null;           // 昵称
  avatarUrl: string | null;      // 头像 URL
  role: 'CUSTOMER' | 'RIDER' | 'MERCHANT' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  createdAt: string;             // ISO 8601 UTC
  updatedAt: string;
}
```

> v0.1 的 memberLevel、points 字段已删除（未来加会员体系时再引入，bump 版本号）。

### 5.2 Product（商品）

```typescript
interface Product {
  id: string;
  productName: string;
  description: string | null;
  mainImage: string;             // 主图 URL
  images: string[];              // 详情图 URL 数组
  categoryId: string;
  storeId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK';
  unit: string;                  // 销售单位："袋"/"瓶"/"kg"/"个"
  // 价格取所有 SKU 的最低价
  priceMin: number;              // 最低价（分）
  salesCount: number;            // 累计销量（非实时，离线统计更新）
  createdAt: string;
  updatedAt: string;
}
```

> v0.1 的 isFlashSale、flashSalePrice 字段已删除（未来加秒杀功能时再引入）。
> **salesCount 说明**：非实时统计，通过定时任务（每小时）聚合订单数据更新，避免每次查询都 JOIN 订单表。

### 5.3 ProductSku（商品 SKU）

```typescript
interface ProductSku {
  id: string;
  productId: string;
  skuName: string;               // 如 "500g / 红色"
  attributes: SkuAttribute[];    // 结构化属性，见下方定义
  price: number;                 // 单价（分）
  stock: number;                 // 库存
  imageUrl: string | null;       // SKU 图片
  status: 'ACTIVE' | 'INACTIVE';
}

interface SkuAttribute {
  name: string;                  // 属性名："规格"
  value: string;                 // 属性值："500g"
  valueId: string;               // 属性值 ID（未来做筛选用）
}
```

> v0.1 的 `attributes: Record<string, string>` 改为结构化的 `SkuAttribute[]`，便于前端渲染属性标签和未来做筛选。

### 5.4 Category（分类）

```typescript
interface Category {
  id: string;
  name: string;
  iconUrl: string;
  parentId: string | null;       // null = 一级分类
  sortOrder: number;
  productCount: number;          // 该分类下商品数（列表页展示用）
}
```

### 5.5 Cart（购物车）

```typescript
interface Cart {
  id: string;                    // 购物车 ID（一个用户一个）
  userId: string;
  items: CartItem[];
  totalQuantity: number;         // 自动计算
  totalAmount: number;           // 自动计算（分）
  totalSavings: number;          // 优惠金额（分），MVP 固定 0
  updatedAt: string;
}

interface CartItem {
  id: string;
  skuId: string;
  productId: string;
  productName: string;
  productImage: string;
  skuName: string;
  unitPrice: number;             // 加入时价格（分）
  quantity: number;
  stock: number;                 // 当前库存（用于前端判断是否超量）
  isSelected: boolean;           // 是否勾选
  addedAt: string;
}
```

> `totalSavings` 保留（MVP 固定 0），因为它参与前端 `payableAmount = totalAmount - totalSavings` 的展示计算。

### 5.6 Order（订单）

```typescript
interface Order {
  id: string;
  orderNo: string;               // 订单号（人类可读，如 "MM202606150001"）
  userId: string;
  status: OrderStatus;
  items: OrderItem[];
  // 金额
  totalAmount: number;           // 商品总价（分）
  deliveryFee: number;           // 配送费（分）
  discountAmount: number;        // 优惠金额（分），MVP 固定 0
  payableAmount: number;         // 实付金额（分）= totalAmount + deliveryFee - discountAmount
  // 地址快照（下单时拷贝，不随地址修改变化）
  deliveryAddress: AddressSnapshot;
  // 备注
  remark: string | null;         // 客户下单备注，如 "送到门口"
  // 配送
  riderId: string | null;
  deliveryTaskId: string | null;
  // 支付
  paymentMethod: 'CASH';         // MVP 只有现金（COD），不接受 null
  paymentStatus: 'UNPAID' | 'PAID';
  paidAt: string | null;
  // 时间线
  createdAt: string;
  confirmedAt: string | null;    // 商家确认
  deliveringAt: string | null;   // 骑手取货
  deliveredAt: string | null;    // 送达
  cancelledAt: string | null;
  cancelReason: string | null;
}

interface OrderItem {
  id: string;
  productId: string;
  skuId: string;
  productName: string;           // 快照
  productImage: string;          // 快照
  skuName: string;               // 快照
  unitPrice: number;             // 下单时价格快照（分）
  quantity: number;
  subtotal: number;              // = unitPrice * quantity（分）
}

type OrderStatus =
  | 'PENDING_CONFIRM'    // 待商家确认
  | 'CONFIRMED'          // 已确认，待分配骑手
  | 'ASSIGNED'           // 已分配骑手
  | 'PICKED_UP'          // 骑手已取货
  | 'DELIVERING'         // 配送中
  | 'DELIVERED'          // 已送达
  | 'COMPLETED'          // 已完成（用户确认/自动完成）
  | 'CANCELLED'          // 已取消
  | 'FAILED';            // 配送失败

interface AddressSnapshot {
  name: string;
  phone: string;
  detail: string;                // 完整地址
  lat: number | null;
  lng: number | null;
}
```

> **v0.1 变更**：
> - 删除 `PENDING_PAYMENT` 状态（COD 模式下客户不预付）
> - 删除 `REFUNDING`、`REFUNDED` 状态（COD 模式退款是线下操作，API 无触发入口）
> - 新增 `FAILED` 状态（配送失败，如客户不在家）
> - 新增 `remark: string | null` 字段
> - `paymentMethod` 从 `'CASH' | null` 改为 `'CASH'`（不接受 null）
> - `paymentStatus` 从 `'UNPAID' | 'PAID' | 'REFUNDED'` 改为 `'UNPAID' | 'PAID'`
> - 删除 `couponId` 字段（未来加优惠券时再引入）

### 5.7 Address（地址）

```typescript
interface Address {
  id: string;
  userId: string;
  name: string;                  // 收件人姓名
  phone: string;                 // 收件人电话
  region: string;                // 区域（如 Dili, Baucau）—— 值来自 GET /common/regions
  detail: string;                // 详细地址
  lat: number | null;            // 纬度
  lng: number | null;            // 经度
  isDefault: boolean;            // 是否默认地址
  tag: string | null;            // 标签：家、公司、学校
  createdAt: string;
  updatedAt: string;
}
```

### 5.8 RiderProfile（骑手档案）

```typescript
interface RiderProfile {
  id: string;
  userId: string;
  riderName: string;
  phone: string;
  vehicleType: 'MOTORCYCLE' | 'BICYCLE' | 'CAR';
  vehiclePlate: string | null;
  status: 'OFFLINE' | 'ONLINE' | 'BUSY';
  // 位置（MVP 只存最新）
  currentLat: number | null;
  currentLng: number | null;
  lastLocationAt: string | null;
  // 统计
  totalDeliveries: number;
  rating: number;                // 评分 0-5
}
```

> v0.1 的 `maxDeliveryRadius` 字段已删除（未来加配送范围算法时再引入）。

### 5.9 DeliveryTask（配送任务）

```typescript
interface DeliveryTask {
  id: string;
  orderId: string;
  riderId: string | null;
  status: 'PENDING_ASSIGN' | 'ASSIGNED' | 'PICKED_UP' | 'DELIVERING' | 'DELIVERED' | 'FAILED';
  // 取货信息（从商家）
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  // 送达信息（消费者地址）
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  // 时间
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  // 备注
  note: string | null;
}
```

### 5.10 Store（店铺）

```typescript
interface Store {
  id: string;
  storeName: string;
  logoUrl: string | null;
  phone: string;
  address: string;
  lat: number;
  lng: number;
  status: 'ACTIVE' | 'INACTIVE';
  businessHours: string | null;  // 如 "08:00-22:00"，MVP 只有一家店，string 够用
}
```

> 未来多家店或需要结构化营业时间时，`businessHours` 改为 `BusinessHours[]` 类型并 bump 版本号。

### 5.11 Review（评价）

```typescript
interface Review {
  id: string;
  orderId: string;
  userId: string;
  userName: string;              // 脱敏：张**
  avatarUrl: string | null;
  rating: number;                // 1-5
  content: string;
  images: string[];
  createdAt: string;
}
```

---

## 六、接口清单

> 格式说明：Method + Path → 请求体 → 响应体

---

### 6.1 认证模块

#### POST `/common/auth/register` — 注册

```json
// Request
{
  "phone": "77001234",
  "password": "xxxxxx",
  "smsCode": "1234",
  "name": "三文鱼",
  "clientType": "CUSTOMER" | "RIDER" | "MERCHANT"
}

// Response 200
{
  "success": true,
  "data": {
    "user": { /* User */ },
    "rider": { /* RiderProfile, 仅 clientType=RIDER 时返回 */ },
    "store": { /* Store, 仅 clientType=MERCHANT 时返回 */ },
    "accessToken": "eyJhbGc...",
    "refreshToken": "eyJhbGc..."
  }
}
```

#### POST `/common/auth/login-password` — 密码登录

```json
// Request
{
  "phone": "77001234",
  "password": "xxxxxx",
  "clientType": "CUSTOMER" | "RIDER" | "MERCHANT"
}

// Response 200
{
  "success": true,
  "data": {
    "user": { /* User */ },
    "rider": { /* RiderProfile, 仅 clientType=RIDER 时返回 */ },
    "store": { /* Store, 仅 clientType=MERCHANT 时返回 */ },
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

> **后端校验**：`user.role` 必须与 `clientType` 匹配，不匹配返回 `403 FORBIDDEN`。

#### POST `/common/auth/login-sms` — 验证码登录

```json
// Request
{
  "phone": "77001234",
  "smsCode": "1234",
  "clientType": "CUSTOMER" | "RIDER" | "MERCHANT"
}

// Response 200
{
  "success": true,
  "data": {
    "user": { /* User */ },
    "rider": { /* RiderProfile, 仅 clientType=RIDER 时返回 */ },
    "store": { /* Store, 仅 clientType=MERCHANT 时返回 */ },
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

#### POST `/common/auth/send-sms` — 发送验证码

```json
// Request
{
  "phone": "77001234",
  "type": "REGISTER" | "LOGIN" | "RESET_PASSWORD"
}

// Response 200
{
  "success": true,
  "data": { "expireIn": 300 }  // 验证码有效期（秒）
}

// Response 429（触发限流）
{
  "success": false,
  "error": {
    "code": "SMS_RATE_LIMIT",
    "message": "短信发送过于频繁，请稍后再试",
    "details": { "retryAfter": 45 }  // 建议等待秒数
  }
}
```

> **限流规则**见 [4.3 SMS 短信限流策略](#43-sms-短信限流策略)。

#### POST `/common/auth/refresh` — 刷新 Token

```json
// Request
{ "refreshToken": "eyJhbGc..." }

// Response 200
{
  "success": true,
  "data": {
    "accessToken": "...",
    "refreshToken": "..."  // 可能返回新的 refreshToken（滑动过期）
  }
}
```

#### POST `/common/auth/reset-password` — 重置密码

```json
// Request
{ "phone": "77001234", "smsCode": "1234", "newPassword": "newxxx" }

// Response 200
{ "success": true, "data": null }
```

#### POST `/common/auth/logout` — 登出

```json
// Request: 无（Token 中提取用户）
// Response 200
{ "success": true, "data": null }
```

---

### 6.2 商品模块

#### GET `/client/products` — 商品列表（分页）

```
// Query
?cursor=xxx&limit=20&categoryId=xxx&keyword=xxx&sort=price_asc|price_desc|created_desc|sales_desc

// Response 200
{
  "success": true,
  "data": {
    "items": [ /* Product[] */ ],
    "nextCursor": "xxx" | null,
    "hasMore": true | false
  }
}
```

> sort 新增 `sales_desc`（按销量降序）。

#### GET `/client/products/:id` — 商品详情

```json
// Response 200
{
  "success": true,
  "data": {
    "product": { /* Product */ },
    "skus": [ /* ProductSku[]（每个 SKU 含 stock 字段） */ ],
    "store": { /* Store（简要信息） */ }
  }
}
```

> **stock 说明**：商品详情接口返回的 `skus[]` 中，每个 ProductSku 都包含 `stock` 字段，前端用它判断当前 SKU 是否可购买、最大可购数量。

#### GET `/client/products/search` — 搜索

```
// Query
?q=大米&cursor=xxx&limit=20

// Response: 同商品列表
```

#### GET `/client/categories` — 分类列表（树形）

```json
// Response 200
{
  "success": true,
  "data": [ /* Category[]（含子分类 children） */ ]
}
```

#### GET `/client/products/:id/reviews` — 商品评价（分页）

```json
// Response 200
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "xxx",
        "userName": "张**",
        "avatarUrl": null,
        "rating": 5,
        "content": "很好",
        "images": [],
        "createdAt": "2026-06-15T08:00:00.000Z"
      }
    ],
    "nextCursor": null,
    "hasMore": false
  }
}
```

---

### 6.3 购物车模块

#### GET `/client/cart` — 获取购物车

```json
// Response 200
{
  "success": true,
  "data": { /* Cart（含 items[]） */ }
}
```

#### POST `/client/cart/items` — 加入购物车

```json
// Request
{
  "skuId": "xxx",
  "quantity": 2
}

// Response 200
{
  "success": true,
  "data": { /* Cart（更新后的完整购物车） */ }
}
```

#### PATCH `/client/cart/items/:itemId` — 修改购物车项

```json
// Request
{
  "quantity": 3,          // 修改数量（二选一）
  "isSelected": true      // 修改勾选状态（二选一）
}

// Response 200
{
  "success": true,
  "data": { /* Cart */ }
}
```

#### DELETE `/client/cart/items/:itemId` — 删除购物车项

```json
// Response 200
{
  "success": true,
  "data": { /* Cart */ }
}
```

#### DELETE `/client/cart` — 清空购物车

```json
// Response 200
{ "success": true, "data": null }
```

---

### 6.4 订单模块

#### POST `/client/orders` — 创建订单（同步事务版 MVP）

```json
// Request
{
  "addressId": "xxx",
  "items": [
    { "skuId": "xxx", "quantity": 2 }
  ],
  "remark": "送到门口",
  "paymentMethod": "CASH"
}

// Response 200
{
  "success": true,
  "data": {
    "order": { /* Order（含 items[]，status = PENDING_CONFIRM，paymentStatus = UNPAID） */ }
  }
}

// Response 400（库存不足）
{
  "success": false,
  "error": {
    "code": "STOCK_NOT_ENOUGH",
    "message": "部分商品库存不足",
    "details": {
      "failedItems": [
        { "skuId": "xxx", "skuName": "大米 500g", "available": 1, "requested": 2 }
      ]
    }
  }
}
```

> **MVP 用同步事务**：请求发来 → 校验 → 扣库存 → 创建订单 → 返回完整订单。不走异步队列。后端代码内部用数据库事务 + `WHERE stock >= ?` 防超卖。
>
> **COD 模式**：创建订单后直接进入 `PENDING_CONFIRM`，`paymentStatus = UNPAID`。客户不需要发起支付，骑手送达收现金时由骑手端 `/rider/orders/:orderId/collect-cash` 触发 `paymentStatus → PAID`。

#### GET `/client/orders` — 订单列表（分页）

```
// Query
?cursor=xxx&limit=20&status=PENDING_CONFIRM

// status 可选值：PENDING_CONFIRM | CONFIRMED | ASSIGNED | PICKED_UP | DELIVERING | DELIVERED | COMPLETED | CANCELLED | FAILED

// Response 200
{
  "success": true,
  "data": {
    "items": [ /* Order[]（简要信息，不含 items[] 明细） */ ],
    "nextCursor": "xxx" | null,
    "hasMore": true | false
  }
}
```

#### GET `/client/orders/:id` — 订单详情

```json
// Response 200
{
  "success": true,
  "data": { /* Order（含 items[] 明细） */ }
}
```

#### POST `/client/orders/:id/cancel` — 取消订单

```json
// Request
{ "reason": "不想买了" }

// Response 200
{
  "success": true,
  "data": { /* Order（更新后） */ }
}
```

> 仅 `PENDING_CONFIRM` 和 `CONFIRMED` 状态可取消。`ASSIGNED` 之后不可取消（骑手已介入）。

#### POST `/client/orders/:id/confirm` — 确认收货

```json
// Response 200
{
  "success": true,
  "data": { /* Order（status → COMPLETED） */ }
}
```

> 仅 `DELIVERED` 状态可确认收货。

#### POST `/client/orders/:id/review` — 提交评价

```json
// Request
{
  "rating": 5,
  "content": "配送很快",
  "images": ["https://..."],
  "items": [
    { "productId": "xxx", "rating": 5 }
  ]
}

// Response 200
{ "success": true, "data": null }
```

#### GET `/client/orders/:id/review` — 查看订单评价

```json
// Response 200
{
  "success": true,
  "data": { /* Review | null（未评价返回 null） */ }
}
```

#### POST `/client/orders/:id/reorder` — 重新购买

```json
// Response 200
{
  "success": true,
  "data": {
    "addedItems": [
      { "skuId": "xxx", "productName": "大米", "quantity": 2, "added": true }
    ],
    "failedItems": [
      { "skuId": "yyy", "productName": "可乐", "reason": "SKU_NOT_FOUND" }
    ],
    "cart": { /* Cart（更新后的完整购物车） */ }
  }
}
```

> 将原订单的所有商品重新加入购物车。已下架/库存不足的商品放入 `failedItems`，不阻断其他商品加购。

#### GET `/client/orders/:id/tracking` — 配送追踪

```json
// Response 200
{
  "success": true,
  "data": {
    "orderStatus": "DELIVERING",
    "deliveryTask": { /* DeliveryTask */ },
    "rider": {
      "id": "xxx",
      "name": "Joao",
      "phone": "77xx",
      "currentLat": -8.5568,
      "currentLng": 125.5600
    },
    "timeline": [
      { "status": "PENDING_CONFIRM", "label": "订单已提交", "timestamp": "2026-06-15T08:00:00.000Z" },
      { "status": "CONFIRMED", "label": "商家已确认", "timestamp": "2026-06-15T08:05:00.000Z" },
      { "status": "PICKED_UP", "label": "骑手已取货", "timestamp": "2026-06-15T08:15:00.000Z" },
      { "status": "DELIVERING", "label": "配送中", "timestamp": "2026-06-15T08:20:00.000Z" }
    ]
  }
}
```

> **MVP 轮询策略**：客户端每 **10 秒**轮询一次（匹配骑手 10-15s 上报频率）。订单状态变为 `DELIVERED` 或 `COMPLETED` 时停止轮询。
>
> **未来升级**：MVP 使用 HTTP 轮询，后续版本升级为 WebSocket 推送（骑手位置写入 Redis，客户端 WS 订阅），接口契约不变。

---

### 6.5 地址模块

#### GET `/client/addresses` — 地址列表

```json
// Response 200
{
  "success": true,
  "data": [ /* Address[] */ ]
}
```

#### POST `/client/addresses` — 新增地址

```json
// Request
{
  "name": "三文鱼",
  "phone": "77001234",
  "region": "Dili",
  "detail": "Rua xxx, Motael",
  "lat": -8.5568,
  "lng": 125.5600,
  "isDefault": true,
  "tag": "家"
}

// Response 200
{
  "success": true,
  "data": { /* Address */ }
}
```

#### PATCH `/client/addresses/:id` — 修改地址

```json
// Request: 同新增，所有字段可选
// Response 200
{ "success": true, "data": { /* Address */ } }
```

#### DELETE `/client/addresses/:id` — 删除地址

```json
// Response 200
{ "success": true, "data": null }
```

---

### 6.6 用户模块

#### GET `/client/profile` — 获取个人信息

```json
// Response 200
{
  "success": true,
  "data": { /* User */ }
}
```

#### PATCH `/client/profile` — 修改个人信息

```json
// Request
{
  "name": "新昵称",
  "avatarUrl": "https://..."
}

// Response 200
{
  "success": true,
  "data": { /* User */ }
}
```

#### GET `/client/favorites` — 收藏列表（分页）

```json
// Response 200
{
  "success": true,
  "data": {
    "items": [
      { "productId": "xxx", "productName": "xxx", "productImage": "xxx", "priceMin": 999, "addedAt": "..." }
    ],
    "nextCursor": null,
    "hasMore": false
  }
}
```

#### POST `/client/favorites` — 添加收藏

```json
// Request
{ "productId": "xxx" }

// Response 200
{ "success": true, "data": null }
```

#### DELETE `/client/favorites/:productId` — 取消收藏

```json
// Response 200
{ "success": true, "data": null }
```

#### GET `/client/notifications` — 通知列表（分页）

```json
// Response 200
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "xxx",
        "type": "ORDER_UPDATE" | "PROMOTION" | "SYSTEM",
        "title": "订单已发货",
        "content": "您的订单 MM2026... 已由骑手取货",
        "isRead": false,
        "data": { "orderId": "xxx" },
        "createdAt": "..."
      }
    ],
    "nextCursor": null,
    "hasMore": false
  }
}
```

#### POST `/client/notifications/read-all` — 全部标记已读

```json
// Response 200
{ "success": true, "data": null }
```

---

### 6.7 骑手模块

#### GET `/rider/profile` — 骑手个人信息

```json
// Response 200
{
  "success": true,
  "data": { /* RiderProfile */ }
}
```

#### PATCH `/rider/status` — 更新骑手在线状态

```json
// Request
{ "status": "ONLINE" | "OFFLINE" }

// Response 200
{
  "success": true,
  "data": { /* RiderProfile */ }
}
```

#### POST `/rider/location` — 上报位置

```json
// Request
{
  "lat": -8.5568,
  "lng": 125.5600,
  "accuracy": 10,          // GPS 精度（米），可选
  "speed": 25,             // 速度 km/h，可选
  "battery": 80,           // 电量 %，可选
  "deliveryTaskId": "xxx"  // 当前任务 ID，可选（空闲时不带）
}

// Response 200
{ "success": true, "data": null }
```

> 频率建议：每 10-15 秒上报一次，或位置变化超过 20 米时上报。

#### GET `/rider/tasks` — 配送任务列表（分页）

```
// Query
?cursor=xxx&limit=20&status=ASSIGNED|PICKED_UP|DELIVERING|DELIVERED

// Response 200
{
  "success": true,
  "data": {
    "items": [ /* DeliveryTask[]（含订单简要信息） */ ],
    "nextCursor": null,
    "hasMore": false
  }
}
```

#### GET `/rider/tasks/:id` — 任务详情

```json
// Response 200
{
  "success": true,
  "data": {
    "task": { /* DeliveryTask */ },
    "order": { /* Order（简要信息：orderNo, items, payableAmount） */ },
    "pickupStore": { /* Store（取货店铺信息） */ }
  }
}
```

#### POST `/rider/tasks/:id/pickup` — 确认取货

```json
// Request
{ "note": "已到店取货" }  // 可选

// Response 200
{
  "success": true,
  "data": { /* DeliveryTask（状态更新为 PICKED_UP） */ }
}
```

#### POST `/rider/tasks/:id/deliver` — 确认送达

```json
// Request
{
  "note": "已送达客户手中",  // 可选
  "confirmCode": "1234"     // 送达确认码（可选，MVP 可不做）
}

// Response 200
{
  "success": true,
  "data": { /* DeliveryTask（状态更新为 DELIVERED） */ }
}
```

#### POST `/rider/tasks/:id/fail` — 配送失败

```json
// Request
{
  "reason": "客户不在家",
  "note": "电话联系不上"
}

// Response 200
{
  "success": true,
  "data": { /* DeliveryTask（状态更新为 FAILED，Order 状态也变为 FAILED） */ }
}
```

#### POST `/rider/orders/:orderId/collect-cash` — 骑手确认收到现金

```json
// Request
{ "collectedAmount": 2599 }

// Response 200
{
  "success": true,
  "data": {
    "order": { /* Order（paymentStatus 更新为 PAID, paidAt 更新） */ }
  }
}
```

> 这是 COD 模式下**唯一的资金状态流转接口**。客户不需要发起支付，骑手送达收现金后调用此接口。

---

### 6.8 支付模块

> **MVP 阶段：仅支持现金（COD，Cash on Delivery）。**
>
> 资金流转极简：
> ```
> 创建订单 → paymentStatus: UNPAID
> 骑手送达收现金 → POST /rider/orders/:orderId/collect-cash → paymentStatus: PAID
> ```
>
> 客户端无需发起任何支付接口（v0.1 的 `/client/orders/:id/pay` 已删除）。

---

### 6.9 公共模块

#### GET `/health` — 健康检查

```json
// Response 200
{
  "status": "ok",
  "timestamp": "2026-06-15T08:30:00.000Z"
}
```

> K8s liveness/readiness probe 和监控用。不需要认证，不在 `/api/v1` 前缀下。

#### GET `/common/banners` — 首页 Banner 轮播

```json
// Response 200
{
  "success": true,
  "data": [
    {
      "id": "xxx",
      "imageUrl": "https://...",
      "linkType": "PRODUCT" | "CATEGORY" | "URL" | "NONE",
      "linkValue": "/product/xxx",
      "sortOrder": 1
    }
  ]
}
```

#### GET `/common/config` — 客户端配置（功能开关等）

```json
// Response 200
{
  "success": true,
  "data": {
    "features": {
      "reviews": true
    },
    "deliveryFeeBase": 500,       // 基础配送费（分）
    "deliveryFeePerKm": 100,      // 每公里加价（分）
    "deliveryFreeThreshold": 5000, // 免配送费门槛（分），0=不免
    "minOrderAmount": 1000        // 最低下单金额（分），0=无限制
  }
}
```

> `features` 中只保留 MVP 实际使用的开关（`reviews`）。其他功能（flashSale、coupons、membership）已从契约删除。

#### GET `/common/regions` — 区域/城市列表

```json
// Response 200
{
  "success": true,
  "data": [
    { "id": "dili", "name": "Dili" },
    { "id": "baucau", "name": "Baucau" },
    { "id": "liquica", "name": "Liquiçá" }
    // 东帝汶 13 个县...
  ]
}
```

> 用于地址选择器。前端也可写死在前端，但通过接口获取便于后续扩展。

#### GET `/common/version-check` — App 版本检查

```json
// Request Query
?platform=android|ios&version=1.0.0

// Response 200
{
  "success": true,
  "data": {
    "latestVersion": "1.0.1",
    "minVersion": "1.0.0",
    "forceUpdate": false,
    "downloadUrl": "https://...",
    "updateMessage": "修复了一些已知问题"
  }
}
```

> `forceUpdate: true` 时前端强制弹窗更新，不可跳过。

#### POST `/common/upload/image` — 图片上传

```
// Request: multipart/form-data
// field: file
// 限制：max 5MB，允许格式 jpg/png/webp

// Response 200
{
  "success": true,
  "data": {
    "url": "https://cdn.meimart.xxx/xxx.jpg",
    "size": 102400,
    "mimeType": "image/jpeg"
  }
}

// Response 400（文件超限或格式不支持）
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "文件大小超过限制或格式不支持"
  }
}
```

#### POST `/common/feedback` — 提交反馈

```json
// Request
{
  "type": "BUG" | "SUGGESTION" | "COMPLAINT",
  "content": "xxx",
  "contact": "77001234",
  "images": ["https://..."]
}

// Response 200
{ "success": true, "data": null }
```

---

### 6.10 商家端模块

> ⚠️ 商家端接口**待确认是否在 MVP 范围内**（见[待确认事项](#八待确认事项)）。
> 如果在 MVP 范围内，需要补充以下接口（框架，细节待成员B补充）：

#### 商品管理

```
POST   /merchant/products              — 创建商品
GET    /merchant/products              — 商品列表（分页）
GET    /merchant/products/:id          — 商品详情
PATCH  /merchant/products/:id          — 修改商品
DELETE /merchant/products/:id          — 下架商品
POST   /merchant/products/:id/skus     — 创建 SKU
PATCH  /merchant/products/:id/skus/:skuId  — 修改 SKU（含库存调整）
```

#### 订单管理

```
GET    /merchant/orders                — 订单列表（按状态筛选）
GET    /merchant/orders/:id            — 订单详情
POST   /merchant/orders/:id/accept     — 接单（status: PENDING_CONFIRM → CONFIRMED）
POST   /merchant/orders/:id/reject     — 拒单（status: PENDING_CONFIRM → CANCELLED）
```

#### 店铺管理

```
GET    /merchant/store                 — 店铺信息
PATCH  /merchant/store                 — 修改店铺信息（营业时间、电话等）
```

> 细节待成员B补充后更新本文档。

---

## 七、决策记录（已定）

> 以下决策已在本文档中体现，无需再确认。

| # | 决策项 | 决策 | 理由 |
|---|--------|------|------|
| 1 | 响应格式 | `{ success, data, message }` | 语义清晰，前端 `.data` 取值方便 |
| 2 | 金额单位 | 整数（分） | 避免浮点精度问题 |
| 3 | 分页方式 | cursor-based | 大数据量性能好，避免 offset 深翻页 |
| 4 | 错误码风格 | 大写下划线（`STOCK_NOT_ENOUGH`） | 可读性好，grep 友好 |
| 5 | 签名校验 | MVP 不强制，上线前开启 | 降低前期开发成本 |
| 6 | 认证路径 | 统一 `/common/auth/*` + clientType | 避免三端重复逻辑 |
| 7 | COD 状态机 | 删除 PENDING_PAYMENT | COD 模式客户不预付 |
| 8 | 退款状态 | MVP 删除 REFUNDING/REFUNDED | COD 退款是线下操作 |
| 9 | 配送追踪 | MVP 用轮询（10s） | 小团队+弱网，轮询性价比最高 |
| 10 | 时区展示 | 硬编码 UTC+9 | 目标市场单一 |
| 11 | 多语言 | MVP 后端内容单语，Accept-Language 只影响 error.message | 商品数据暂不需要多语言 |
| 12 | JWT payload | 只放 sub + role，不放 phone | 安全 |

---

## 八、待确认事项

| # | 事项 | 需谁确认 | 说明 |
|---|------|---------|------|
| 1 | 商家端是否在 MVP 范围 | 负责人 | 决定 6.10 商家端接口是否需要现在开发 |
| 2 | 骑手端接口细节 | 成员B | B 需要确认骑手端特有需求 |
| 3 | 域名 | 负责人 | API 域名待定 |
| 4 | 订单号生成规则 | 负责人 | 建议 `MM + yyyyMMdd + 6位序号`（如 MM20260615000001） |
| 5 | OpenAPI Schema | 负责人 | 建议冲刺2生成 openapi.yaml，前端用 openapi-typescript 自动生成类型 |

---

## 附录：订单状态流转图（COD 模式）

```
              ┌────────────────┐
  创建订单 ──→ │ PENDING_CONFIRM │ ──→ 客户取消 → CANCELLED
              │  (待商家确认)    │ ──→ 商家拒单 → CANCELLED
              └───────┬────────┘
                      │ 商家确认
                      ↓
              ┌────────────────┐
              │   CONFIRMED    │
              │ (已确认，待分配) │
              └───────┬────────┘
                      │ 分配骑手
                      ↓
              ┌────────────────┐
              │    ASSIGNED    │
              │  (已分配骑手)   │
              └───────┬────────┘
                      │ 骑手确认取货
                      ↓
              ┌────────────────┐
              │   PICKED_UP    │
              └───────┬────────┘
                      │ 开始配送
                      ↓
              ┌────────────────┐
              │   DELIVERING   │
              └───────┬────────┘
                      │
              ┌───────┴────────┐
              │                │
     配送失败 │                │ 送达 + 骑手收现金
              ↓                ↓
      ┌───────────┐    ┌────────────────┐
      │  FAILED   │    │   DELIVERED    │
      └───────────┘    │ (paymentStatus │
                       │     → PAID)    │
                       └───────┬────────┘
                               │ 客户确认收货 / 自动(24h)
                               ↓
                       ┌───────────┐
                       │ COMPLETED │
                       └───────────┘
```

**状态流转规则：**

| 当前状态 | 可执行操作 | 目标状态 | 执行端 |
|----------|-----------|----------|--------|
| PENDING_CONFIRM | 客户取消 | CANCELLED | 客户端 |
| PENDING_CONFIRM | 商家确认 | CONFIRMED | 商家端 |
| PENDING_CONFIRM | 商家拒单 | CANCELLED | 商家端 |
| CONFIRMED | 客户取消 | CANCELLED | 客户端 |
| CONFIRMED | 分配骑手 | ASSIGNED | 后端自动/商家端 |
| ASSIGNED | 骑手确认取货 | PICKED_UP | 骑手端 |
| PICKED_UP | 骑手开始配送 | DELIVERING | 骑手端（自动） |
| DELIVERING | 骑手确认送达 | DELIVERED | 骑手端（触发 collect-cash → PAID） |
| DELIVERING | 配送失败 | FAILED | 骑手端 |
| DELIVERED | 客户确认 / 自动(24h) | COMPLETED | 客户端 / 后端定时任务 |

> **paymentStatus 独立追踪**：创建订单时 `UNPAID`，骑手调用 `collect-cash` 后变为 `PAID`。与 OrderStatus 并行，不互相绑定。

---

> **本文档是活文档，随开发迭代更新。每次接口变更必须更新版本号并通知所有端。**
>
> 当前版本：v0.2（2026-06-15）— 审核后修订版
