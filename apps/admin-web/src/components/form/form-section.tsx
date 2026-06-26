/**
 * FormSection — 表单分区容器
 *
 * 用法：
 *   <FormSection title="基本信息" description="商品必填字段">
 *     {children}
 *   </FormSection>
 */
import type { ReactNode } from 'react';

interface FormSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
    <div className={`space-y-4 rounded-lg border p-6 ${className ?? ''}`}>
      <div className="space-y-1">
        <h3 className="text-lg font-medium">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}
