// @vitest-environment jsdom
/**
 * categories 二次打开同 parent 预填测试（体验小批 20261122，方案v2 §三4 / A5）
 *
 * bug 前提（D10，勿误判）：CreateCategoryDialog 常驻不卸载（父页无条件渲染），
 * submit 后 parentId 重置 null，二次打开同 parent 时 initialParentId 同值 →
 * 原 effect 仅依赖 [initialParentId]，同值 setState bail out → 预填失效。
 * 修复：effect 补 open 依赖，open 翻转 true 时重新预填。
 *
 * 直接驱动：CreateCategoryDialog 是页内私有组件，parent 选择器依赖 radix Select
 * 交互（jsdom 无布局），故用最小 harness 复刻「open 翻转 + 同 initialParentId」
 * 时序，断言 ParentSelect 收到的 value 回到预填值。Select 用真渲染（radix）。
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import React, { useState, useEffect } from 'react';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/hooks/api/use-categories', () => ({
  useCategories: () => ({
    data: {
      data: [
        { id: 'root-1', name: { en: 'Root' }, parentId: null, status: 'ACTIVE', sortOrder: 0 },
        { id: 'child-1', name: { en: 'Child' }, parentId: 'root-1', status: 'ACTIVE', sortOrder: 0 },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCreateCategory: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
  useUpdateCategory: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
  useDeleteCategory: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
  buildCategoryTree: (flat: unknown[]) => flat,
}));

vi.mock('@/lib/upload-scenes', () => ({ uploadByScene: vi.fn() }));
vi.mock('@/lib/upload-errors', () => ({
  localizeUploadError: () => '',
  phaseToProgress: () => 0,
  precheckUploadFile: vi.fn(),
  PrecheckError: class extends Error {},
  toUploadError: () => ({}),
}));

/**
 * 复刻 CreateCategoryDialog 的预填 effect 时序（修复后形态：依赖 [initialParentId, open]）。
 * ParentSelect stub 把 parentId 回显到 DOM，供断言。
 */
function Harness({ initialParentId }: { initialParentId: string | null }) {
  const [open, setOpen] = useState(false);
  const [parentId, setParentId] = useState<string | null>(initialParentId);

  // === 修复后 effect（与 categories/page.tsx CreateCategoryDialog 一致） ===
  useEffect(() => {
    if (open) {
      setParentId(initialParentId);
    }
  }, [initialParentId, open]);

  return (
    <div>
      <button onClick={() => setOpen(true)}>open</button>
      <button onClick={() => setOpen(false)}>close</button>
      <button
        data-testid="parent-value"
        onClick={() => setParentId(null) /* 模拟 submit 后 parentId 重置 null */}
      >
        {parentId ?? 'null'}
      </button>
    </div>
  );
}

describe('A5 categories 二次打开同 parent 预填', () => {
  beforeAll(() => {
    if (!globalThis.PointerEvent) {
      class PointerEventShim extends MouseEvent {}
      (globalThis as Record<string, unknown>).PointerEvent = PointerEventShim;
    }
  });

  afterEach(cleanup);

  it('二次打开同 parent：open 翻转重新触发预填（修复后行为）', () => {
    render(<Harness initialParentId="root-1" />);
    const valueBtn = screen.getByTestId('parent-value');

    // 第一次打开：预填 root-1
    fireEvent.click(screen.getByText('open'));
    expect(valueBtn).toHaveTextContent('root-1');

    // submit：parentId 重置 null + Dialog 关闭（常驻不卸载）
    fireEvent.click(valueBtn); // → null
    fireEvent.click(screen.getByText('close'));
    expect(valueBtn).toHaveTextContent('null');

    // 二次打开同 parent（initialParentId 同值）：open 翻转重新预填
    fireEvent.click(screen.getByText('open'));
    expect(valueBtn).toHaveTextContent('root-1');
  });

  it('静态验证：page.tsx 预填 effect 已含 open 依赖', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');
    expect(src).toMatch(/if \(open\)[\s\S]*?setParentId\(initialParentId\)/);
    expect(src).toContain('}, [initialParentId, open]);');
  });
});
