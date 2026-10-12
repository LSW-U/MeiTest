/**
 * warehouse-operating-hours-card 纯函数单测（跨午夜语义对齐批1）
 *
 * 语义（契约 warehouse.ts OperatingHours，2026-10-09 P2-1 放行）：
 * - close < open = 合法跨午夜窗口；close === open 拒；rest/空值 = 休息日
 * 纯函数测试，不引 jsdom/RTL。
 */
import { describe, it, expect } from 'vitest';
import { normalizeForSave } from './warehouse-operating-hours-card';
import { OPERATING_DAYS, type OperatingDay, type OperatingHour } from '@/hooks/api/use-warehouses';

type LocalHours = Record<OperatingDay, OperatingHour>;

function row(open: string, close: string, rest = false): OperatingHour {
  return { open, close, rest };
}

/** 7 天全填同一行态的本地表单 */
function allDays(r: OperatingHour): LocalHours {
  return Object.fromEntries(OPERATING_DAYS.map((d) => [d, { ...r }])) as LocalHours;
}

describe('normalizeForSave 跨午夜语义', () => {
  it('① close > open 正常窗口合法', () => {
    const out = normalizeForSave(allDays(row('08:00', '22:00')));
    expect(out).not.toBeNull();
    expect(out!['mon']).toEqual({ open: '08:00', close: '22:00', rest: false });
  });

  it('② close < open 跨午夜窗口合法（不再拒）', () => {
    const out = normalizeForSave(allDays(row('18:00', '02:00')));
    expect(out).not.toBeNull();
    expect(out!['tue']).toEqual({ open: '18:00', close: '02:00', rest: false });
  });

  it('③ close === open 等值窗口拒绝（返回 null）', () => {
    expect(normalizeForSave(allDays(row('08:00', '08:00')))).toBeNull();
  });

  it('④ rest 行归一化为休息日', () => {
    const out = normalizeForSave(allDays(row('', '', true)));
    expect(out).not.toBeNull();
    expect(out!['sun']).toEqual({ open: '', close: '', rest: true });
  });

  it('⑤ 空值短路：open/close 为空不误判非法（按休息日处理）', () => {
    const out = normalizeForSave(allDays(row('', '')));
    expect(out).not.toBeNull();
    expect(out!['mon']).toEqual({ open: '', close: '', rest: true });
  });

  it('⑥ normalizeForSave 输出形态：rest 行统一 {open:\'\',close:\'\',rest:true}', () => {
    const local = allDays(row('08:00', '22:00'));
    local['sat'] = { open: '23:00', close: '', rest: false }; // 缺 close → 视为休息
    const out = normalizeForSave(local);
    expect(out).not.toBeNull();
    expect(out!['sat']).toEqual({ open: '', close: '', rest: true });
    expect(out!['fri']).toEqual({ open: '08:00', close: '22:00', rest: false });
  });
});
