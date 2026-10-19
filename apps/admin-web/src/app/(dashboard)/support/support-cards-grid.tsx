/**
 * 六卡装配网格（批1 20261018，方案v2 §四；P1-1 修复 20261019）
 *
 * 视角门控（v2 🔴1）：platform 全六卡；support 仅 C2/C3/C6；
 * 直达链接与 sidebar perspectives 联动过滤（linkTargetForPerspective，不留 403 死链）。
 * view=user/order 时网格整体**条件渲染卸载**（P1-1 教训：HTML hidden 属性会被
 * Tailwind .grid utility 同特异性后序覆盖，display 级联收起不可靠——审查报告 P1-1
 * 构建产物实证，此后 Tailwind display 类元素一律用条件渲染控制显隐）；
 * user/order 视图下网格不 mount，单行展开入口条件渲染展开态网格。
 * React Query 缓存下重挂载即命中缓存，无重复网络请求代价。
 * C6 钉选：localStorage admin_support_pins 持久化（先例 admin_sidebar_groups 同款）。
 */
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePerspectiveStore } from '@/stores/perspective';
import {
  addPin,
  defaultPins,
  filterPinsForPerspective,
  loadPins,
  removePin,
  SUPPORT_PINS_STORAGE_KEY,
  visibleCardKeys,
} from '@/lib/support-cards';
import {
  BadReviewsCard,
  HotSearchCard,
  PendingCountsCard,
  QuickLinksCard,
  RiderPerfCard,
  TodayBusinessCard,
} from './support-cards';

/** 钉选池候选页（全量；渲染前按视角过滤） */
const PIN_POOL = [
  '/orders',
  '/refunds',
  '/reviews',
  '/dispatch',
  '/customers',
  '/feedback',
  '/hot-search',
  '/statistics',
] as const;

export function SupportCardsGrid({ view }: { view: 'search' | 'user' | 'order' }) {
  const t = useTranslations('common');
  const perspective = usePerspectiveStore((s) => s.perspective);
  const cards = visibleCardKeys(perspective);

  // user/order 视图下网格收起状态（单行入口展开才显示）
  const [collapsedViewExpanded, setCollapsedViewExpanded] = useState(false);

  // C6 钉选状态：localStorage 优先，无记录回退默认 6 项（按视角过滤）
  const [pins, setPins] = useState<string[]>(() => defaultPins(perspective));

  // 挂载读持久化（SSR 安全）；视角切换重读（钉选池按视角过滤）
  useEffect(() => {
    try {
      const stored = loadPins(window.localStorage.getItem(SUPPORT_PINS_STORAGE_KEY));
      setPins(filterPinsForPerspective(stored ?? defaultPins(perspective), perspective));
    } catch {
      setPins(defaultPins(perspective));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perspective]);

  function togglePin(path: string) {
    setPins((prev) => {
      const next = prev.includes(path) ? removePin(prev, path) : addPin(prev, path);
      try {
        window.localStorage.setItem(SUPPORT_PINS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // 写入失败（隐私模式等）→ 仅内存生效，不持久化
      }
      return next;
    });
  }

  // 视角无卡（merchant/warehouse/rider-mgmt 不在 /support sidebar 范围）→ 不渲染
  if (cards.length === 0) return null;

  // P1-1：条件渲染，不依赖 hidden/display 级联
  const gridMounted = view === 'search' || collapsedViewExpanded;

  return (
    <section className="space-y-3">
      {/* user/order 视图：单行可展开入口（收起时网格不 mount，不干扰证据链） */}
      {view !== 'search' && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCollapsedViewExpanded((v) => !v)}
          className="w-full justify-center"
          aria-expanded={collapsedViewExpanded}
        >
          {collapsedViewExpanded ? (
            <ChevronDown className="mr-1 h-4 w-4" aria-hidden />
          ) : (
            <ChevronRight className="mr-1 h-4 w-4" aria-hidden />
          )}
          {t('admin.support.cards.sectionTitle')}
        </Button>
      )}
      {/* P1-1 修复：条件渲染（search 视图恒挂载；user/order 视图仅展开态挂载） */}
      {gridMounted && (
        <div className="grid gap-4 md:grid-cols-2">
          {cards.includes('c1') && <TodayBusinessCard perspective={perspective} />}
          {cards.includes('c2') && <PendingCountsCard perspective={perspective} />}
          {cards.includes('c3') && <BadReviewsCard perspective={perspective} />}
          {cards.includes('c4') && <HotSearchCard perspective={perspective} />}
          {cards.includes('c5') && <RiderPerfCard perspective={perspective} />}
          {cards.includes('c6') && (
            <QuickLinksCard
              perspective={perspective}
              pins={pins}
              onTogglePin={togglePin}
              pinCandidates={filterPinsForPerspective([...PIN_POOL], perspective)}
            />
          )}
        </div>
      )}
    </section>
  );
}
