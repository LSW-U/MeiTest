/**
 * Home Service 测试 — 首页活动入口（PromoDock，路线 A 配置接口）
 *
 * 覆盖 listEntries：排序 / 过滤 ACTIVE / 剥离 status / 字段齐全 / theme 枚举不传 hex / 空数组合法
 * 零 DB 依赖（读代码常量），无需 mock db。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { HomeService } from '../src/modules/home/home.service';
import type { HomeEntryData } from '../src/modules/home/home.entries';

describe('HomeService', () => {
  let service: HomeService;

  beforeEach(() => {
    service = new HomeService();
  });

  it('listEntries 按 sortOrder 升序返回', async () => {
    const result = await service.listEntries();
    const orders = result.map((e) => e.sortOrder);
    const sorted = [...orders].sort((a, b) => a - b);
    expect(orders).toEqual(sorted);
  });

  it('listEntries 过滤 status=INACTIVE（不返下架入口）', async () => {
    const source: HomeEntryData[] = [
      { id: 'a', titleKey: 't.a', icon: 'i', theme: 'deals', link: '/a', sortOrder: 1, status: 'ACTIVE' },
      { id: 'b', titleKey: 't.b', icon: 'i', theme: 'coupons', link: '/b', sortOrder: 2, status: 'INACTIVE' },
    ];
    const result = await service.listEntries(source);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('listEntries 剥离 status 字段（client 不需要配置层开关）', async () => {
    const result = await service.listEntries();
    result.forEach((e) => {
      expect(e).not.toHaveProperty('status');
    });
  });

  it('listEntries 字段齐全（id/titleKey/icon/theme/link/sortOrder）', async () => {
    const result = await service.listEntries();
    expect(result.length).toBeGreaterThan(0);
    result.forEach((e) => {
      expect(e).toHaveProperty('id');
      expect(e).toHaveProperty('titleKey');
      expect(e).toHaveProperty('icon');
      expect(e).toHaveProperty('theme');
      expect(e).toHaveProperty('link');
      expect(e).toHaveProperty('sortOrder');
    });
  });

  it('listEntries theme 是枚举（deals/coupons/delivery/points），不传 hex 色值', async () => {
    const result = await service.listEntries();
    const validThemes = ['deals', 'coupons', 'delivery', 'points'];
    result.forEach((e) => {
      expect(validThemes).toContain(e.theme);
      expect(e.theme).not.toMatch(/^#/);
    });
  });

  it('listEntries 空数组合法（返 []）', async () => {
    const result = await service.listEntries([]);
    expect(result).toEqual([]);
  });

  it('默认常量返 4 个入口（PromoDock 常驻 4 入口）', async () => {
    const result = await service.listEntries();
    expect(result).toHaveLength(4);
  });

  it('默认常量 id 与 theme 对齐（deals/coupons/delivery/points），link 已治理非空', async () => {
    const result = await service.listEntries();
    result.forEach((e) => {
      expect(e.id).toBe(e.theme);
      expect(e.link).toBeTruthy();
    });
  });
});
