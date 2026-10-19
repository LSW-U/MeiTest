/**
 * 客服工作台六卡组件（批1 20261018，方案v2 §二）
 *
 * 六卡全部只读 + 点击直达；每卡独立 loading/error/empty 互不阻塞。
 * 数据源全部复用既有 hook（零后端，v2 拍板）；RBAC 缺口按视角门控解决（v2 🔴1）。
 * 纯逻辑提取在 lib/support-cards.ts（node 可测）。
 */
'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { ExternalLink, Loader2 } from 'lucide-react';
import { useDashboardSummary } from '@/hooks/api/use-dashboard';
import { useRefunds } from '@/hooks/api/use-refunds';
import { useDispatchTasks } from '@/hooks/api/use-dispatch';
import { useAdminFeedbackList } from '@/hooks/api/use-feedback';
import { useAdminReviews } from '@/hooks/api/use-reviews';
import { useHotSearchZset } from '@/hooks/api/use-hot-search';
import { useRiders } from '@/hooks/api/use-statistics';
import { formatCurrency } from '@/lib/utils';
import {
  BadReviewLike,
  countBadge,
  diliDayRangeIso,
  latestBadReviews,
  linkTargetForPerspective,
  PENDING_PROBE_LIMIT,
  riderBottom3,
  riderTop3,
  sparklinePoints,
  SUPPORT_PIN_LABEL_KEY,
} from '@/lib/support-cards';
import { withFromSupport } from '@/lib/support-return';
import type { ZsetItem } from '@/hooks/api/use-hot-search';

/** 卡片直达链接统一入口（导航优化批1）：先做视角过滤，再统一追加 ?from=support */
function cardLink(href: string, perspective: string): string | null {
  const target = linkTargetForPerspective(href, perspective);
  return target ? withFromSupport(target) : null;
}

/** 卡片通用骨架（标题 + 直达链接；链接不可达时降级纯文本，不留死链） */
function CardShell({
  titleKey,
  href,
  perspective,
  children,
}: {
  titleKey: string;
  href?: string;
  perspective: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('common');
  const target = href ? cardLink(href, perspective) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{t(titleKey)}</span>
          {target && (
            <Link
              href={target}
              className="text-xs font-normal text-muted-foreground hover:text-foreground"
            >
              {t('admin.support.cards.viewAll')} →
            </Link>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{children}</CardContent>
    </Card>
  );
}

/** 卡内加载态 */
function CardLoading() {
  return (
    <div className="flex justify-center py-4">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
    </div>
  );
}

// ===== C1 今日单量/GMV + sparkline + 环比（platform only） =====

export function TodayBusinessCard({ perspective }: { perspective: string }) {
  const t = useTranslations('common');
  const q = useDashboardSummary('today');
  const data = q.data;
  return (
    <CardShell titleKey="admin.support.cards.c1Title" href="/dashboard" perspective={perspective}>
      {q.isPending && <CardLoading />}
      {q.error && <ErrorState message={q.error.message} onRetry={() => q.refetch()} />}
      {!q.isPending && !q.error && data && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{t('admin.support.cards.c1Gmv')}</p>
              <p className="font-mono text-lg">{formatCurrency(data.gmv)}</p>
              <p className="text-xs text-muted-foreground">
                {t('admin.support.cards.c1Growth', {
                  pct: data.gmvGrowthPct,
                })}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('admin.support.cards.c1Orders')}</p>
              <p className="font-mono text-lg">{data.orderCount}</p>
              <p className="text-xs text-muted-foreground">
                {t('admin.support.cards.c1Growth', {
                  pct: data.orderCountGrowthPct,
                })}
              </p>
            </div>
          </div>
          {data.trend.length > 0 && (
            <svg
              viewBox="0 0 100 24"
              className="h-6 w-full"
              preserveAspectRatio="none"
              role="img"
              aria-label={t('admin.support.cards.c1TrendAria')}
            >
              <polyline
                points={sparklinePoints(
                  data.trend.map((p) => p.gmv),
                  100,
                  24,
                )}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-primary"
              />
            </svg>
          )}
        </>
      )}
      {!q.isPending && !q.error && !data && (
        <EmptyState title={t('admin.support.cards.empty')} />
      )}
    </CardShell>
  );
}

// ===== C2 三行计数：待审退款 / 待派送 / 今日新反馈（双视角） =====

