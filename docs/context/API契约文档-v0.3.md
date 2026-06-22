# MeiMart API 契约文档 v0.3 — 决策变更汇总

> **本文件是 v0.2 → v0.3 的增量变更清单**,不重复 v0.2 全文。
> 阅读顺序:**先读 `API契约文档-v0.2.md`,再读本文件**。冲突处以本文件为准。
>
> 决策日期:2026-06-19
> 决策人:linsuwei
> 评审方式:7 个歧义点(A-G)逐项拍板 + 11 个硬冲突强制修正

---

## 📋 决策汇总表(7 个歧义点)

| # | 决策项 | 最终方案 |
|---|---|---|
| **A** | 订单号格式 | `MM + yyyyMMdd + warehouseId(2位) + 序号(4位)` = 16 位,例:`MM2026061901000234` |
| **B** | 多语言字段存储 | 动态 `Record<string, string>` JSON,例:`{ "en": "Milk", "zh": "牛奶", "id": "Susu", "pt": "Leite" }` |
| **C** | clientType 字段 | **删除**,只留 JWT 内 `role` + `deviceType` |
| **D** | 支付枚举 | 全预留 5 枚举:`COD / BANK_TRANSFER / WECHAT / PAYPAL / STRIPE` |
| **E** | Token 有效期 | 分端:客户端 access 30d / 骑手 12h / 后台 2h;refresh 统一 60d |
| **F** | logout 接口 | 必传 `refreshToken`,服务端加 Redis 黑名单立即失效 |
| **G** | 配送追踪 | Socket.IO WS 实时推送 + HTTP 轮询兜底(双轨) |

---

## 🔧 SMS 接入决策(2026-06-19)

**反转 v0.2 的"完全不接 SMS"决策**,改为:

| 维度 | 决策 |
|---|---|
| 测试阶段(MVP) | **stub**:固定验证码 `123456`,日志标注 `[SMS_STUB]`,接口预留 |
| 真实接入时机 | **W6-W7**,等公司主体落定后启动 |
| 服务商倾向 | **东帝汶本地 C 路线**:Timor Telecom / Telkomcel(便宜,本地号段支持好) |
| 国际备选 | Twilio / Vonage(贵,~$0.5/条,作为兜底) |
| OTP 优先级 | **密码登录(主)+ SMS 验证码(手机验证)+ 邮箱验证码(找回密码)** |

`OtpStrategy` 抽象层 4 策略:
1. `PasswordStrategy`(主登录)— 真实
2. `SmsStrategy`(手机验证)— 测试 stub,W6 接本地服务商
3. `EmailStrategy`(找回密码)— MailHog dev / SendGrid prod
4. `WhatsAppStrategy`(预留)— W6 拿到主体后申请 Business API

---

## 🚨 11 个硬冲突修正(v0.2 → v0.3 必改)

### 冲突 1:i18n 多语言字段

**v0.2 错误**:Product / Category / Store / Banner 等表用单语言 `name: String`。
**v0.3 修正**:

```prisma
// 所有需要多语言的字段统一改用 JSON
model Product {
  name        Json      // Record<string, string>,例 {"en":"Milk","zh":"牛奶"}
  description Json      // 同上,可为空 {}
  // ...
}
```

支持语言:`en / id / zh / pt`,Tetum 留 key 但翻译值空字符串。

### 冲突 2:JWT payload 字段

**v0.2 错误**:`{ sub, role }` 只有 2 个字段,没有 deviceType,登录请求体却要求 `clientType`。
**v0.3 修正**:

```typescript
// JWT payload(删 clientType,加 deviceType)
interface JwtPayload {
  sub: string;         // userId
  role: 'super_admin' | 'customer' | 'rider' | 'warehouse_staff' | 'customer_service';
  deviceType: 'client_app' | 'rider_app' | 'admin_web';
  iat: number;
  exp: number;
  jti: string;         // 用于 logout 黑名单
}

// 登录请求体(删 clientType,deviceType 由前端 App 配置写死)
interface LoginRequest {
  identifier: string;   // 手机号 or 邮箱
  password: string;
  // 不要 clientType
}
```

### 冲突 3:SMS OTP 端点

**v0.2 错误**:有 `POST /auth/send-sms`、错误码 `SMS_CODE_INVALID` / `SMS_RATE_LIMIT`,但又说"完全不接 SMS"。
**v0.3 修正**:

