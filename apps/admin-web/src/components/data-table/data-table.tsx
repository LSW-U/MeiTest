/**
 * DataTable — 泛型数据表格
 *
 * 参考 medusa blocks/data-table 模式：
 *   - 泛型 T 支持 row render
 *   - 组合式：toolbar / pagination / emptyState / errorState 都是槽位
 *   - 行点击 + 行操作按钮
 */
'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
  headClassName?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  isLoading?: boolean;
  loadingRows?: number;
  toolbar?: ReactNode;
  pagination?: ReactNode;
  emptyState?: ReactNode;
  errorState?: ReactNode;
  onRowClick?: (row: T) => void;
  rowKey?: (row: T) => string;
  rowActions?: (row: T) => ReactNode;
  /**
   * 行选择（批C 批量通道用）。三 prop 同时传才启用：selectable + selectedIds + onSelectedIdsChange。
   * 选择 key 复用 rowKey/row.id（与行 key 一致）
   */
  selectable?: boolean;
  selectedIds?: string[];
  onSelectedIdsChange?: (next: string[]) => void;
}

export function DataTable<T extends object>({
  data,
  columns,
  isLoading,
  loadingRows = 5,
  toolbar,
  pagination,
  emptyState,
  errorState,
  onRowClick,
  rowKey,
  rowActions,
  selectable,
  selectedIds,
  onSelectedIdsChange,
}: DataTableProps<T>) {
  const t = useTranslations('common');
  const getKey = (row: T, idx: number) =>
    rowKey ? rowKey(row) : (row as { id?: string }).id ?? String(idx);

  const selectionEnabled = !!(selectable && selectedIds && onSelectedIdsChange);
  const selectedSet = new Set(selectedIds ?? []);
  const allPageSelected = data.length > 0 && data.every((row, idx) => selectedSet.has(getKey(row, idx)));
  const somePageSelected = data.some((row, idx) => selectedSet.has(getKey(row, idx)));

  const toggleRow = (row: T, idx: number) => {
    if (!onSelectedIdsChange || !selectedIds) return;
    const key = getKey(row, idx);
    onSelectedIdsChange(
      selectedSet.has(key)
        ? selectedIds.filter((k) => k !== key)
        : [...selectedIds, key],
    );
  };

  const toggleAllPage = () => {
    if (!onSelectedIdsChange || !selectedIds) return;
    const pageKeys = data.map((row, idx) => getKey(row, idx));
    onSelectedIdsChange(
      allPageSelected
        ? selectedIds.filter((k) => !pageKeys.includes(k))
        : [...new Set([...selectedIds, ...pageKeys])],
    );
  };

  // 选择列插在最前，影响空态/错误态 colSpan
  const colSpan = columns.length + (selectionEnabled ? 1 : 0) + (rowActions ? 1 : 0);

  return (
    <div className="space-y-4">
      {toolbar && <div className="flex items-center gap-2">{toolbar}</div>}
      <div className="rounded-md border bg-white dark:bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              {selectionEnabled && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allPageSelected || (somePageSelected && 'indeterminate')}
                    onCheckedChange={toggleAllPage}
                    aria-label={t('w.table.selectAll')}
                  />
                </TableHead>
              )}
              {columns.map((col) => (
                <TableHead key={col.key} className={col.headClassName}>
                  {col.header}
                </TableHead>
              ))}
              {rowActions && <TableHead className="text-right">{t('actions')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: loadingRows }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  {selectionEnabled && (
                    <TableCell>
                      <Skeleton className="h-5 w-5" />
                    </TableCell>
                  )}
                  {columns.map((col) => (
                    <TableCell key={col.key}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                  {rowActions && (
                    <TableCell className="text-right">
                      <Skeleton className="ml-auto h-5 w-16" />
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : errorState ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-8">
                  {errorState}
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-8">
                  {emptyState ?? (
                    <span className="text-sm text-muted-foreground">{t('noData')}</span>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, idx) => (
                <TableRow
                  key={getKey(row, idx)}
                  className={onRowClick ? 'cursor-pointer' : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {selectionEnabled && (
                    <TableCell
                      className="w-10"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={selectedSet.has(getKey(row, idx))}
                        onCheckedChange={() => toggleRow(row, idx)}
                        aria-label={t('w.table.selectRow')}
                      />
                    </TableCell>
                  )}
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.className}>
                      {col.render ? col.render(row) : null}
                    </TableCell>
                  ))}
                  {rowActions && (
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {rowActions(row)}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {pagination && <div className="flex items-center justify-end gap-2">{pagination}</div>}
    </div>
  );
}
