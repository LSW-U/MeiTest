// @vitest-environment jsdom
/**
 * 根级 error.tsx 去 i18n 化测试（体验小批 20261122，方案v2 §三5 / A6）
 *
 * 断言口径：error boundary 在 provider 树外抛错时不得因 Intl context 缺失二次抛错——
 * 渲染静态英文文案，无任何 next-intl 依赖（不 mock next-intl，直接渲染验证）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// 注意：故意不 mock next-intl —— 若组件残留 useTranslations，无 provider 渲染即抛错

import GlobalError from './error';

afterEach(cleanup);

describe('A6 error.tsx 去 i18n 化（防二次抛错）', () => {
  it('无 i18n provider 环境下正常渲染静态英文文案', () => {
    render(<GlobalError error={new Error('boom')} reset={() => {}} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });

  it('reset 按钮点击调用 reset', () => {
    const reset = vi.fn();
    render(<GlobalError error={new Error('boom')} reset={reset} />);
    fireEvent.click(screen.getByText('Try again'));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('静态验证：源码无 useTranslations / next-intl 引用', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'error.tsx'), 'utf8');
    // 只断言 import 层（注释里允许出现说明性字样）
    expect(src).not.toMatch(/import\s+\{[^}]*useTranslations/);
    expect(src).not.toContain("from 'next-intl'");
  });
});
