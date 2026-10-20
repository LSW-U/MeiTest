/**
 * dispatch-tasks-monitor.test.ts — 任务监控独立页批1 纯逻辑单测（20261019）
 *
 * 覆盖：status 守卫纯函数（canReassign/canCancel，随迁自 dispatch/page.tsx:217-218）
 *       + 兜底链接/C2 直达联动（support-cards.ts 视角映射）
 */
import { describe, it, expect } from 'vitest';
import { canReassign, canCancel } from '@/app/(dashboard)/dispatch/tasks-monitor';
import {
  linkTargetForPerspective,
  SUPPORT_LINK_PERSPECTIVES,
  SUPPORT_PIN_LABEL_KEY,
} from '@/lib/support-cards';
import type { DeliveryTaskStatus } from '@/hooks/api/use-dispatch';

const ALL_STATUSES: DeliveryTaskStatus[] = [
  'PENDING_ASSIGN',
  'ASSIGNED',
  'PICKED_UP',
  'DELIVERING',
  'DELIVERED',
  'FAILED',
];

describe('canReassign（批1 随迁守卫：仅 ASSIGNED）', () => {
  it('ASSIGNED → true', () => {
    expect(canReassign('ASSIGNED')).toBe(true);
  });
  it('其余 5 状态 → false', () => {
    for (const s of ALL_STATUSES.filter((s) => s !== 'ASSIGNED')) {
      expect(canReassign(s)).toBe(false);
    }
  });
});

describe('canCancel（批1 随迁守卫：PENDING_ASSIGN + ASSIGNED）', () => {
  it('PENDING_ASSIGN / ASSIGNED → true', () => {
    expect(canCancel('PENDING_ASSIGN')).toBe(true);
    expect(canCancel('ASSIGNED')).toBe(true);
  });
  it('其余 4 状态 → false', () => {
    for (const s of ALL_STATUSES.filter((s) => s !== 'PENDING_ASSIGN' && s !== 'ASSIGNED')) {
      expect(canCancel(s)).toBe(false);
    }
  });
});

describe('任务监控独立页侧栏/直达联动（批1）', () => {
  it('/dispatch/tasks 已登记视角映射 = platform（与 sidebar 对齐）', () => {
    expect(SUPPORT_LINK_PERSPECTIVES['/dispatch/tasks']).toEqual(['platform']);
  });
  it('C2 直达新链接 platform 可达且带 status 原样返回', () => {
    expect(
      linkTargetForPerspective('/dispatch/tasks?status=PENDING_ASSIGN', 'platform'),
    ).toBe('/dispatch/tasks?status=PENDING_ASSIGN');
  });
  it('support 视角 → null（不渲染死链）', () => {
    expect(linkTargetForPerspective('/dispatch/tasks?status=PENDING_ASSIGN', 'support')).toBeNull();
  });
  it('C6 钉选标签已登记 menu.dispatchTasks（不做 sidebar 死键）', () => {
    expect(SUPPORT_PIN_LABEL_KEY['/dispatch/tasks']).toBe('menu.dispatchTasks');
  });
});