export function PendingCountsCard({ perspective }: { perspective: string }) {
  const t = useTranslations('common');
  // 游标分页 total optional → N+ 口径（limit=小值探测，v2 §三3）
  const refundsQ = useRefunds({ status: 'PENDING', limit: PENDING_PROBE_LIMIT });
  const tasksQ = useDispatchTasks({ status: 'PENDING_ASSIGN', limit: PENDING_PROBE_LIMIT });
  // 今日新反馈（东帝汶自然日；offset 分页 total 精确）
  const { startDate, endDate } = diliDayRangeIso(new Date());
  const feedbackQ = useAdminFeedbackList({ startDate, endDate, page: 1, pageSize: 1 });

  const refundsCount = refundsQ.data
    ? countBadge(refundsQ.data.pages[0]?.items.length ?? 0, PENDING_PROBE_LIMIT, refundsQ.data.pages[0]?.hasMore ?? false)
    : null;
  const tasksCount = tasksQ.data
    ? countBadge(tasksQ.data.pages[0]?.items.length ?? 0, PENDING_PROBE_LIMIT, tasksQ.data.pages[0]?.hasMore ?? false)
    : null;

  return (
    <CardShell titleKey="admin.support.cards.c2Title" perspective={perspective}>
      {refundsQ.isPending || tasksQ.isPending || feedbackQ.isPending ? <CardLoading /> : null}
      {refundsQ.error && <ErrorState message={refundsQ.error.message} onRetry={() => refundsQ.refetch()} />}
      {tasksQ.error && <ErrorState message={tasksQ.error.message} onRetry={() => tasksQ.refetch()} />}
      {feedbackQ.error && <ErrorState message={feedbackQ.error.message} onRetry={() => feedbackQ.refetch()} />}
      {!refundsQ.isPending && !refundsQ.error && (
        <CountRow
          label={t('admin.support.cards.c2PendingRefunds')}
          count={refundsCount}
          zeroText={t('admin.support.cards.none')}
          href={cardLink('/refunds?status=PENDING', perspective)}
        />
      )}
      {!tasksQ.isPending && !tasksQ.error && (
        <CountRow
          label={t('admin.support.cards.c2PendingAssign')}
          count={tasksCount}
          zeroText={t('admin.support.cards.none')}
          href={cardLink('/dispatch?status=PENDING_ASSIGN', perspective)}
        />
      )}
      {!feedbackQ.isPending && !feedbackQ.error && (
        <CountRow
          label={t('admin.support.cards.c2TodayFeedback')}
          count={{ mode: 'exact', count: feedbackQ.data?.total ?? 0 }}
          zeroText={t('admin.support.cards.none')}
          href={cardLink('/feedback', perspective)}
        />
      )}
    </CardShell>
  );
}

/** C2 单行计数（N+ 口径徽章；count=0 显示无；有数带直达链接） */
function CountRow({
  label,
  count,
  zeroText,
  href,
}: {
  label: string;
  count: { mode: 'exact'; count: number } | { mode: 'plus'; count: number } | null;
  zeroText: string;
  href: string | null;
}) {
  const isZero = count === null || count.count === 0;
  const badge =
    count === null || count.count === 0 ? (
      <span className="text-xs text-muted-foreground">{zeroText}</span>
    ) : (
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
        {count.mode === 'plus' ? `${count.count}+` : count.count}
      </span>
    );
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      {isZero || !href ? (
        badge
      ) : (
        <Link href={href} className="hover:opacity-80">
          {badge}
        </Link>
      )}
    </div>
  );
}

// ===== C3 最近 5 条 1~2 星差评（双视角；须带 status:'APPROVED'，v2 §二C3） =====

export function BadReviewsCard({ perspective }: { perspective: string }) {
  const t = useTranslations('common');
  // 后端单 rating 值过滤，无「1 或 2」语法 → 两路查询合并取最近 5 条
  // （hook ReviewListQuery 不透传 limit，后端默认页大小即够，前端合并后截 5）
  const q1 = useAdminReviews({ type: 'customer', rating: 1, status: 'APPROVED' });
  const q2 = useAdminReviews({ type: 'customer', rating: 2, status: 'APPROVED' });
  const pending = q1.isPending || q2.isPending;
  const error = q1.error ?? q2.error;
  const merged = latestBadReviews<BadReviewLike>(
    (q1.data?.items ?? []) as BadReviewLike[],
    (q2.data?.items ?? []) as BadReviewLike[],
    5,
  );

  return (
    <CardShell
      titleKey="admin.support.cards.c3Title"
      href="/reviews"
      perspective={perspective}
    >
      {pending && <CardLoading />}
      {error && !pending && <ErrorState message={error.message} onRetry={() => { q1.refetch(); q2.refetch(); }} />}
      {!pending && !error && merged.length === 0 && (
        <EmptyState title={t('admin.support.cards.c3Empty')} />
      )}
      {merged.map((r) => (
        <Link
          key={r.id}
          href={withFromSupport(`/reviews/${r.id}?type=customer`)}
          className="block rounded-md border p-2 hover:bg-muted"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-600">{'★'.repeat(r.rating)}</span>
            <span className="text-xs text-muted-foreground">{r.createdAt.slice(0, 10)}</span>
          </div>
        </Link>
      ))}
    </CardShell>
  );
}

