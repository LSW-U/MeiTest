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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

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
}

export function DataTable<T extends { id?: string }>({
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
}: DataTableProps<T>) {
  const getKey = (row: T, idx: number) =>
    rowKey ? rowKey(row) : row.id ?? String(idx);

  return (
    <div className="space-y-4">
      {toolbar && <div className="flex items-center gap-2">{toolbar}</div>}
      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key} className={col.headClassName}>
                  {col.header}
                </TableHead>
              ))}
              {rowActions && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: loadingRows }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
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
                <TableCell colSpan={columns.length + (rowActions ? 1 : 0)} className="py-8">
                  {errorState}
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + (rowActions ? 1 : 0)} className="py-8">
                  {emptyState ?? <span className="text-sm text-muted-foreground">No data.</span>}
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, idx) => (
                <TableRow
                  key={getKey(row, idx)}
                  className={onRowClick ? 'cursor-pointer' : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
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
