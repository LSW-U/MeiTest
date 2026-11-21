// @vitest-environment jsdom
/**
 * payments 搜索防抖组件级测试（体验小批 20261122，方案v2 §三1 / A1+A2）
 *
 * 断言口径：
 *   A1 主列表 + 台账区：输入停顿 ≥300ms 才把 orderNo 传入查询（300ms 内不发、≥300ms 后发）
 *   A2 台账区搜索词变化显式重置 page=1；主列表防抖不重置任何分页（本就无分页 state）
 *
 * mock 边界：next-intl 直映射 key；react-query hook 全 stub（page/queryKey 断言直接读
 * stub 收到的参数）；radix Select 用真渲染 + PointerEvent 垫片（照 product-import-dialog
 * 先例）。日期输入用 JS 注入 change（fireEvent 对 date input 类型可靠）。
 */
import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useDebouncedSearch } from '@/hooks/use-debounced-search';

// ---- next-intl：t 直映射 key ----
vi.mock('next-intl', () => ({
  useTranslations:
    () => (key: string) => key,
  useFormatter: () => ({
    dateTime: (_d: Date) => '2026-01-01',
  }),
}));

// ---- toast stub ----
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ---- react-query hook stub：记录收到的 queryKey（含 orderNo / page） ----
const calls: { hook: string; params: unknown }[] = [];

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...original,
    useQuery: (opts: { queryKey: unknown; queryFn: () => unknown }) => {
      void opts.queryFn;
      return {
        data: undefined,
        isPending: false,
        error: null,
        refetch: vi.fn(),
      };
    },
    useInfiniteQuery: (opts: { queryKey: unknown; queryFn: () => unknown }) => {
      void opts.queryFn;
      return {
        data: undefined,
        isPending: false,
        error: null,
        refetch: vi.fn(),
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      };
    },
    useMutation: () => ({
      mutateAsync: vi.fn(),
      mutate: vi.fn(),
      isPending: false,
      reset: vi.fn(),
      error: null,
    }),
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    }),
  };
});

// ---- API hooks stub：捕获参数 ----
vi.mock('@/hooks/api/use-payments', () => ({
  usePayments: (params: Record<string, unknown>) => {
    calls.push({ hook: 'usePayments', params });
    return {
      data: undefined,
      isPending: false,
      error: null,
      refetch: vi.fn(),
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    };
  },
  usePaymentDetail: () => ({ data: undefined, isPending: false, error: null, refetch: vi.fn() }),
  useConfirmReceipt: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useMarkFailed: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useReconciliation: () => ({ data: [], isPending: false, error: null, refetch: vi.fn() }),
  useReconciliationLedger: (params: Record<string, unknown>) => {
    calls.push({ hook: 'useReconciliationLedger', params });
    // 返回带 total 的数据让分页按钮渲染（nextPage disabled 条件 page >= pages）
    return {
      data: { items: [{ id: 'l1' }], total: 30 },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    };
  },
  useLedgerSummary: () => ({ data: [], isPending: false, error: null, refetch: vi.fn() }),
  useImportBatches: () => ({ data: { items: [] }, isPending: false, error: null }),
}));

// ---- 上传链 stub（categories 不测，防 import 副作用） ----
vi.mock('@/lib/upload-scenes', () => ({
  uploadByScene: vi.fn(),
}));
vi.mock('@/lib/upload-errors', () => ({
  localizeUploadError: () => '',
  phaseToProgress: () => 0,
  precheckUploadFile: vi.fn(),
  PrecheckError: class extends Error {},
  toUploadError: () => ({}),
}));

import PaymentsPage from './page';

beforeAll(() => {
  // radix Dialog/Select 需要 PointerEvent 检测的兼容垫片（jsdom 无 PointerEvent）
  if (!globalThis.PointerEvent) {
    class PointerEventShim extends MouseEvent {}
    (globalThis as Record<string, unknown>).PointerEvent = PointerEventShim;
  }
});

beforeEach(() => {
  calls.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const searchPlaceholder = 'admin.payments.searchOrderNoPlaceholder';

describe('A1 主列表搜索防抖', () => {
  it('输入停顿 ≥300ms 才把 orderNo 传入 usePayments', async () => {
    render(<PaymentsPage />);
    const input = screen.getAllByPlaceholderText(searchPlaceholder)[0];

    // 输入后 299ms：无任何携带新搜索词的查询（debouncedValue 未变不触发重渲染）
    await act(async () => {
      fireEvent.change(input, { target: { value: 'MM2026' } });
    });
    calls.length = 0;
    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    await act(async () => {});
    const notYet = calls.filter(
      (c) => c.hook === 'usePayments' && (c.params as { orderNo?: string }).orderNo === 'MM2026',
    );
    expect(notYet).toHaveLength(0);

    // 越过 300ms：orderNo 出现在查询参数
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await act(async () => {});
    const after = calls.filter((c) => c.hook === 'usePayments');
    expect(after.length).toBeGreaterThan(0);
    expect(after.some((c) => (c.params as { orderNo?: string }).orderNo === 'MM2026')).toBe(true);
  });
});

describe('A2 台账区防抖 + page 重置', () => {
  /** 展开台账区后返回 [台账搜索框] */
  async function openLedgerAndGetInput() {
    render(<PaymentsPage />);
    // 页头两个 toggle：第一个是台账（ledgerTitle），第二个是对账（reconciliationTitle）
    fireEvent.click(screen.getByText('admin.payments.ledgerTitle'));
    await act(async () => {});
    const inputs = screen.getAllByPlaceholderText(searchPlaceholder);
    return inputs[inputs.length - 1]; // 台账区搜索框在主列表之后
  }

  it('台账搜索词变化重置 page=1（先翻到第 2 页再搜索）', async () => {
    const input = await openLedgerAndGetInput();

    // 先翻到第 2 页
    calls.length = 0;
    await act(async () => {
      fireEvent.click(screen.getByText('admin.payments.ledgerNextPage'));
    });
    const page2 = calls.filter((c) => c.hook === 'useReconciliationLedger');
    expect(page2.length).toBeGreaterThan(0);
    expect(page2.every((c) => (c.params as { page?: number }).page === 2)).toBe(true);

    // 再输入搜索词：page 立即回 1（不等防抖）
    calls.length = 0;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'MM0001' } });
    });
    await act(async () => {});
    const page1 = calls.filter((c) => c.hook === 'useReconciliationLedger');
    expect(page1.length).toBeGreaterThan(0);
    expect(page1.every((c) => (c.params as { page?: number }).page === 1)).toBe(true);

    // 搜索词本身 300ms 内不下发
    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    await act(async () => {});
    const notYet = calls.filter(
      (c) => c.hook === 'useReconciliationLedger' && (c.params as { orderNo?: string }).orderNo,
    );
    expect(notYet).toHaveLength(0);
  });
});

describe('A1 补充：useDebouncedSearch hook 纯逻辑', () => {
  it('immediateValue 即时更新，debouncedValue 延迟 300ms', async () => {
    let captured: ReturnType<typeof useDebouncedSearch<string>> | null = null;
    function Probe() {
      captured = useDebouncedSearch('', 300);
      return null;
    }
    render(<Probe />);
    await act(async () => {
      captured!.setImmediateValue('abc');
    });
    expect(captured!.immediateValue).toBe('abc');
    expect(captured!.debouncedValue).toBe('');
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(captured!.debouncedValue).toBe('abc');
  });
});
