/**
 * Alert — 简化版（缺 shadcn alert 组件时的临时实现）
 *
 * 用法：
 *   <Alert>
 *     <Info className="h-4 w-4" />
 *     <AlertTitle>标题</AlertTitle>
 *     <AlertDescription>描述</AlertDescription>
 *   </Alert>
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface AlertProps {
  children: ReactNode;
  className?: string;
}

export function Alert({ children, className }: AlertProps) {
  return (
    <div
      className={cn(
        'flex gap-3 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AlertTitle({ children }: { children: ReactNode }) {
  return <p className="font-medium leading-none text-blue-900">{children}</p>;
}

export function AlertDescription({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-blue-700">{children}</p>;
}
