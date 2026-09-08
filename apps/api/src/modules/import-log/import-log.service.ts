/**
 * ImportLog Service（批E D5 v2 2026-09-07：导入历史跨批通用查询）
 *
 * 数据来源：stocks/import / products/import 的 service 成功路径统一写入（前端只查不补记）
 * 消费方：admin-web 库存页历史区块（resourceType=Stock）、批F 商品导入历史 tab（'Product'）
 */
import { Injectable } from '@nestjs/common';
import { db } from '../../shared/db';

export interface ListImportLogsFilter {
  resourceType?: 'Product' | 'Stock';
  operatorId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class ImportLogService {
  /** 分页查询导入历史（createdAt 倒序，对齐 AdminUserList 的 page/pageSize/total 分页惯例） */
  async list(filter: ListImportLogsFilter) {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const where = {
      ...(filter.resourceType ? { resourceType: filter.resourceType } : {}),
      ...(filter.operatorId ? { operatorId: filter.operatorId } : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: new Date(filter.from) } : {}),
              ...(filter.to ? { lt: new Date(filter.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      db.importLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.importLog.count({ where }),
    ]);
    return {
      items: items.map((it) => ({
        ...it,
        createdAt: it.createdAt.toISOString(),
        failedRows: it.failedRows as Array<{ row: number; error: string }>,
      })),
      page,
      pageSize,
      total,
    };
  }
}
