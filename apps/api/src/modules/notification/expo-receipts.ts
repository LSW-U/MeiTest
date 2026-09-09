/**
 * Expo Push 回执拉取（批N4，2026-09-10）
 *
 * POST https://exp.host/--/api/v2/push/getReceipts（body {ids}，单请求 ≤1000 条）
 * —— push/send 返回的 ticket id 在推送后数分钟才可查回执，调用方（notification-push
 * processor）入 5min 延迟 job 后再拉。
 *
 * 响应形态：{ data: { [ticketId]: { status: 'ok' } | { status: 'error', message, details: { error } } } }
 *   - 顶层 errors（限流/服务端错误）→ 抛错交 BullMQ 重试
 *   - 单 ticket 缺失 → 不入 Map（调用方不标已处理，重试时可再查）
 */

/** Expo getReceipts 单请求上限（官方约束） */
export const EXPO_RECEIPTS_CHUNK_SIZE = 1000;

const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** Expo 回执（getReceipts data 值） */
export interface ExpoPushReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * 单块拉取回执（≤1000 条）：ticketId → receipt 映射
 *
 * 网络/HTTP/响应形态异常抛错（调用方 catch 后交 BullMQ 重试），不静默吞。
 */
export async function fetchExpoReceiptsChunk(
  ids: string[],
): Promise<Map<string, ExpoPushReceipt>> {
  let response: Response;
  try {
    response = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.EXPO_ACCESS_TOKEN
          ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ ids }),
    });
  } catch (e) {
    throw new Error(`EXPO_RECEIPTS_FETCH_FAILED: ${(e as Error).message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`EXPO_RECEIPTS_HTTP_${response.status}: ${text.slice(0, 200)}`);
  }

  const payload = (await response.json().catch(() => null)) as {
    data?: Record<string, ExpoPushReceipt>;
    errors?: Array<{ message?: string; code?: string }>;
  } | null;

  // 顶层 errors（如限流）→ 抛错重试；data 缺失同样视为不可信响应
  if (payload?.errors && payload.errors.length > 0) {
    throw new Error(`EXPO_RECEIPTS_TOPLEVEL_ERROR: ${payload.errors[0]?.message ?? 'unknown'}`);
  }
  if (!payload?.data) {
    throw new Error('EXPO_RECEIPTS_BAD_RESPONSE: missing data');
  }

  return new Map(Object.entries(payload.data));
}

/**
 * 分块拉取全量回执：ticketId → receipt 合并映射
 *
 * ids > 1000 自动分块；任一块抛错整体上抛（BullMQ 重试整个 job，已拉回执的
 * 块因幂等标记不会重复计数——见 processor 处置逻辑）。
 */
export async function fetchAllExpoReceipts(
  ids: string[],
): Promise<Map<string, ExpoPushReceipt>> {
  const merged = new Map<string, ExpoPushReceipt>();
  for (let i = 0; i < ids.length; i += EXPO_RECEIPTS_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + EXPO_RECEIPTS_CHUNK_SIZE);
    const part = await fetchExpoReceiptsChunk(chunk);
    for (const [id, receipt] of part) {
      merged.set(id, receipt);
    }
  }
  return merged;
}
