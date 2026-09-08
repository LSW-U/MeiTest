/**
 * Admin Reconciliation Controller（批C 对账分流，微信支付预留 2026-09-08，方案V2 §3.3）
 *
 * 端点（/api/v1/admin/reconciliation）：
 *   GET  /ledgers         台账列表（method/status/orderNo/日期筛选 + offset 分页）
 *   GET  /summary         分区汇总（group by method + cashResult，admin 三区数据源）
 *   GET  /import-batches  对账单导入批次列表（预留入口，本轮不做真实上传 UI）
 *
 * 权限：读 SUPER_ADMIN + CUSTOMER_SERVICE（与 admin-payment 读权限一致）
 * 审计：金额对账属敏感操作，三端点全 @Audit 留痕
 * 错误码：E-RECON-001~099 预留段（本轮仅只读端点，无业务异常抛出）
 */
import { Controller, Get, Query, Inject } from '@nestjs/common';
import { z } from 'zod';
import { ReconciliationService, type ListLedgersFilter } from './reconciliation.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';

/** 台账列表查询（paymentMethod 全 8 值可筛——线上渠道行由未来导入产生） */
const ListLedgersQuery = z.object({
  method: z
    .enum(['COD', 'BANK_TRANSFER', 'WECHAT', 'PAYPAL', 'STRIPE', 'WECHAT_GLOBAL', 'ALIPAY_CN', 'LOCAL_PSP'])
    .optional(),
  status: z.enum(['PENDING', 'MATCHED', 'DIFF', 'SETTLED']).optional(),
  orderNo: z.string().optional(),
  dateFrom: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'invalid date')
    .optional(),
  dateTo: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'invalid date')
    .optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

/** 导入批次列表查询 */
const ListBatchesQuery = z.object({
  format: z.enum(['WECHAT', 'ALIPAY', 'BANK']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

@Controller('api/v1/admin/reconciliation')
@Roles('SUPER_ADMIN', 'CUSTOMER_SERVICE')
export class AdminReconciliationController {
  // 显式 @Inject：本仓 tsx 运行时不 emit design:paramtypes，隐式注入拿到 undefined（500 SOP 实测）
  constructor(
    @Inject(ReconciliationService) private readonly reconciliationService: ReconciliationService,
  ) {}

  /** 台账列表（筛选 method/status/orderNo/日期区间） */
  @Get('ledgers')
  @Audit({ resource: 'ReconciliationLedger' })
  async listLedgers(
    @Query(new ZodValidationPipe(ListLedgersQuery))
    query: {
      method?: string;
      status?: string;
      orderNo?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const result = await this.reconciliationService.listLedgers({
      method: query.method as ListLedgersFilter['method'],
      status: query.status as ListLedgersFilter['status'],
      orderNo: query.orderNo,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      page: query.page,
      pageSize: query.pageSize,
    });
    return { success: true as const, data: result };
  }

  /** 分区汇总（COD 现金 / 银行转账 / 线上预留三区） */
  @Get('summary')
  @Audit({ resource: 'ReconciliationLedger' })
  async summary() {
    const result = await this.reconciliationService.getSummary();
    return { success: true as const, data: result };
  }

  /** 导入批次列表（预留入口） */
  @Get('import-batches')
  @Audit({ resource: 'StatementImportBatch' })
  async listBatches(
    @Query(new ZodValidationPipe(ListBatchesQuery))
    query: { format?: 'WECHAT' | 'ALIPAY' | 'BANK'; page?: number; pageSize?: number },
  ) {
    const result = await this.reconciliationService.listBatches(query);
    return { success: true as const, data: result };
  }
}
