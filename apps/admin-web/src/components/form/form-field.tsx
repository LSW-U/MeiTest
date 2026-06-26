/**
 * FormField — label + children + hint/error
 *
 * 用法：
 *   <FormField label="名称（英文）" required hint="至少 2 个字符" error={errors.nameEn}>
 *     <Input {...register('nameEn')} />
 *   </FormField>
 */
import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

interface FormFieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function FormField({
  label,
  required,
  hint,
  error,
  htmlFor,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
