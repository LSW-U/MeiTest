/**
 * DeliveryTask Status Machine — 批2 v2 D8 纯函数单测
 *
 * 覆盖 6 状态全矩阵：
 *   - 线性主链：PENDING_ASSIGN→ASSIGNED→PICKED_UP→DELIVERING→DELIVERED
 *   - 现网差异边（登记见 machine 文件头）：PICKED_UP→DELIVERED 跳步（delivery 两步流）、
 *     ASSIGNED/PICKED_UP/DELIVERING→FAILED（reportIssue 异常终态）
 *   - 非法流转 / 自环 / 终态封口
 */
import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertCanTransition,
  isTerminalDeliveryTaskStatus,
  listAllowedNextDeliveryTask,
} from '../src/modules/dispatch/delivery-task-status.machine';

const ALL = ['PENDING_ASSIGN', 'ASSIGNED', 'PICKED_UP', 'DELIVERING', 'DELIVERED', 'FAILED'] as const;
const LEGAL: Array<[string, string]> = [
  ['PENDING_ASSIGN', 'ASSIGNED'],
  ['ASSIGNED', 'PICKED_UP'],
  ['PICKED_UP', 'DELIVERING'],
  ['DELIVERING', 'DELIVERED'],
  // 现网跳步边（delivery 任务两步流）
  ['PICKED_UP', 'DELIVERED'],
  // 现网 FAILED 边（reportIssue）
  ['ASSIGNED', 'FAILED'],
  ['PICKED_UP', 'FAILED'],
  ['DELIVERING', 'FAILED'],
];

describe('delivery-task-status.machine', () => {
  describe('canTransition - 线性主链', () => {
    it.each([
      ['PENDING_ASSIGN', 'ASSIGNED'],
      ['ASSIGNED', 'PICKED_UP'],
      ['PICKED_UP', 'DELIVERING'],
      ['DELIVERING', 'DELIVERED'],
    ] as const)('%s → %s 合法', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
    });

    it('PICKED_UP → DELIVERED 合法（现网跳步边：delivery 任务两步流，差异登记）', () => {
      expect(canTransition('PICKED_UP', 'DELIVERED')).toBe(true);
    });

    it.each([
      ['ASSIGNED', 'FAILED'],
      ['PICKED_UP', 'FAILED'],
      ['DELIVERING', 'FAILED'],
    ] as const)('%s → %s 合法（reportIssue 异常上报，差异登记）', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
    });
  });

  describe('canTransition - 非法流转', () => {
    const legalSet = new Set(LEGAL.map(([f, t]) => `${f}->${t}`));

    it('全矩阵扫描：未列出的流转全部非法（含跳跃/回退/自环）', () => {
      for (const from of ALL) {
        for (const to of ALL) {
          const key = `${from}->${to}`;
          if (legalSet.has(key)) {
            expect(canTransition(from, to), key).toBe(true);
          } else {
            expect(canTransition(from, to), key).toBe(false);
          }
        }
      }
    });

    it('典型跳跃非法：PENDING_ASSIGN → PICKED_UP / DELIVERED', () => {
      expect(canTransition('PENDING_ASSIGN', 'PICKED_UP')).toBe(false);
      expect(canTransition('PENDING_ASSIGN', 'DELIVERED')).toBe(false);
    });

    it('回退非法：ASSIGNED → PENDING_ASSIGN、DELIVERING → PICKED_UP', () => {
      expect(canTransition('ASSIGNED', 'PENDING_ASSIGN')).toBe(false);
      expect(canTransition('DELIVERING', 'PICKED_UP')).toBe(false);
    });

    it('自环非法（全部 6 态）', () => {
      for (const s of ALL) expect(canTransition(s, s)).toBe(false);
    });

    it('PENDING_ASSIGN 不可直接 FAILED（reportIssue V2-S2 只允许 ASSIGNED 起）', () => {
      expect(canTransition('PENDING_ASSIGN', 'FAILED')).toBe(false);
    });
  });

  describe('终态', () => {
    it('DELIVERED / FAILED 为终态，不可再流转', () => {
      for (const terminal of ['DELIVERED', 'FAILED'] as const) {
        expect(isTerminalDeliveryTaskStatus(terminal)).toBe(true);
        expect(listAllowedNextDeliveryTask(terminal)).toEqual([]);
        for (const to of ALL) expect(canTransition(terminal, to)).toBe(false);
      }
    });

    it('非终态 isTerminal=false 且 listAllowedNext 返回转出列表', () => {
      expect(isTerminalDeliveryTaskStatus('PICKED_UP')).toBe(false);
      expect(listAllowedNextDeliveryTask('PICKED_UP')).toEqual(['DELIVERING', 'DELIVERED', 'FAILED']);
      expect(listAllowedNextDeliveryTask('PENDING_ASSIGN')).toEqual(['ASSIGNED']);
    });
  });

  describe('assertCanTransition', () => {
    it('合法流转通过不抛', () => {
      expect(() => assertCanTransition('PENDING_ASSIGN', 'ASSIGNED')).not.toThrow();
      expect(() => assertCanTransition('DELIVERING', 'DELIVERED')).not.toThrow();
    });

    it('非法流转抛 DELIVERY_TASK_STATUS_TRANSITION_INVALID', () => {
      expect(() => assertCanTransition('PENDING_ASSIGN', 'DELIVERED')).toThrowError(
        'DELIVERY_TASK_STATUS_TRANSITION_INVALID: PENDING_ASSIGN → DELIVERED',
      );
    });
  });
});