// ===== C4 热搜词 TOP10（platform only） =====

export function HotSearchCard({ perspective }: { perspective: string }) {
  const t = useTranslations('common');
  const q = useHotSearchZset();
  // 注意：该 hook 返回 ApiSuccess 信封（消费方 hot-search 页同样取 .data），取 .data
  const items: ZsetItem[] = q.data?.data ? q.data.data.slice(0, 10) : [];
  return (
    <CardShell titleKey="admin.support.cards.c4Title" href="/hot-search" perspective={perspective}>
      {q.isPending && <CardLoading />}
      {q.error && <ErrorState message={q.error.message} onRetry={() => q.refetch()} />}
      {!q.isPending && !q.error && items.length === 0 && (
        <EmptyState title={t('admin.support.cards.c4Empty')} />
      )}
      {items.map((item, idx) => (
        <div key={`${item.word}-${idx}`} className="flex items-center justify-between">
          <span className="truncate">
            <span className="mr-2 font-mono text-xs text-muted-foreground">{idx + 1}</span>
            {item.word}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{item.searchCount}</span>
        </div>
      ))}
    </CardShell>
  );
}

// ===== C5 骑手绩效 TOP3/BOTTOM3（platform only；本周） =====

export function RiderPerfCard({ perspective }: { perspective: string }) {
  const t = useTranslations('common');
  const q = useRiders({ range: 'week' });
  const items = q.data?.items ?? [];
  const top = riderTop3(items);
  const bottom = riderBottom3(items);
  return (
    <CardShell titleKey="admin.support.cards.c5Title" href="/statistics" perspective={perspective}>
      {q.isPending && <CardLoading />}
      {q.error && <ErrorState message={q.error.message} onRetry={() => q.refetch()} />}
      {!q.isPending && !q.error && items.length === 0 && (
        <EmptyState title={t('admin.support.cards.c5Empty')} />
      )}
      {items.length > 0 && (
        <>
          <p className="text-xs font-medium text-muted-foreground">
            {t('admin.support.cards.c5Top')}
          </p>
          {top.map((r) => (
            <div key={r.riderId} className="flex items-center justify-between">
              <span className="truncate">{r.riderName}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {t('admin.support.cards.c5Orders', { count: r.completedOrders })}
              </span>
            </div>
          ))}
          <p className="pt-1 text-xs font-medium text-muted-foreground">
            {t('admin.support.cards.c5Bottom')}
          </p>
          {bottom.map((r) => (
            <div key={r.riderId} className="flex items-center justify-between">
              <span className="truncate">{r.riderName}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {r.rating.toFixed(1)}
              </span>
            </div>
          ))}
        </>
      )}
    </CardShell>
  );
}

// ===== C6 常用跳转（双视角；钉选增删 + localStorage 持久化，池按视角过滤） =====

export function QuickLinksCard({
  perspective,
  pins,
  onTogglePin,
  pinCandidates,
}: {
  perspective: string;
  pins: string[];
  onTogglePin: (path: string) => void;
  /** 钉选池（按视角过滤后的候选页） */
  pinCandidates: string[];
}) {
  const t = useTranslations('common');
  return (
    <CardShell titleKey="admin.support.cards.c6Title" perspective={perspective}>
      <div className="flex flex-wrap gap-2">
        {pins.length === 0 && <EmptyState title={t('admin.support.cards.c6Empty')} />}
        {pins.map((path) => (
          <span
            key={path}
            className="group/pin inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs"
          >
            <Link href={path} className="hover:text-foreground">
              {t(SUPPORT_PIN_LABEL_KEY[path] ?? 'menu.dashboard')}
            </Link>
            {/* 导航优化批1：钉选「开新工作面」语义 → hover 出现新标签打开小图标（方案v1 §二4 取简形态） */}
            <Link
              href={path}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('admin.support.cards.c6OpenNewTab')}
              title={t('admin.support.cards.c6OpenNewTab')}
              className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/pin:opacity-100 hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" aria-hidden />
            </Link>
            <button
              type="button"
              aria-label={t('admin.support.cards.c6Unpin')}
              onClick={() => onTogglePin(path)}
              className="text-muted-foreground hover:text-destructive"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {pinCandidates.filter((p) => !pins.includes(p)).length > 0 && (
        <div className="flex flex-wrap gap-2 border-t pt-2">
          {pinCandidates
            .filter((p) => !pins.includes(p))
            .map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => onTogglePin(path)}
                className="rounded-full border border-dashed px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              >
                + {t(SUPPORT_PIN_LABEL_KEY[path] ?? 'menu.dashboard')}
              </button>
            ))}
        </div>
      )}
    </CardShell>
  );
}
