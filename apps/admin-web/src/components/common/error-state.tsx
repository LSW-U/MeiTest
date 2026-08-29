/**
 * ErrorState — 错误状态
 */
'use client';

import { AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  const t = useTranslations('common');
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <AlertCircle className="h-8 w-8 text-destructive" />
      <div>
        <p className="text-sm font-medium text-destructive">{t('error.title')}</p>
        {message && (
          <p className="mt-1 font-mono text-xs text-muted-foreground">{message}</p>
        )}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          {t('retry')}
        </Button>
      )}
    </div>
  );
}
