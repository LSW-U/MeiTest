'use client';

// 批3（20261012）最小补齐：App Router 根级错误边界
// server component 树抛错时渲染（生产环境替代默认白屏错误页）
// reset() 由 Next.js 注入，点击尝试重新渲染当前 segment

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[admin-web] render error', error.digest, error.message);
  }, [error]);

  const t = useTranslations('common');

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h2 className="text-lg font-semibold">{t('error.title')}</h2>
      <Button onClick={() => reset()}>{t('retry')}</Button>
    </div>
  );
}
