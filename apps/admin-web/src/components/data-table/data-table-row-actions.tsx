'use client';

import type { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface RowAction {
  /** 显示文案 */
  label: string;
  /** 点击回调 */
  onSelect: () => void;
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否危险（destructive 红色） */
  destructive?: boolean;
  /** 可选图标 */
  icon?: React.ComponentType<{ className?: string }>;
}

interface DataTableRowActionsProps {
  /** 主操作（直接显示按钮）；若 undefined 则全部进 dropdown */
  primary?: RowAction;
  /** 次要操作（进 dropdown） */
  secondary?: RowAction[];
  /** dropdown 触发按钮的 aria-label，默认 'Open actions' */
  triggerLabel?: string;
  /** dropdown 头部分组 label，默认 'Actions' */
  groupLabel?: string;
  /** 自定义 children（完全替代默认按钮） */
  children?: ReactNode;
}

/**
 * 行操作按钮容器（参考 medusa blocks/data-table/row-actions）
 *
 * 用法：
 *   rowActions={(row) => (
 *     <DataTableRowActions
 *       primary={{ label: 'Edit', onSelect: () => openEdit(row) }}
 *       secondary={[
 *         { label: 'Duplicate', onSelect: () => duplicate(row) },
 *         { label: 'Delete', onSelect: () => remove(row), destructive: true },
 *       ]}
 *     />
 *   )}
 */
export function DataTableRowActions({
  primary,
  secondary = [],
  triggerLabel = 'Open actions',
  groupLabel = 'Actions',
  children,
}: DataTableRowActionsProps) {
  if (children) {
    return <div className="flex justify-end gap-1">{children}</div>;
  }

  const hasDropdown = secondary.length > 0;

  return (
    <div className="flex items-center justify-end gap-1">
      {primary && (
        <Button
          variant={primary.destructive ? 'destructive' : 'outline'}
          size="sm"
          disabled={primary.disabled}
          onClick={(e) => {
            e.stopPropagation();
            primary.onSelect();
          }}
        >
          {primary.icon && <primary.icon className="mr-2 h-4 w-4" />}
          {primary.label}
        </Button>
      )}
      {hasDropdown && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => e.stopPropagation()}
              aria-label={triggerLabel}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuLabel>{groupLabel}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {secondary.map((action, idx) => (
              <DropdownMenuItem
                key={idx}
                disabled={action.disabled}
                onSelect={action.onSelect}
                className={action.destructive ? 'text-destructive focus:bg-destructive/10' : ''}
              >
                {action.icon && <action.icon className="mr-2 h-4 w-4" />}
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