- 保留端点 `POST /auth/send-sms`(stub 实现,固定返回 123456)
- 保留错误码 `E-AUTH-SMS-CODE-INVALID` / `E-AUTH-SMS-RATE-LIMIT`
- W6 切真实服务商时只换 `SmsStrategy` 内部实现,接口不变

### 冲突 4:支付方式枚举

**v0.2 错误**:`paymentMethod: 'CASH'` 单一枚举。
**v0.3 修正**:

```typescript
type PaymentMethod = 'COD' | 'BANK_TRANSFER' | 'WECHAT' | 'PAYPAL' | 'STRIPE';

// 5 个 PaymentStrategy 实现
interface PaymentStrategy {
  createPayment(orderId: string, amount: number): Promise<PaymentIntent>;
  queryPayment(transactionId: string): Promise<PaymentStatus>;
  refund(transactionId: string, amount: number): Promise<RefundResult>;
}

// 测试阶段实现程度
// COD          → 真实流程(骑手送达收款)
// BANK_TRANSFER→ 真实流程(凭证上传 + 人工对账)
// WECHAT       → mock(返回 success + MOCK_transactionId)
// PAYPAL       → stub(返回 mock URL)
// STRIPE       → stub(返回 mock client_secret)
```

### 冲突 5:多仓库模型

**v0.2 错误**:无 Warehouse 模型,ProductSku 直接挂 stock。
**v0.3 修正**:

```prisma
model Warehouse {
  id              String   @id @default(uuid())
  code            String   @unique          // 例 W01-W10
  name            Json                       // 多语言
  // PostGIS:覆盖区域多边形
  coverageArea    Unsupported("geometry")?
  centerLat       Decimal?
  centerLng       Decimal?
  address         String
  operatingHours  Json                       // { "mon": {"open":"08:00","close":"22:00"}, ... }
  deliveryFee     Decimal  @default(0)
  isActive        Boolean  @default(true)
  // GIST 索引走 raw SQL:migrate dev --create-only + 手改
}
```

### 冲突 6:库存模型

**v0.2 错误**:`ProductSku.stock: Int` 单字段。
**v0.3 修正**:

```prisma
model Stock {
  id          String   @id @default(uuid())
  warehouseId String
  productId   String
  skuId       String
  quantity    Int      @default(0)
  // 行锁防超卖:SELECT ... WHERE warehouse_id=? AND sku_id=? AND quantity>=? FOR UPDATE
  
  @@unique([warehouseId, skuId])
  @@index([warehouseId, productId])
}

model StockLog {
  id          String   @id @default(uuid())
  warehouseId String
  skuId       String
  changeType  String   // INBOUND / OUTBOUND / ADJUST / RETURN
  changeQty   Int      // 正负
  beforeQty   Int
  afterQty    Int
  reason      String?
  operatorId  String?
  createdAt   DateTime @default(now())
}
```

### 冲突 7:角色 vs 视角

**v0.2 错误**:`role: 'platform_admin' | 'merchant' | 'warehouse_staff' | 'customer_service' | 'rider_manager'` 5 个角色。
**v0.3 修正**:

- **role** 简化为 5 个真实角色:`super_admin` / `customer` / `rider` / `warehouse_staff` / `customer_service`
- **视角切换**:`super_admin` 同一 JWT,前端 zustand 持久化 `perspective`,5 个值:`platform / merchant / warehouse / support / rider-mgmt`
- 后端 RBAC **不感知** perspective,只看 role
- `X-Perspective` header 由前端 fetch interceptor 注入,**仅用于审计日志**

```typescript
// AuditLog 加 perspective 字段
model AuditLog {
  // ...原有字段
  perspective  String?  // platform / merchant / warehouse / support / rider-mgmt
  deviceType   String?  // client_app / rider_app / admin_web
}
```

### 冲突 8:配送追踪

**v0.2 错误**:仅 HTTP 轮询 `GET /orders/:id/tracking`。
**v0.3 修正**:**双轨**

- **WebSocket**(Socket.IO):骑手 App 每 5s 推送位置 → 服务端 → 客户端 App 实时显示
- **HTTP 轮询兜底**:`GET /orders/:id/tracking` 间隔 30s,WS 断线时降级
- 客户端 App 启动时同时开 WS + 定时器,WS 收到消息就重置定时器

