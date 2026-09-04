/**
 * WarehouseStaffCard — 详情页·在编人员卡（Codex设计 §3.7）
 *
 * 只读展示 staffList；角色取 roles[0]（空数组显示 —）；本期不提供增删/转移。
 */
'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/empty-state';
import type { WarehouseStaffItem } from '@/hooks/api/use-warehouses';

interface WarehouseStaffCardProps {
  staffList?: WarehouseStaffItem[];
}

/** avatar 首字母（姓名 / userId 尾段兜底） */
function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export function WarehouseStaffCard({ staffList }: WarehouseStaffCardProps) {
  const t = useTranslations('common');
  const list = staffList ?? [];

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('w.warehouses.cardStaffTitle')}</CardTitle>
        <Badge variant="secondary">{list.length}</Badge>
      </CardHeader>
      <CardContent>
        {list.length === 0 ? (
          <EmptyState title={t('w.warehouses.staffEmpty')} />
        ) : (
          <ul className="space-y-2">
            {list.map((staff) => {
              const displayName = staff.name ?? `…${staff.userId.slice(-6)}`;
              const role = staff.roles[0] ?? t('w.warehouses.staffRoleFallback');
              return (
                <li key={staff.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {initials(displayName)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {staff.name ?? t('w.warehouses.staffNameFallback')}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {displayName.startsWith('…') ? displayName : null}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">{role}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
