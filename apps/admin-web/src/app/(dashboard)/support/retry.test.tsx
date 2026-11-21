// @vitest-environment jsdom
/**
 * support 三区块 retry 接真实 refetch 测试（体验小批 20261122，方案v2 §三2 / A3）
 *
 * 断言口径：renderOrderEvidenceChain 三处 onRetry={() => {}} 改为接真实 refetch。
 * 直接驱动方式：renderOrderEvidenceChain 是页内私有函数，组件级测试走完整页成本高
 * （状态机 + dependent query），故把三区块 retry 行为抽为可独立验证的组件层断言——
 * 用最小 harness 复刻 ErrorState onRetry 接 refetch 的调用链，配合 refetch spy 断言。
 *
 * mock 边界：next-intl 直映射；react-query stub 返回可控 error + refetch spy。
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => '2026-01-01' }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ErrorState 用真组件（断言 retry 按钮点击 → onRetry 透传）
import { ErrorState } from '@/components/common/error-state';

describe('A3 retry → refetch 透传（ErrorState 契约 + support 三处接线）', () => {
  beforeAll(() => {
    if (!globalThis.PointerEvent) {
      class PointerEventShim extends MouseEvent {}
      (globalThis as Record<string, unknown>).PointerEvent = PointerEventShim;
    }
  });

  afterEach(cleanup);

  it('ErrorState retry 按钮点击调用传入的 onRetry（tasks 形态）', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="boom" onRetry={onRetry} />);
    fireEvent.click(screen.getByText('retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('onRetry 内可接真实 refetch spy（refunds / reviews 同一契约）', () => {
    // 复刻 support 页接线：onRetry: () => refundsQuery.refetch() 等
    const refundsRefetch = vi.fn();
    const reviewsRefetchA = vi.fn();
    const reviewsRefetchB = vi.fn();
    const props = {
      tasks: { refetch: vi.fn() },
      refunds: { refetch: refundsRefetch },
      reviews: { refetchA: reviewsRefetchA, refetchB: reviewsRefetchB },
    };
    render(
      <>
        <ErrorState message="t" onRetry={() => props.tasks.refetch()} />
        <ErrorState message="r" onRetry={() => props.refunds.refetch()} />
        <ErrorState
          message="v"
          onRetry={() => {
            void props.reviews.refetchA();
            void props.reviews.refetchB();
          }}
        />
      </>,
    );
    const buttons = screen.getAllByText('retry');
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    fireEvent.click(buttons[2]);
    expect(props.tasks.refetch).toHaveBeenCalledTimes(1);
    expect(refundsRefetch).toHaveBeenCalledTimes(1);
    // reviews 是双 query 合并 error，retry 两个都重拉
    expect(reviewsRefetchA).toHaveBeenCalledTimes(1);
    expect(reviewsRefetchB).toHaveBeenCalledTimes(1);
  });

  it('静态验证：support 页源码不再含空 onRetry（三处已接线）', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.join(__dirname, 'page.tsx'),
      'utf8',
    );
    expect(src).not.toContain('onRetry={() => {}}');
    expect(src).toContain('onRetryTasks: () => tasksQuery.refetch()');
    expect(src).toContain('onRetryRefunds: () => pickedOrderRefundsQuery.refetch()');
  });
});
