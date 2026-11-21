// @vitest-environment jsdom
/**
 * login 502 非 JSON 友好文案测试（体验小批 20261122，方案v2 §三3 / A4）
 *
 * 断言口径：
 *   ① 网关 502/504 返回 HTML（content-type text/html）→ 显示 auth 命名空间
 *      login.serviceUnavailable 友好文案，不显示 SyntaxError
 *   ② 4xx JSON 体（data.error.message）→ 维持原逻辑显示后端 message
 *   ③ content-type JSON 但 body 解析失败（SyntaxError）→ 同样落友好文案
 *
 * mock 边界：next-intl 直映射 key；global fetch stub 返回可控 Response；
 * Alert 简化实现无 role，错误文案以 .text-destructive 容器定位。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import LoginPage from './page';

function mockFetch(resp: Response) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(resp)));
}

/** 错误 Alert 容器（Alert 简化实现带 text-destructive class） */
function errorAlert() {
  return document.querySelector('.text-destructive') as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function submit() {
  fireEvent.change(document.getElementById('login-phone') as HTMLInputElement, {
    target: { value: '+670999999999' },
  });
  fireEvent.change(document.getElementById('login-password') as HTMLInputElement, {
    target: { value: 'admin12345' },
  });
  fireEvent.submit(document.querySelector('form')!);
  await waitFor(() => expect(errorAlert()).toBeInTheDocument());
}

describe('A4 login 502 非 JSON 错误态', () => {
  it('① 网关 502 HTML：显示友好文案 login.serviceUnavailable，非 SyntaxError', async () => {
    mockFetch(
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );
    render(<LoginPage />);
    await submit();
    expect(errorAlert()).toHaveTextContent('login.serviceUnavailable');
    expect(errorAlert().textContent).not.toContain('Unexpected token');
  });

  it('② 4xx JSON 体：维持原逻辑显示 data.error.message', async () => {
    mockFetch(
      new Response(
        JSON.stringify({ success: false, error: { code: 'E-AUTH-001', message: '账号或密码错误' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    );
    render(<LoginPage />);
    await submit();
    expect(errorAlert()).toHaveTextContent('账号或密码错误');
    expect(errorAlert().textContent).not.toContain('serviceUnavailable');
  });

  it('③ content-type JSON 但 body 非法：落友好文案（try-catch json 分支）', async () => {
    mockFetch(
      new Response('not-json{{', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(<LoginPage />);
    await submit();
    expect(errorAlert()).toHaveTextContent('login.serviceUnavailable');
  });
});
