# Admin Dispatch 看板 Spec（批次 4）

> 清单：`admin-web功能补全-执行清单-20260808.md` §四 批次 4
> 范围：后端 `admin-dispatch.controller.ts`（6 端点）+ 前端 `/dispatch` 页面
> 决策（2026-08-10 AskUserQuestion）：reassign/cancel **不写 OrderEvent**（不改订单状态），靠 `@Audit` AuditLog + `DeliveryTask.note` 留痕

---

## 一、用户故事

- **平台 admin** 想看配送任务全局（监控异常、查骑手负荷、追卡单）
- **admin 改派任务**：骑手辞职 / 联系不上 / 任务卡 ASSIGNED 太久，把任务转给别的骑手
- **admin 取消任务**：虚假订单 / 重复单 / 任务创建错，作废配送任务
- **admin 补建任务**：任务创建失败 / 误删，给已有订单补一个 DeliveryTask
- **admin 查可派骑手**：改派时知道选谁（APPROVED + 在线优先）

## 二、功能边界

**做**：
- 全任务监控列表（filter: status / warehouseId / riderId / orderNo，游标分页）
- 任务详情（含 order + rider）
- 改派（第一期 **只支持 ASSIGNED**，PICKED_UP 后改派需先 cancel 再 recreate → 第二期）
- 取消（status ∈ {PENDING_ASSIGN, ASSIGNED}，已取货/配送中不能 cancel，需走 reportIssue）
- 补建（复用 `createTaskForOrder`，幂等：已有 task 直接返回）
- 可派骑手列表（RiderProfile.applicationStatus='APPROVED' + Redis isOnline 标记）

**不做**：
- 不写 OrderEvent（reassign/cancel 不改订单状态，靠 AuditLog + note 留痕）
- 不自动重派（cancel 后 order.riderId=null，等 admin recreate 或骑手抢）
- 不动订单状态机（cancel dispatch task ≠ 取消订单；订单取消走 admin-order cancel）
- 第二期才支持 PICKED_UP/DELIVERING 状态的改派

## 三、关键约束

1. **事务双写陷阱**（reassign / cancel）：`delivery_tasks` + `orders.riderId` 同事务，复用 `acceptTask` 乐观锁模式（`$executeRaw UPDATE WHERE status=` + `tx.order.update riderId`）
2. **RBAC**：读（list/detail/recreate/available）SUPER_ADMIN + CUSTOMER_SERVICE；写（reassign/cancel）**仅 SUPER_ADMIN**（对齐 payment/refund 写收紧模式）
3. **审计留痕**：`@Audit({ resource: 'DeliveryTask' })` 写 AuditLog（admin 操作留痕）+ `DeliveryTask.note` 记细节（改派 from→to / 取消原因）
4. **乐观锁**：reassign `WHERE status='ASSIGNED'`，cancel `WHERE status IN ('PENDING_ASSIGN','ASSIGNED')`，updated=0 视并发冲突
5. **resolveRiderProfileId 不适用**：admin 从 available riders 列表选骑手，传的就是 RiderProfile.id（非 User.id），直接用

## 四、端点（6 个，`/api/v1/admin/dispatch`）

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/tasks` | SUPER_ADMIN + CUSTOMER_SERVICE | 列表（游标 + filter） |
| GET | `/tasks/:id` | SUPER_ADMIN + CUSTOMER_SERVICE | 详情（含 order + rider） |
| POST | `/tasks/:id/reassign` | **SUPER_ADMIN** | 改派（事务双写，ASSIGNED only） |
| POST | `/tasks/:id/cancel` | **SUPER_ADMIN** | 取消（事务双写，PENDING_ASSIGN/ASSIGNED） |
| GET | `/riders/available` | SUPER_ADMIN + CUSTOMER_SERVICE | 可派骑手（APPROVED + isOnline） |

> 注：`recreate` 端点走 `/api/v1/admin/orders/:orderId/dispatch/recreate`（挂在 admin-order 域，因为按 orderId 补建）—— 复用 `createTaskForOrder`，super_admin only。

### reassign 事务编排（核心）

```ts
// 事务外先查 task（status 校验 + orderId 取）
const taskBefore = await db.deliveryTask.findUnique({ where: { id: taskId }, select: { orderId, status, riderId } });
if (!taskBefore) throw E-DISPATCH-001;
if (taskBefore.status !== 'ASSIGNED') throw E-DISPATCH-006;  // 第一期只 ASSIGNED

