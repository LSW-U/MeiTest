# Admin Inventory 批量/调拨 Spec（批次 5）

> 清单：`admin-web功能补全-执行清单-20260808.md` §四 批次 5
> 范围：后端 `inventory.controller` 追加 5 端点 + service 扩展 + 前端 `/inventory` 扩展
> 决策（2026-08-10 AskUserQuestion）：transfer 目标仓 stock 不存在**创建**（A）；**完整做** CSV 导入导出（A）
> TDD 强制：库存是 CLAUDE.md §4 TDD 强制模块，transfer 双仓原子必须先写测试

---

## 一、用户故事

- **admin 批量调整库存**：从 Excel/CSV 导入，避免一条条点（盘点后批量修正）
- **admin 仓库间调拨**：A 仓调到 B 仓（补货/调货）
- **admin 导出库存快照**：CSV 下载，对账/盘点用
- **admin 查调拨记录**：追溯历史调拨（谁/何时/从哪到哪/多少）

## 二、功能边界

**做**：
- `batch-adjust`（事务内循环 `adjustStockTx`，上限 100，**全事务**：一条失败全部回滚）
- `transfer`（**双仓原子**：源 deductStock + 目标 create/update，`referenceType='TRANSFER'` + `referenceId=uuid` 串联两条 StockLog）
- `transfers list`（查 StockLog `referenceType='TRANSFER'`，按 referenceId 聚合）
- CSV 导出（GET，`text/csv`，参考 `audit.controller.ts:43-49`）
- CSV 导入（POST multipart，multer `FileInterceptor` + 逐行解析 + `failedRows` 部分成功）
- **修 listStocks bug**（L99 `quantity < 10` 硬编码 → `quantity <= safetyStock`，用 Stock.safetyStock 字段）

**不做**：
- 不加 `StockChangeType.TRANSFER` enum（用现有 INBOUND/OUTBOUND + `referenceType='TRANSFER'` 区分，**零 migration**）
- 不加 TransferRecord 表（方案 A：StockLog.referenceId 聚合，未来上量再升方案 B）
- transfer 第二期不做跨仓拆单（一次调拨 = 一个 referenceId）

## 三、关键约束（TDD 强制）

1. **transfer 双仓原子**（TDD 强制核心）：`withTransaction` 包 deductStock(源 OUTBOUND) + create/update(目标 INBOUND)，一条失败全部回滚。源仓库存不足抛 E-INVENTORY-001。
2. **batch-adjust 全事务**：`withTransaction` 内循环 `adjustStockTx`（**抽 tx 版本**，避免嵌套事务，复用批次 3 markPaidTx 模式）。一条失败全部回滚（非部分成功）。
3. **CSV 导入部分成功**：逐行解析 + 失败收集 `failedRows`（不阻塞成功的；与 batch-adjust 语义不同——CSV 导入容忍单行错误）。
4. **transfer 目标仓 stock 不存在**：创建 stock（quantity=调拨量）+ INBOUND log（A 决策）。
5. **listStocks 修 bug**：`lowStockOnly` 改用 `quantity <= safetyStock`（每条 stock 自带阈值，非硬编码 10）。
6. **RBAC**：SUPER_ADMIN + WAREHOUSE_STAFF（沿用现有）。

## 四、端点（追加到 `/api/v1/admin/inventory`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/stocks/batch-adjust` | 批量调整（全事务，上限 100，body: { items: [{warehouseId, skuId, deltaQty, reason?}] }） |
| POST | `/transfer` | 仓库间调拨（双仓原子，body: { fromWarehouseId, toWarehouseId, items: [{skuId, quantity}], reason? }） |
| GET | `/transfers` | 调拨记录列表（按 referenceId 聚合，filter: fromWarehouseId/toWarehouseId/limit） |
| GET | `/stocks/export` | CSV 导出（filter: warehouseId?，返 text/csv） |
| POST | `/stocks/import` | CSV 导入（multipart file，返 { successCount, failedRows: [{row, error}] }） |

### transfer 双仓原子事务编排（核心）

