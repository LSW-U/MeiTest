/**
 * SupportReturnBar — 客服直达返回条（导航优化批1 20261018，方案v1 §二1）
 *
 * 目标页 ?from=support 时渲染「← 返回客服工作台」（Link href=/support）；
 * 无参数 / 其它 from 值零渲染（N3：侧栏/收藏夹等正常入口零变化）。
 * 解析逻辑提取在 lib/support-return.ts（node 可测）。
 */
'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { isFromSupport } from '@/lib/support-return';

export function SupportReturnBar() {
  const t = useTranslations('common');
  const searchParams = useSearchParams();
  if (!isFromSupport(searchParams.get('from'))) return null;
  return (
    <Link
      href="/support"
      className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {t('admin.support.returnToWorkbench')}
    </Link>
  );
}
