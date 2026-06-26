/**
 * Audit Service — 审计日志查询（复用 W1 AuditLog 表）
 *
 * 决策依据：W-M-C-T 流程 3 W4 — platform M1 C1（提前到 W2，依赖最少）
 *
 * 不写 AuditLog（写入由全局 AuditInterceptor 负责），仅提供查询/导出。
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { db } from '../../shared/db';
import type { AuditLogQueryType } from '@meimart/api-contract';

const MAX_EXPORT_ROWS = 10000;

@Injectable()
export class AuditService {
  async list(query: AuditLogQueryType) {
    const where = this.buildWhere(query);
    const limit = query.limit;
    const items = await db.auditLog.findMany({
      where,
      // M5 修复：复合排序保证 cursor 跳页稳定（同毫秒多条不丢）
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        userId: true,
        action: true,
        resourceType: true,
        resourceId: true,
        deviceType: true,
        perspective: true,
        ip: true,
        createdAt: true,
      },
    });

    const hasMore = items.length > limit;
    const slice = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? slice[slice.length - 1]?.id ?? null : null;

    return {
      items: slice,
      nextCursor,
      hasMore,
    };
  }

  async detail(id: string) {
    const log = await db.auditLog.findUnique({ where: { id } });
    if (!log) {
      throw new NotFoundException({
        code: 'E-AUDIT-001',
        message: 'Audit log not found',
      });
    }
    return log;
  }

  /** 导出 CSV 流（最多 MAX_EXPORT_ROWS） */
  async exportCsv(query: AuditLogQueryType): Promise<string> {
    const where = this.buildWhere(query);
    const rows = await db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_EXPORT_ROWS,
      select: {
        id: true,
        createdAt: true,
        userId: true,
        action: true,
        resourceType: true,
        resourceId: true,
        perspective: true,
        deviceType: true,
        ip: true,
        traceId: true,
      },
    });

    const headers = [
      'id',
      'createdAt',
      'userId',
      'action',
      'resourceType',
      'resourceId',
      'perspective',
      'deviceType',
      'ip',
      'traceId',
    ];
    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.createdAt.toISOString(),
          r.userId,
          r.action,
          r.resourceType,
          r.resourceId,
          r.perspective,
          r.deviceType,
          r.ip,
          r.traceId,
        ]
          .map(escape)
          .join(','),
      );
    }
    // m2 修复：开头加 UTF-8 BOM，避免 Excel 按默认 GBK 解析中文/印尼/葡文乱码
    return '﻿' + lines.join('\n');
  }

  private buildWhere(query: AuditLogQueryType) {
    return {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(query.action ? { action: { contains: query.action } } : {}),
      ...(query.perspective ? { perspective: query.perspective } : {}),
      // W4 新增：IP 精确匹配（安全审计用）
      ...(query.ip ? { ip: query.ip } : {}),
      // W4 新增：User-Agent 模糊匹配
      ...(query.userAgent ? { userAgent: { contains: query.userAgent } } : {}),
      // W4 新增：traceId 精确查找（链路追踪用）
      ...(query.traceId ? { traceId: query.traceId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
  }
}

export { MAX_EXPORT_ROWS };
