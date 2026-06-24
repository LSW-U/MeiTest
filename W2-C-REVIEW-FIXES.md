# C 流程审查修复指令

审查报告已出（MeiMart-W2-C-流程C审查报告-20260624.md），有 7 个 P1 问题需要在进 W3 之前修复。请逐项处理。

## 整合前必须完成（2 项）

### P1-1 删除 (warehouse) 路由组文件

文件：apps/admin-web/src/app/(warehouse)/orders/page.tsx

原因：W2-COLLABORATION.md 第 2.1 节将 (warehouse)/** 划归 W 流程独占，你创建了这个文件属于文件边界违规，整合时会与 W 流程冲突。

要求：删除此文件。如需仓库拣货页面，改到 (merchant) 路由组下（如 (merchant)/warehouse-picking/）。

### P1-2 确认 shared/db/transaction.ts 未被改动

原因：你改了 W1 文件 shared/db/index.ts（新增 releaseStock + StockChangeContext export），manifest 已报备。需要确认 transaction.ts 里 releaseStock 函数是 W1 就有的，不是你新增的。

要求：跑 git diff w1-complete..HEAD -- apps/api/src/shared/db/transaction.ts，确认 transaction.ts 本身没被改过。如果 transaction.ts 也有改动，说明你改了 W1 业务逻辑，需要回退。

## W3 启动前必须完成（5 项）

### P1-3 补单测

至少补这三个文件：

1. order-status.machine.ts — 纯函数，测 canTransition / assertCanTransition / getInitialState / isUserCancellable 全部状态流转
2. order-no.service.ts — mock Redis，测 nextOrderNo 格式 + 序号溢出 + TTL 设置
3. payment.service.ts mockCallback — 测 prod 守卫 + method 校验 + 幂等 + 状态流转

CLAUDE.md 要求关键逻辑覆盖率 70% 以上，支付必须有 e2e。

### P1-4 跑 ESLint

至少对新增文件跑一次。

### P1-5 删除 admin-web void 代码异味

位置：apps/admin-web/src/app/(merchant)/orders/page.tsx 第 76-78 行

代码：
```
useEffect(() => {
  void apiFetch;
  void setOrders;
  void filter;
}, [filter]);
```

要求：删除整个空 useEffect，它什么都不做。

### P1-6 删除 order.controller.ts void _idempotencyKey

位置：order.controller.ts 第 95 行，void _idempotencyKey; // TODO: W3

要求：要么接入 IdempotencyKey 逻辑（W3 做），要么暂时不声明这个参数。当前 void 写法是代码异味。

### P1-7 cart/payment controller 改用 contract schema

位置：
- cart.controller.ts 第 26-36 行本地定义了 AddItemRequest / UpdateItemRequest / CheckoutPreviewRequest
- payment.controller.ts 第 22-24 行本地定义了 UploadReceiptRequest

问题：contract 里已经有这些 schema（AddCartItemRequest / UpdateCartItemRequest / CheckoutPreviewRequest / UploadReceiptRequest），你本地重新定义了，违反单一数据源。

要求：从 @meimart/api-contract 导入对应 schema，删除本地定义。参照 order.controller.ts 的写法（它正确地从 contract 导入了 CreateOrderRequest / CancelOrderRequest）。

## W3 交付前必须完成（4 项）

1. admin-web api.ts TOKEN_KEY 值看起来被截断了，确认是否正确
2. admin-web 页面改用 i18n key + shadcn/ui，不用内联样式 + 硬编码英文
3. payment.controller mockCallback/confirmPaid 加 if (!user) throw 校验，与其他 controller 一致
4. 修复 tsconfig ignoreDeprecations（W1 遗留）

## 执行要求

P1-1 到 P1-7 在进 W3 之前逐项修复，每修一个 commit 一次，commit message 格式：[W2-C-fix-P1-{n}] 简述。修完报告。
