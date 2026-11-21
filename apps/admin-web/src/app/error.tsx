'use client';

// 批3（20261012）最小补齐：App Router 根级错误边界
// server component 树抛错时渲染（生产环境替代默认白屏错误页）
// reset() 由 Next.js 注入，点击尝试重新渲染当前 segment
//
// 体验小批 §三-5（D5）：移除 useTranslations —— error boundary 在 provider 树外
// 抛错（root layout 级）时 Intl context 可能不可用，t() 二次抛错导致白屏。
// 文案写死英文，照 not-found.tsx 静态先例（error boundary 无 i18n provider 保证）。

import { useEffect } from 'react';
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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
