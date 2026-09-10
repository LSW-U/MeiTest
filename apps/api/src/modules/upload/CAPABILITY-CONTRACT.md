# Upload 模块能力契约文档（M4）

> 批C 修复轮版（2026-09-10）。§1 曾在 transcript 重建中失真（虚构了不存在的 `/uploads/image` 通用端点），已按 controller 实际路由逐行核实重写；§2-§5 语义保留。
> 本文是 upload 模块对三端消费方（admin-web / client-app / rider-app）的能力契约：端点、引用与删除语义、排序语义、孤儿清理策略、消费方约束。---

## 1. 上传端点矩阵（真实 9 端点，批C 修复轮按 controller 逐行核实 2026-09-10）

| 端点 | 鉴权 | 场景 / key 前缀 | 服务端校验 |
|---|---|---|---|
| `POST /api/v1/admin/uploads/product-image` | SUPER_ADMIN / WAREHOUSE_STAFF | 商品主图/图集，`products/main-*` | magic bytes + 1:1 正方形 + 200–2000px |
| `POST /api/v1/admin/uploads/banner-image` | SUPER_ADMIN / WAREHOUSE_STAFF | Banner 图，`banners/banner-*` | magic bytes + 宽 600–2000px + 比例 1.5:1–3:1 |
| `POST /api/v1/client/uploads/refund-evidence` | CUSTOMER | 售后凭证（Refund.photos），`refunds/evidence-*` | magic bytes + 尺寸 |
| `POST /api/v1/client/uploads/review-image` | CUSTOMER | 评价图（Review.images），`reviews/image-*` | magic bytes + 尺寸 |
| `POST /api/v1/client/uploads/feedback-image` | CUSTOMER | 反馈图（Feedback.images），`feedbacks/image-*` | magic bytes + 尺寸 |
| `POST /api/v1/client/uploads/avatar` | CUSTOMER | 用户头像，`avatars/avatar-*` | magic bytes + 1:1 正方形 + 最小边长 |
| `POST /api/v1/common/rider/uploads/avatar` | CUSTOMER + RIDER（common 前缀，DeviceTypeGuard 放行） | 骑手头像，`riders/avatar-*` | magic bytes + 1:1 正方形 + 最小边长 |
| `POST /api/v1/common/rider/uploads/id-card-image` | CUSTOMER + RIDER | 骑手身份证照，`riders/idcard-*` | magic bytes + 文档最小尺寸 |
| `POST /api/v1/common/rider/uploads/license-image` | CUSTOMER + RIDER | 骑手驾照照，`riders/license-*` | magic bytes + 文档最小尺寸 |

- 响应统一 `{ success: true, data: { url, key, size } }`。
- **消费方路径**：admin-web 以 `src/lib/upload-scenes.ts` 场景注册表（`UPLOAD_SCENES`）为唯一入口，禁止散点拼 URL。
- 错误码段：`E-UPLOAD-001/002 + 010~022`（错误码表见 `packages/shared-types`，前端查 i18n key 显示；fileFilter 拒 mime 用 `E-UPLOAD-010` 结构化 `{ code, message, details }`）。

## 2. 引用与删除语义

- 上传接口**只写 MinIO 不写 DB**；引用关系由各业务表在创建/更新时落库。
- 因此「先上传后引用」存在时间窗口：上传成功但业务保存失败 → 对象暂时无引用。
- 删除语义：**业务删除记录不删除 MinIO 对象**（软语义），对象由孤儿清理任务统一回收（§4）。
- 换头像/换主图产生旧对象：仅被历史快照（orderItem/cartItem.productImage、review.avatarUrl）引用 → 永不清理（U10 已知代价，快照计入引用集合）。

## 3. 排序语义

- `images[]` 数组顺序即展示顺序（首图优先）。
- `mainImage` 独立字段：与 `images[0]` 一致为约定；banner/category 历史借道 `products/main-*` key。

## 4. 孤儿清理策略（批C U4/U4P）

- **引用集合**：`ORPHAN_REFERENCE_SOURCES` 恰 13 张表（product / sku / banner / category / shop / user / riderProfile / review / feedback / refund / orderItem / cartItem / paymentIntent），单次 `Promise.all` 全表扫描图片字段。
  - ⚠️ Refund 字段是 **photos** 非 images。
  - 快照 3 字段（orderItem.productImage / cartItem.productImage / review.avatarUrl）计入。
  - banner/category 借道 `products/main-*` key 同样计入保护。
- **宽限期**：`lastModified >= now - 7d` 的无引用对象不删（防「先传后引用」窗口误删）。
- **DRY-RUN 默认**：定时任务注册时读 env `ORPHAN_CLEANUP_EXECUTE === 'true'` 决定 execute；processor 侧 `job.data?.execute ?? false` 双保险；execute=false 只统计记日志 `ORPHAN_CLEANUP_DRY_RUN`，execute=true 才 `deleteObjects` 并记 `ORPHAN_CLEANUP_EXECUTED`。
- **调度**：BullMQ repeatable job，每日 04:17 Asia/Dili（非整点错峰），onModuleInit 幂等注册（repeat.key 去重，禁同指定 jobId），concurrency 1。
- **URL→key 容错**：非本 bucket 前缀 / 畸形 % 编码 URL 返 null 跳过，不误删不中断。
- **部分失败**：MinIO removeObjects 错误数组感知（`e?.Error?.Key`），部分失败抛 StorageError → BullMQ 重试（attempts 3 / exponential 60s）。

## 5. 消费方约束

1. **1:1 强制场景**：商品 mainImage 必须 1:1 正方形（600x600 推荐，200-2000px 范围），非 1:1 服务端直接 400（见 CLAUDE.md §10 商品导入约束）。
2. **admin-web 等价层预校验**：调用前先过 `precheckUploadImage / precheckUploadFile`（`src/lib/upload-errors.ts`），web 侧 File 无宽高元数据时跳过尺寸预校验直传（后端兜底）；`PrecheckError` 分流不进重试链。
3. **client-app / rider-app**：元数据取不到同样跳过尺寸预校验直传，后端兜底。
4. **新增图片字段必须同步** `ORPHAN_REFERENCE_SOURCES` 清单 + `collectReferencedKeys` 字段映射 + 单测，漏扫即误删在线图。
5. **错误分流**：`PrecheckError`（本地校验失败，重试无意义）与网络错误（可重试）分开处理；错误码经 i18n key 展示，禁硬编码文案。
