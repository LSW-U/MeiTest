/**
 * GeoService 测试（W7 P0-3）
 *
 * 覆盖：
 *   - Happy path: Nominatim 返回有效结果 → 返回 lat/lng + source=nominatim
 *   - Nominatim 返回空数组 → fallback Dili
 *   - Nominatim 返回非法 lat/lng → fallback Dili
 *   - Nominatim 网络错误 / abort → fallback Dili
 *   - 地址过短（< 2 字符） → fallback Dili（不抛错）
 *   - 地址过长（> 500 字符） → fallback Dili
 *
 * 关键：所有失败场景都不抛错，业务上保证地址可保存
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeoService } from '../src/modules/common/geo/geo.service';

describe('GeoService', () => {
  let service: GeoService;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    service = new GeoService();
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('Happy path: Nominatim 返回有效结果', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            lat: '-8.5567',
            lon: '125.5595',
            display_name: 'Dili, Timor-Leste',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await service.geocode('Dili, Timor-Leste');
    expect(result.lat).toBe(-8.5567);
    expect(result.lng).toBe(125.5595);
    expect(result.source).toBe('nominatim');
    expect(result.formattedAddress).toBe('Dili, Timor-Leste');
  });

  it('Nominatim 返回空数组 → fallback Dili', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const result = await service.geocode('nonexistent place xyz');
    expect(result.source).toBe('fallback');
    expect(result.lat).toBe(-8.5567);
    expect(result.lng).toBe(125.5595);
    expect(result.formattedAddress).toBeNull();
  });

  it('Nominatim 返回 HTTP 500 → fallback Dili', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    const result = await service.geocode('some address');
    expect(result.source).toBe('fallback');
    expect(result.formattedAddress).toBeNull();
  });

  it('Nominatim 返回非法 lat/lng → fallback Dili', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { lat: 'invalid', lon: 'invalid', display_name: 'x' },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await service.geocode('broken coords');
    expect(result.source).toBe('fallback');
  });

  it('fetch 抛错（网络） → fallback Dili', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'));

    const result = await service.geocode('some address');
    expect(result.source).toBe('fallback');
    expect(result.formattedAddress).toBeNull();
  });

  it('fetch abort（超时） → fallback Dili', async () => {
    fetchSpy.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));

    const result = await service.geocode('some address');
    expect(result.source).toBe('fallback');
  });

  it('地址过短（< 2 字符） → fallback Dili（不抛错）', async () => {
    const result = await service.geocode('a');
    expect(result.source).toBe('fallback');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('地址过长（> 500 字符） → fallback Dili', async () => {
    const longAddress = 'x'.repeat(501);
    const result = await service.geocode(longAddress);
    expect(result.source).toBe('fallback');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Nominatim 调用包含正确 User-Agent 和 query', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await service.geocode('Dili');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain('https://nominatim.openstreetmap.org/search');
    expect(url).toContain('q=Dili');
    expect(url).toContain('format=json');
    expect(url).toContain('limit=1');
    const headers = (options as RequestInit).headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/MeiMart/);
  });
});
