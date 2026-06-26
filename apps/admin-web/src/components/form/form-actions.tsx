/**
 * FormActions — 表单底部按钮区（sticky bottom）
 *
 * 用法：
 *   <FormActions
 *     onCancel={() => router.back()}
 *     submitText="保存"
 *     submitting={isSubmitting}
 *   />
 */
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface FormActionsProps {
  onCancel?: () => void;
  cancelText?: string;
  submitText?: string;
  submitting?: boolean;
  submitDisabled?: boolean;
  onSubmit?: () => void;
  extraActions?: ReactNode;
}

export function FormActions({
  onCancel,
  cancelText = '取消',
  submitText = '保存',
  submitting = false,
  submitDisabled = false,
  onSubmit,
  extraActions,
}: FormActionsProps) {
  return (
    <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background p-4">
      {extraActions}
      {onCancel && (
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          {cancelText}
        </Button>
      )}
      {onSubmit ? (
        <Button type="button" onClick={onSubmit} disabled={submitting || submitDisabled}>
          {submitting ? '提交中...' : submitText}
        </Button>
      ) : (
        <Button type="submit" disabled={submitting || submitDisabled}>
          {submitting ? '提交中...' : submitText}
        </Button>
      )}
    </div>
  );
}

export { FormSection } from './form-section';
export { FormField } from './form-field';