### 冲突 9:骑手位置历史

**v0.2 错误**:仅 `RiderLocation` 当前位置一张表。
**v0.3 修正**:加 `RiderLocationHistory` 表,用于轨迹回放和纠纷仲裁

```prisma
model RiderLocation {
  // 当前位置(高频更新,UPSERT)
  riderId    String  @id
  lat        Decimal
  lng        Decimal
  heading    Decimal?
  speed      Decimal?
  updatedAt  DateTime @default(now())
}

model RiderLocationHistory {
  // 历史轨迹(每个订单一份,完成时归档)
  id          String   @id @default(uuid())
  riderId     String
  orderId     String
  lat         Decimal
  lng         Decimal
  recordedAt  DateTime
  // 索引:(orderId, recordedAt)
}
```

### 冲突 10:订单状态机

**v0.2 错误**:COD-only,起始状态 `PENDING_CONFIRM`。
**v0.3 修正**:支持预付(WECHAT/PAYPAL/STRIPE),起始状态分流

```
CART
  ↓ (COD 选 COD)
  ↓ (BANK 选 BANK_TRANSFER)
  ↓ (WECHAT/PAYPAL/STRIPE 选预付)
PENDING_PAYMENT            ← 预付起点(WECHAT/PAYPAL/STRIPE)
  ↓ (支付成功 → 自动进 CONFIRMED)
  ↓ (支付超时/失败 → CANCELLED)
PENDING_CONFIRM            ← COD/BANK 起点
  ↓ (admin/merchant 点"接单")
CONFIRMED
  ↓ (warehouse 拣货)
PICKED
  ↓ (rider 取货)
OUT_FOR_DELIVERY
  ↓ (COD 客户付现)               ↓ (预付客户已付)
DELIVERED_PAID              DELIVERED
  ↓
COMPLETED

// 异常分支
任意状态 → CANCELLED(用户/admin 主动)
OUT_FOR_DELIVERY → DELIVERED_UNPAID(COD 拒付)→ 人工跟进
```

### 冲突 11:register 接口

**v0.2 错误**:`POST /auth/register` 要求 `smsCode` 字段,但又说完全不接 SMS。
**v0.3 修正**:

```typescript
// v0.3:register 改为密码注册 + 可选 SMS 验证(手机号已验证才能下单)
interface RegisterRequest {
  phone: string;          // +670XXXXXXXX
  email: string;
  password: string;       // ≥8位 + 字母+数字
  // smsCode?: string;    // 可选,W6 接真实 SMS 后强制
}
// 注册成功后 → 默认未验证手机 → 引导用户调 /auth/send-sms 验证
// 测试阶段 SmsStrategy stub:任意 code 都通过(标 [SMS_STUB])
```

---

## 📊 表清单变更(v0.2 → v0.3)

W1 基线表从 14 张调整为 16 张(新增 2 张,合并/重命名若干):

| # | 表名 | 状态 | 备注 |
|---|---|---|---|
| 1 | User | 改 | 字段不变 |
| 2 | UserRole | 改 | role 简化为 5 个 |
| 3 | Shop | 不变 | 单一商家 1 条预置 |
| 4 | **Warehouse** | 新增 | 含 PostGIS coverageArea |
| 5 | Product | 改 | name/description 改 JSON |
| 6 | Sku | 不变 | |
| 7 | **Stock** | 新增 | warehouseId + skuId 复合唯一 |
| 8 | **StockLog** | 不变 | 库存流水 |
| 9 | Order | 改 | 加 warehouseId,orderNo 16 位 |
| 10 | OrderItem | 不变 | |
| 11 | OrderEvent | 不变 | 状态机事件 |
| 12 | AuditLog | 改 | 加 perspective + deviceType |
| 13 | PaymentIntent | 改 | method 5 枚举 |
| 14 | IdempotencyKey | 不变 | |
| 15 | **RiderLocation** | 不变 | 当前位置 |
| 16 | **RiderLocationHistory** | 新增 | 历史轨迹 |

---

## 🔄 视角切换设计(详细)

### 前端(zustand 持久化)

```typescript
// stores/perspective.ts
interface PerspectiveState {
  current: 'platform' | 'merchant' | 'warehouse' | 'support' | 'rider-mgmt';
  setPerspective: (p: Perspective) => void;
}

// 顶部下拉切换时:
// 1. 持久化 perspective 到 localStorage
// 2. reset 业务 state(避免脏数据)
// 3. 路由跳到该视角首页
```

