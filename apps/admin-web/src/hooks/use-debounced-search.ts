'use client';

import { useEffect, useState } from 'react';

/**
 * 防抖搜索 hook
 *
 * 用法：
 *   const { debouncedValue, immediateValue, setImmediateValue } = useDebouncedSearch('', 300);
 *   const query = useProducts({ search: debouncedValue });
 *   <Input value={immediateValue} onChange={(e) => setImmediateValue(e.target.value)} />
 *
 * 输入框立即响应（immediateValue），但 API 请求用 debouncedValue（300ms 防抖）。
 */
export function useDebouncedSearch<T = string>(initial: T, delayMs = 300) {
  const [immediateValue, setImmediateValue] = useState<T>(initial);
  const [debouncedValue, setDebouncedValue] = useState<T>(initial);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(immediateValue), delayMs);
    return () => clearTimeout(timer);
  }, [immediateValue, delayMs]);

  return { immediateValue, debouncedValue, setImmediateValue } as const;
}
