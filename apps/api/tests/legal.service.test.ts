/**
 * LegalService 单测（P5 #3，2026-08-25）
 *
 * 覆盖：
 *   - getActiveDoc: TERMS + zh header → 返回 zh 切片正文
 *   - getActiveDoc: PRIVACY + id header → 返回 id 切片正文
 *   - getActiveDoc: tet/pt 翻译缺失 → fallback en
 *   - getActiveDoc: 非法 docType → NotFoundException + E-LEGAL-001
 *   - getActiveDoc: 未 seed（无 active 文档）→ NotFoundException + E-LEGAL-001
 *
 * Mock prisma.legalDocument.findFirst（不依赖真实 DB）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

vi.mock('../src/shared/db', () => ({
  db: {
    legalDocument: {
      findFirst: vi.fn(),
    },
  },
}));

import { LegalService } from '../src/modules/legal/legal.service';
import { db } from '../src/shared/db';

const dbMock = db as unknown as {
  legalDocument: { findFirst: ReturnType<typeof vi.fn> };
};

describe('LegalService.getActiveDoc - P5 #3 法律文档下发', () => {
  let service: LegalService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LegalService();
  });

  const docRow = (content: Record<string, string>, docType = 'TERMS') => ({
    id: 'doc-1',
    docType,
    version: '1.0.0',
    content,
    effectiveAt: new Date('2026-08-25T00:00:00.000Z'),
    isActive: true,
    createdAt: new Date('2026-08-25T00:00:00.000Z'),
    updatedAt: new Date('2026-08-25T00:00:00.000Z'),
  });

  it('TERMS + zh header → 返回 zh 切片正文', async () => {
    dbMock.legalDocument.findFirst.mockResolvedValue(
      docRow({ en: 'EN terms', zh: '中文条款', id: 'ID', pt: 'PT' }),
    );

    const data = await service.getActiveDoc('TERMS', 'zh,en;q=0.8');

    expect(data.docType).toBe('TERMS');
    expect(data.version).toBe('1.0.0');
    expect(data.content).toBe('中文条款');
    expect(data.effectiveAt).toBe('2026-08-25T00:00:00.000Z');
    expect(dbMock.legalDocument.findFirst).toHaveBeenCalledWith({
      where: { docType: 'TERMS', isActive: true },
      orderBy: { effectiveAt: 'desc' },
    });
  });

  it('PRIVACY + id header → 返回 id 切片正文', async () => {
    dbMock.legalDocument.findFirst.mockResolvedValue(
      docRow({ en: 'EN privacy', id: 'Privasi ID' }, 'PRIVACY'),
    );

    const data = await service.getActiveDoc('PRIVACY', 'id');

    expect(data.docType).toBe('PRIVACY');
    expect(data.content).toBe('Privasi ID');
  });

  it('请求语言翻译缺失 → fallback en', async () => {
    dbMock.legalDocument.findFirst.mockResolvedValue(
      docRow({ en: 'EN only', zh: '中文' }), // 无 tet / pt
    );

    const data = await service.getActiveDoc('TERMS', 'tet');
    expect(data.content).toBe('EN only');

    const data2 = await service.getActiveDoc('TERMS', 'pt');
    expect(data2.content).toBe('EN only');
  });

  it('非法 docType（如 POLICY）→ NotFoundException + E-LEGAL-001', async () => {
    await expect(service.getActiveDoc('POLICY', 'en')).rejects.toThrow(NotFoundException);
    expect(dbMock.legalDocument.findFirst).not.toHaveBeenCalled();
    try {
      await service.getActiveDoc('POLICY', 'en');
    } catch (e) {
      const resp = (e as NotFoundException).getResponse() as { code: string };
      expect(resp.code).toBe('E-LEGAL-001');
    }
  });

  it('未 seed（无 active 文档）→ NotFoundException + E-LEGAL-001', async () => {
    dbMock.legalDocument.findFirst.mockResolvedValue(null);

    await expect(service.getActiveDoc('TERMS', 'en')).rejects.toThrow(NotFoundException);
    try {
      await service.getActiveDoc('TERMS', 'en');
    } catch (e) {
      const resp = (e as NotFoundException).getResponse() as { code: string };
      expect(resp.code).toBe('E-LEGAL-001');
    }
  });
});