// 校验新骑手（APPROVED）
const newRider = await db.riderProfile.findUnique({ where: { id: newRiderId } });
if (!newRider || newRider.applicationStatus !== 'APPROVED') throw E-DISPATCH-008;

// 事务：乐观锁 UPDATE delivery_tasks + order.riderId
const result = await withTransaction(async (tx) => {
  const updated = await tx.$executeRaw`
    UPDATE "delivery_tasks"
    SET rider_id = ${newRiderId}, assigned_at = ${now}, updated_at = ${now},
        note = ${noteText}  -- "[reassign] {oldRiderId} → {newRiderId} by {adminId}"
    WHERE id = ${taskId} AND status = 'ASSIGNED'`;
  if (updated === 0) return { ok: false };
  await tx.order.update({ where: { id: taskBefore.orderId }, data: { riderId: newRiderId } });
  return { ok: true };
});
if (!result.ok) throw E-DISPATCH-006;  // 并发：刚查 ASSIGNED 但 UPDATE 时已变
```

### cancel 事务编排

```ts
if (!['PENDING_ASSIGN', 'ASSIGNED'].includes(taskBefore.status)) throw E-DISPATCH-007;
const result = await withTransaction(async (tx) => {
  const updated = await tx.$executeRaw`
    UPDATE "delivery_tasks"
    SET status = 'FAILED', rider_id = NULL, updated_at = ${now}, note = ${noteText}
    WHERE id = ${taskId} AND status IN ('PENDING_ASSIGN', 'ASSIGNED')`;
  if (updated === 0) return { ok: false };
  await tx.order.update({ where: { id: taskBefore.orderId }, data: { riderId: null } });
  return { ok: true };
});
```

## 五、错误码（E-DISPATCH）

- E-DISPATCH-001 Task not found（已有）
- E-DISPATCH-002 抢单冲突（已有）
- E-DISPATCH-003/004 状态不允许操作（已有，reportIssue/pickup/deliver 用）
- **E-DISPATCH-006 Reassign requires ASSIGNED status**（新，第一期只 ASSIGNED）
- **E-DISPATCH-007 Cancel requires PENDING_ASSIGN or ASSIGNED status**（新）
- **E-DISPATCH-008 New rider invalid (not found or not APPROVED)**（新）

## 六、contract 新增 schema（`packages/api-contract/src/schemas/dispatch.ts`）

- `ListAllTasksQuery`（status/warehouseId/riderId/orderNo/cursor/limit）
- `ReassignTaskRequest`（newRiderId uuid + reason optional）
- `CancelTaskRequest`（reason optional）
- `AdminDeliveryTaskView`（含 order + rider 关联，admin 视角）
- `AvailableRider`（id/riderName/phone/vehicleType/isOnline/totalDeliveries/rating）

## 七、前端 `/dispatch` 页面

- 任务监控列表（status Tabs × warehouse Select × rider Input × orderNo Input + 游标加载更多）
- 详情 Dialog（task 字段 + order + rider）
- 改派 Dialog（选新骑手 + 原因 Input）—— 只 ASSIGNED 状态行显示
- 取消 Dialog（原因 Input）—— PENDING_ASSIGN/ASSIGNED 行显示
- 可派骑手列表（改派 Dialog 内嵌或独立 Tab，APPROVED + isOnline 标记）
