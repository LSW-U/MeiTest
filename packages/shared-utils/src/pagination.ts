/**
 * 游标分页工具：cursor 编解码（base64url）
 *
 * 决策依据：契约 v0.2 §1.3 — 统一 cursor-based 分页，不用 offset/limit
 */

export interface CursorPayload {
  /** 上次返回的最后一项的排序字段值（如 createdAt 时间戳 / id） */
  v: string | number;
  /** 可选：第二排序字段（如 id，避免相同值时漂移） */
  s?: string;
}

/** 编码 cursor 为 base64url 字符串 */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
}

/** 解码 base64url cursor，失败抛 INVALID_CURSOR */
export function decodeCursor(cursor: string): CursorPayload {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || !('v' in parsed)) {
      throw new Error('missing v');
    }
    return parsed as CursorPayload;
  } catch (e) {
    throw new Error(`INVALID_CURSOR: ${(e as Error).message}`);
  }
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** 钳制 page size 到合法范围 */
export function clampPageSize(size: number | undefined | null): number {
  if (!size || size <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(size, MAX_PAGE_SIZE);
}
