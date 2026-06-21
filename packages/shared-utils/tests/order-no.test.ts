import { describe, it, expect } from 'vitest';
import {
  formatOrderNo,
  parseOrderNo,
  isValidOrderNo,
  getOrderSeqKey,
  ORDER_NO_REGEX,
  ORDER_NO_LENGTH,
  MAX_DAILY_SEQ_PER_WAREHOUSE,
} from '../src/order-no';

describe('order-no', () => {
  describe('formatOrderNo', () => {
    it('标准格式 16 位：MM + 8 日期 + 2 仓库 + 4 序号', () => {
      expect(formatOrderNo('20260620', '01', 234)).toBe('MM20260620010234');
    });

    it('序号 1 → padStart 4 位 → 0001', () => {
      expect(formatOrderNo('20260620', '01', 1)).toBe('MM20260620010001');
    });

    it('序号 9999 → 上限', () => {
      expect(formatOrderNo('20260620', '99', 9999)).toBe('MM20260620999999');
    });

    it('仓库代码 10（W10）', () => {
      expect(formatOrderNo('20260620', '10', 5)).toBe('MM20260620100005');
    });

    it('日期格式非法（7 位）抛错', () => {
      expect(() => formatOrderNo('2026062', '01', 1)).toThrow(/DATE_FORMAT/);
    });

    it('仓库代码格式非法（1 位）抛错', () => {
      expect(() => formatOrderNo('20260620', '1', 1)).toThrow(/WAREHOUSE_CODE_FORMAT/);
    });

    it('序号 0 抛错（必须 ≥1）', () => {
      expect(() => formatOrderNo('20260620', '01', 0)).toThrow(/SEQUENCE_RANGE/);
    });

    it('序号 10000 抛错（超出 9999 上限）', () => {
      expect(() => formatOrderNo('20260620', '01', 10000)).toThrow(/SEQUENCE_RANGE/);
    });

    it('序号非整数抛错', () => {
      expect(() => formatOrderNo('20260620', '01', 1.5)).toThrow(/SEQUENCE_RANGE/);
    });
  });

  describe('parseOrderNo', () => {
    it('解析标准订单号', () => {
      const r = parseOrderNo('MM20260620010234');
      expect(r.date).toBe('20260620');
      expect(r.year).toBe('2026');
      expect(r.month).toBe('06');
      expect(r.day).toBe('20');
      expect(r.warehouseCode).toBe('01');
      expect(r.warehouseFullCode).toBe('W01');
      expect(r.sequence).toBe(234);
    });

    it('解析最小序号', () => {
      const r = parseOrderNo('MM20260620010001');
      expect(r.sequence).toBe(1);
    });

    it('解析最大序号', () => {
      const r = parseOrderNo('MM20260620999999');
      expect(r.sequence).toBe(9999);
      expect(r.warehouseFullCode).toBe('W99');
    });

    it('长度非法抛错', () => {
      expect(() => parseOrderNo('MM2026062001023')).toThrow(/LENGTH/); // 15 位
    });

    it('格式非法抛错（MM 后非数字）', () => {
      expect(() => parseOrderNo('MMXXXX0606010234')).toThrow(/FORMAT/);
    });
  });

  describe('isValidOrderNo', () => {
    it('合法订单号', () => {
      expect(isValidOrderNo('MM20260620010234')).toBe(true);
    });

    it('非法：长度不对', () => {
      expect(isValidOrderNo('MM2026062001023')).toBe(false); // 15 位
      expect(isValidOrderNo('MM202606200102345')).toBe(false); // 17 位
    });

    it('非法：非 MM 开头', () => {
      expect(isValidOrderNo('XX20260620010234')).toBe(false);
    });

    it('非法：空字符串', () => {
      expect(isValidOrderNo('')).toBe(false);
    });
  });

  describe('formatOrderNo + parseOrderNo 往返一致性', () => {
    it('format → parse 往返正确', () => {
      for (let seq = 1; seq <= 10; seq++) {
        for (const wh of ['01', '05', '10', '99']) {
          const orderNo = formatOrderNo('20260620', wh, seq);
          const parsed = parseOrderNo(orderNo);
          expect(parsed.warehouseCode).toBe(wh);
          expect(parsed.sequence).toBe(seq);
          expect(parsed.date).toBe('20260620');
        }
      }
    });

    it('跨日格式化', () => {
      expect(formatOrderNo('20261231', '03', 1000)).toBe('MM20261231031000');
      expect(formatOrderNo('20270101', '03', 1)).toBe('MM20270101030001');
    });
  });

  describe('getOrderSeqKey', () => {
    it('Redis key 格式 order:seq:{date}:{wh}', () => {
      expect(getOrderSeqKey('20260620', '01')).toBe('order:seq:20260620:01');
    });

    it('仓库代码不同 key 不同', () => {
      expect(getOrderSeqKey('20260620', '01')).not.toBe(getOrderSeqKey('20260620', '02'));
    });

    it('日期不同 key 不同（跨日重置）', () => {
      expect(getOrderSeqKey('20260620', '01')).not.toBe(getOrderSeqKey('20260621', '01'));
    });
  });

  describe('ORDER_NO_REGEX / ORDER_NO_LENGTH / MAX_DAILY_SEQ', () => {
    it('ORDER_NO_REGEX 匹配合法', () => {
      expect(ORDER_NO_REGEX.test('MM20260620010234')).toBe(true);
    });

    it('ORDER_NO_LENGTH = 16', () => {
      expect(ORDER_NO_LENGTH).toBe(16);
    });

    it('MAX_DAILY_SEQ_PER_WAREHOUSE = 9999', () => {
      expect(MAX_DAILY_SEQ_PER_WAREHOUSE).toBe(9999);
    });
  });
});
