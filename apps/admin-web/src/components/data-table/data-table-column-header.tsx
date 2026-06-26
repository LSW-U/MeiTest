'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type SortDirection = 'asc' | 'desc' | null;

interface DataTableColumnHeaderProps {
  title: string;
  sortable?: boolean;
  direction?: SortDirection;
  onSort?: (direction: SortDirection) => void;
  className?: string;
}

/**
 * 可排序的列头（参考 medusa blocks/data-table/column-header）
 *
 * 点击逻辑：null → asc → desc → null（三态循环）
 *
 * 用法（在 columns 定义里）：
 *   header: (sort) => (
 *     <DataTableColumnHeader
 *       title="Price"
 *       sortable
 *       direction={sort.direction}
 *       onSort={sort.onChange}
 *     />
 *   )
 */
export function DataTableColumnHeader({
  title,
  sortable = false,
  direction = null,
  onSort,
  className,
}: DataTableColumnHeaderProps) {
  if (!sortable || !onSort) {
    return <span className={cn('text-sm font-medium', className)}>{title}</span>;
  }

  const cycle = () => {
    const next: SortDirection = direction === null ? 'asc' : direction === 'asc' ? 'desc' : null;
    onSort(next);
  };

  const Icon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ChevronsUpDown;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={cycle}
      className="-ml-3 h-8 data-[state=open]:bg-accent"
    >
      <span>{title}</span>
      <Icon className="ml-2 h-3.5 w-3.5" />
    </Button>
  );
}
