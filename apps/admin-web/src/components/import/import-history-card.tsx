/**
 * ImportHistoryCard — 导入历史 Card（批E 引入库存页，批F 提取共用）
 *
 * 数据源：GET /admin/import-logs（后端统一写，D5 v2），按 resourceType 过滤分页
 * 消费方：inventory/page.tsx（Stock）+ products/page.tsx（Product）
 *
 * i18n 说明：沿用批E 的 admin.inventory.importHistory* 键（两页共用，避免 5 语 key 迁移；
 * 文案本身是资源无关的「导入历史」通用语义）
 */
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useImportLogs } from '@/hooks/api/use-inventory';

export function ImportHistoryCard({ resourceType }: { resourceType: 'Product' | 'Stock' }) {
  const t = useTranslations('common');
  const [logsPage, setLogsPage] = useState(1);
  const importLogsQuery = useImportLogs({ resourceType, page: logsPage, pageSize: 10 });
  const importLogs = importLogsQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t('admin.inventory.importHistoryTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {importLogsQuery.isPending ? (
          <div className="text-xs text-muted-foreground">{t('loading')}</div>
        ) : !importLogs || importLogs.items.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('admin.inventory.importHistoryEmpty')}</p>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">{t('admin.inventory.importHistoryColTime')}</th>
                    <th className="py-2 pr-4 font-medium">{t('admin.inventory.importHistoryColFile')}</th>
                    <th className="py-2 pr-4 font-medium">{t('admin.inventory.importHistoryColSuccess')}</th>
                    <th className="py-2 pr-4 font-medium">{t('admin.inventory.importHistoryColFailed')}</th>
                    <th className="py-2 font-medium">{t('admin.inventory.importHistoryColOperator')}</th>
                  </tr>
                </thead>
                <tbody>
                  {importLogs.items.map((log) => (
                    <tr key={log.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</td>
                      <td className="max-w-[240px] truncate py-2 pr-4 font-mono" title={log.fileName}>{log.fileName}</td>
                      <td className="py-2 pr-4 font-mono text-green-600">{log.successCount}</td>
                      <td className={`py-2 pr-4 font-mono ${log.failedCount > 0 ? 'font-bold text-destructive' : 'text-muted-foreground'}`}>{log.failedCount}</td>
                      <td className="py-2 font-mono">{log.operatorId ? log.operatorId.slice(0, 8) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Button
                variant="outline"
                size="sm"
                disabled={logsPage <= 1}
                onClick={() => setLogsPage((p) => p - 1)}
              >
                {t('admin.inventory.importHistoryPagePrev')}
              </Button>
              <span className="text-muted-foreground">
                {t('admin.inventory.importHistoryPageInfo', {
                  page: importLogs.page,
                  total: Math.max(1, Math.ceil(importLogs.total / importLogs.pageSize)),
                  count: importLogs.total,
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={importLogs.page * importLogs.pageSize >= importLogs.total}
                onClick={() => setLogsPage((p) => p + 1)}
              >
                {t('admin.inventory.importHistoryPageNext')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