### 前端 fetch interceptor

```typescript
// lib/fetch.ts
fetcher.interceptors.request.use((config) => {
  config.headers['X-Perspective'] = store.perspective.current;
  config.headers['Accept-Language'] = i18n.language;
  config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});
```

### 后端审计拦截器

```typescript
// audit.interceptor.ts
@Injectable()
class AuditInterceptor {
  async intercept(context, next) {
    const req = context.switchToHttp().getRequest();
    const user = req.user;  // JWT 解出
    const perspective = req.headers['x-perspective'];
    const deviceType = user?.deviceType;
    
    const result = await next.handle();
    
    // 异步写 AuditLog(before/after/perspective/deviceType)
    return result;
  }
}
```

---

## 🛠️ Token 策略(详细)

```typescript
// config/auth.ts
export const TOKEN_TTL = {
  client_app: { access: '30d',  refresh: '60d' },
  rider_app:  { access: '12h',  refresh: '60d' },
  admin_web:  { access: '2h',   refresh: '60d' },
} as const;

// 登录时按 deviceType 选 TTL
async login(identifier, password, deviceType) {
  const user = await verifyCredentials(identifier, password);
  const ttl = TOKEN_TTL[deviceType];
  const access = jwt.sign({ sub: user.id, role: user.role, deviceType }, ACCESS_SECRET, { expiresIn: ttl.access });
  const refresh = jwt.sign({ sub: user.id, jti: uuid() }, REFRESH_SECRET, { expiresIn: ttl.refresh });
  // refresh jti 写 Redis 白名单
  return { access, refresh, user };
}

// logout 立即失效 refresh
async logout(refreshToken) {
  const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
  await redis.del(`refresh:${decoded.jti}`);
  await redis.set(`blacklist:${decoded.jti}`, 1, 'EX', decoded.exp - now);
  // accessToken 仍有效到自然过期(≤30d)
}
```

---

## 📝 orderNo 生成器(详细)

```typescript
// utils/order-no.ts
async function generateOrderNo(warehouseId: string): Promise<string> {
  const date = dayjs().format('YYYYMMDD');
  const whCode = await getWarehouseCode(warehouseId);  // 'W01' → 取后 2 位 '01'
  const seqKey = `order:seq:${date}:${whCode}`;
  const seq = await redis.incr(seqKey);
  await redis.expire(seqKey, 86400 * 2);  // 2 天过期
  const seqStr = String(seq).padStart(4, '0');  // 0001-9999
  return `MM${date}${whCode}${seqStr}`;  // 16 位
}

// 单仓单日上限 9999 单(MVP 远超需求)
// 跨日自动重置(redis key 带日期)
```

---

## 🔒 多语言字段查询(详细)

```typescript
// 查询时按 Accept-Language 取值
async function getProduct(id: string, lang: string) {
  const p = await prisma.product.findUnique({ where: { id } });
  return {
    ...p,
    name: p.name[lang] ?? p.name['en'] ?? '',  // fallback 链
    description: p.description[lang] ?? p.description['en'] ?? '',
  };
}

// 管理后台一次返回所有语言
async function getProductAdmin(id: string) {
  return await prisma.product.findUnique({ where: { id } });
  // 前端按 lang key 切换显示
}
```

---

## ⚠️ v0.3 未决项(W6 决断)

1. **SMS 服务商最终选择**(本地 C vs 国际)
2. **微信支付真实商户号**(挂靠国内个体户 vs 永久 mock)
3. **PayPal Business / Stripe Atlas 主体**
4. **法律主体**(国内个体户 / 东帝汶合伙 / Stripe Atlas)
5. **正式域名**(W7 上线前定)

---

## 📚 阅读顺序(给新 Claude Code)

1. `MeiMart-CLAUDE-20260618.md` — 项目根指令
2. `API契约文档-v0.2.md` — 基础契约(读全)
3. **本文件 `API契约文档-v0.3.md`** — 变更覆盖(冲突处以此为准)
4. `MeiMart-W1共享前置层-AI执行版-20260617.md` — 任务清单
5. `MeiMart-东帝汶本地化调研清单-20260617.md` — 本地化背景