```ts
const referenceId = randomUUID();
return withTransaction(async (tx) => {
  for (const item of items) {
    // 1. 源仓扣减（deductStock 行锁防超卖，OUTBOUND log）
    const ok = await deductStock(tx, fromWh, skuId, qty, {
      reason: 'transfer out', referenceType: 'TRANSFER', referenceId, operatorId,
    });
    if (!ok) throw E-INVENTORY-001;  // 源仓不足，整事务回滚

    // 2. 目标仓增加（stock 不存在则创建 + INBOUND log，A 决策）
    const target = await tx.stock.findUnique({ where: { warehouseId_skuId: { toWh, skuId } } });
    if (!target) {
      await tx.stock.create({ data: { warehouseId: toWh, skuId, quantity: qty } });
      await tx.stockLog.create({ data: { ..., changeType: 'INBOUND', changeQty: qty, beforeQty: 0, afterQty: qty, referenceType: 'TRANSFER', referenceId } });
    } else {
      await tx.$executeRaw`UPDATE stocks SET quantity = quantity + ${qty} WHERE warehouse_id = ${toWh} AND sku_id = ${skuId}`;
      await tx.stockLog.create({ data: { ..., changeType: 'INBOUND', changeQty: qty, beforeQty: target.quantity, afterQty: target.quantity + qty, referenceType: 'TRANSFER', referenceId } });
    }
  }
});
```

### batch-adjust 全事务（抽 adjustStockTx）

```ts
// 抽 tx 版本（复用批次 3 markPaidTx 模式）
async adjustStockTx(tx: Tx, input: StockAdjustInput) { /* adjustStock 的事务核心，不含 withTransaction */ }
async adjustStock(input) { return withTransaction((tx) => this.adjustStockTx(tx, input)); }
async batchAdjustStock(items: StockAdjustInput[]) {
  if (items.length > 100) throw E-INVENTORY-008;
  return withTransaction(async (tx) => {
    for (const item of items) await this.adjustStockTx(tx, item);  // 全事务：一条失败全部回滚
    return items;
  });
}
```

## 五、错误码 E-INVENTORY

- 001 库存不足（已有，transfer 源仓不足复用）
- 002 超出配送范围（已有）
- 003 deltaQty=0（已有）
- 004 stock 记录不存在（已有）
- **005 transfer 同仓**（from === to）
- **006 transfer items 空**
- **007 transfer items 超上限**（>50）
- **008 batch-adjust items 超上限**（>100）
- **009 CSV 导入格式错**（解析失败/表头不对）

## 六、contract 新建 `inventory.ts`

- `BatchAdjustItemRequest` + `BatchAdjustRequest` + `BatchAdjustResult`
- `TransferItem` + `TransferRequest` + `TransferResult`
- `TransferRecord`（聚合视图：referenceId/fromWh/toWh/items/createdAt/operatorId）
- `ImportResult`（successCount + failedRows: [{row, error}]）

## 七、前端 `/inventory` 扩展

- 全仓库存快照列表（已有，修 lowStockOnly 用 safetyStock）
- 批量调整 Dialog（表格输入 warehouseId/skuId/deltaQty/reason × N 行 → JSON 提交）
- 调拨 Dialog（选 fromWh/toWh + items 表格）
- 调拨记录 Tab（按 referenceId 聚合列表）
- CSV 导出按钮（window.location 触发下载，参考 audit-logs）
- CSV 导入按钮（file input + multipart 上传 + failedRows 展示）

## 八、测试（TDD 强制 transfer）

- **transfer 双仓原子**（TDD 核心，先写失败测试）：
  1. 成功：源 deductStock + 目标 create/update + 两条 StockLog(TRANSFER) 同 referenceId
  2. 源仓不足 → E-INVENTORY-001（整事务回滚，目标仓无变化）
  3. 同仓 → E-INVENTORY-005
  4. items 空 → E-INVENTORY-006
  5. items 超上限 → E-INVENTORY-007
- **batch-adjust 全事务**：一条失败全部回滚 + 上限 100
- **listStocks fix**：lowStockOnly 用 safetyStock（改现有测试 L144）
- **CSV 解析**：表头校验 + 逐行 + failedRows
