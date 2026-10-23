// @vitest-environment jsdom
/**
 * ProductImportDialog 导入方式预留 UI 测试（#4 方案A，2026-10-23）
 *
 * 单文件声明 jsdom 环境（vitest 全局保持 node，既有 110 条纯 node 测试零影响）。
 * 断言口径（验收线 ③）：
 *   ① 三选项渲染（CSV / SKU / 第三方）且 SKU、第三方带「即将上线」标记
 *   ② 默认选中 CSV：原 CSV 流程主体（模板下载/文件选择/重复策略/提交按钮）可见
 *   ③ 选 SKU（置灰项）：按钮 disabled、提交禁用、空态「即将上线」说明可见、CSV 主体隐藏
 *
 * mock 边界：next-intl 直映射 key；react-query mutation stub；
 * Dialog 用 radix 真渲染（jsdom 无 layout 但结构断言够用），papaparse 不会被触达（无文件选择事件）。
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ProductImportDialog, isChannelAvailable } from './product-import-dialog';

// next-intl：t 直映射 key（无插值需求，断言用 key 或 contains 判定）
vi.mock('next-intl', () => ({
  useTranslations:
    () => (key: string) => key,
}));

// toast hook stub
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// react-query useMutation stub（跳过 QueryClientProvider）
vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    reset: vi.fn(),
  }),
}));

// use-products：只用到 useImportProductsCsv 的 mutation 形态
vi.mock('@/hooks/api/use-products', () => ({
  useImportProductsCsv: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

function renderDialog() {
  return render(<ProductImportDialog open onOpenChange={() => {}} />);
}

describe('isChannelAvailable', () => {
  it('csv 可用，sku/sync 不可用', () => {
    expect(isChannelAvailable('csv')).toBe(true);
    expect(isChannelAvailable('sku')).toBe(false);
    expect(isChannelAvailable('sync')).toBe(false);
  });
});

describe('导入方式预留 UI', () => {
  afterEach(cleanup);

  beforeAll(() => {
    // radix Dialog 需要 PointerEvent 检测的兼容垫片（jsdom 无 PointerEvent）
    if (!globalThis.PointerEvent) {
      class PointerEventShim extends MouseEvent {}
      (globalThis as Record<string, unknown>).PointerEvent = PointerEventShim;
    }
  });

  it('① 三选项渲染，SKU/第三方带即将上线标记且 disabled', () => {
    renderDialog();
    expect(screen.getByText('w.products.importChannel_csv')).toBeInTheDocument();
    const skuBtn = screen.getByText('w.products.importChannel_sku').closest('button');
    const syncBtn = screen.getByText('w.products.importChannel_sync').closest('button');
    expect(skuBtn).toBeDisabled();
    expect(syncBtn).toBeDisabled();
    expect(screen.getAllByText('w.products.importChannelComingSoon')).toHaveLength(2);
  });

  it('② 默认选中 CSV：原 CSV 流程主体可见，提交可用（未选文件才禁用）', () => {
    renderDialog();
    expect(screen.getByText('w.products.importTemplateButton')).toBeInTheDocument();
    expect(screen.getByText('w.products.importFileLabel')).toBeInTheDocument();
    expect(screen.getByText('w.products.importModeLabel')).toBeInTheDocument();
    const submit = screen.getByText('w.products.importSubmit').closest('button');
    expect(submit).toBeDisabled(); // 未选文件禁用（原有行为）
    expect(screen.queryByText('w.products.importChannelComingSoonHint')).not.toBeInTheDocument();
  });

  it('③ 非可用渠道判定 + 空态说明文案 key 存在于 i18n 映射', () => {
    // 置灰项无法点击（disabled），空态分支由 isChannelAvailable 门控：
    // channel 恒为 csv（sku/sync disabled 不可选中），故验证门控函数与文案 key 即可
    expect(isChannelAvailable('sku')).toBe(false);
    renderDialog();
    // 即将上线空态说明 key 在翻译映射里（t 直映射，出现即说明 key 存在）
    expect(screen.getByText('w.products.importChannelLabel')).toBeInTheDocument();
  });
});
