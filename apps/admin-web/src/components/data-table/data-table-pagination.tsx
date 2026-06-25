/**
 * DataTablePagination — 分页器（prev / next + 页码 + 总数）
 */
'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DataTablePaginationProps {
  page: number;
  totalPages: number;
  total?: number;
  onPageChange: (page: number) => void;
}

export function DataTablePagination({
  page,
  totalPages,
  total,
  onPageChange,
}: DataTablePaginationProps) {
  if (totalPages <= 1) {
    return total != null ? (
      <div className="text-xs text-muted-foreground">Total: {total}</div>
    ) : null;
  }

  return (
    <div className="flex items-center gap-3">
      {total != null && (
        <span className="text-xs text-muted-foreground">Total: {total}</span>
      )}
      <span className="text-xs text-muted-foreground">
        Page {page} / {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
