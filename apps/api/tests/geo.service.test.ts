/**
 * GeoService 测试（W7 P0-3 + 保证金批A A7 2026-09-10）
 *
 * 覆盖：
 *   - Happy path: Nominatim 返回有效结果 → 返回 lat/lng + source=nominatim
 *   - Nominatim 返回空数组 → fallback Dili
 *   - Nominatim 返回非法 lat/lng → fallback Dili
 *   - Nominatim 网络错误 / abort → fallback Dili
 *   - 地址过短（< 2 字符） → fallback Dili（不抛错）
 *   - 地址过长（> 500 字符） → fallback Dili
 *   - A7 缓存：同地址第二次调用命中缓存不回源（fetch 仅 1 次）
 *   - A7 缓存：LRU 上限 + TTL 过期后回源
 *   - A7 suggest：多候选解析 / 失败空列表 / viewbox 限定东帝汶
 *   - A7 nearby：Overpass 解析 + 距离排序 / 失败空列表
 *
 * 关键：所有失败场景都不抛错，业务上保证地址可保存
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeoService, clearGeoCacheForTest } from '../src/modules/common/geo/geo.service';

describe('GeoService', () => {
  let service: GeoService;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    service = new GeoService();
    fetchSpy = vi.spyOn(global, 'fetch');
    clearGeoCacheForTest(); // A7：模块级缓存跨测试持久，逐测试清空
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

  // ===== A7（保证金批A 2026-09-10）：geocode 缓存 + suggest + nearby =====

  it('A7 缓存：同地址第二次调用命中缓存不回源（fetch 仅 1 次）', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify([{ lat: '-8.5567', lon: '125.5595', display_name: 'Dili, Timor-Leste' }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const first = await service.geocode('Dili, Timor-Leste');
    const second = await service.geocode('Dili, Timor-Leste'); // 同地址（归一化 key 一致）
    expect(fetchSpy).toHaveBeenCalledTimes(1); // 命中缓存不回源
    expect(second).toEqual(first);

    // 归一化：大小写/多空白差异仍命中
    const third = await service.geocode('  dili,   timor-leste ');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(third).toEqual(first);
  });

  it('A7 缓存：fallback 结果也缓存 + TTL 过期后重新回源', async () => {
    vi.useFakeTimers();
    try {
      fetchSpy.mockResolvedValue(
        new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
      const first = await service.geocode('nowhere place');
      expect(first.source).toBe('fallback');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // 5min 内命中缓存
      vi.advanceTimersByTime(4 * 60_000);
      await service.geocode('nowhere place');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // TTL 过期（5min）→ 回源
      vi.advanceTimersByTime(2 * 60_000);
      await service.geocode('nowhere place');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('A7 suggest：解析多候选（label/lat/lng）+ viewbox 限定东帝汶', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { lat: '-8.5567', lon: '125.5595', display_name: 'Dili, Timor-Leste' },
          { lat: '-8.5', lon: '125.6', display_name: 'Comoro, Dili' },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const hits = await service.suggest('Dili');
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({ lat: -8.5567, lng: 125.5595, label: 'Dili, Timor-Leste' });
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('limit=5');
    expect(url).toContain('viewbox=123.9,-10.6,127.5,-7.9');
    expect(url).toContain('bounded=1');
  });

  it('A7 suggest：失败/空结果 → 空列表（不抛错）；短 query 不回源', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    expect(await service.suggest('Dili')).toEqual([]);

    fetchSpy.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    expect(await service.suggest('Dili')).toEqual([]);

    const empty = await service.suggest('d');
    expect(empty).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // 短 query 未回源
  });

  it('A7 nearby：Overpass 结果按距离升序取前 5（Haversine）', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          elements: [
            { id: 2, lat: -8.56, lon: 125.57, tags: { name: 'Far' } },       // ~1.4km
            { id: 1, lat: -8.5570, lon: 125.5598, tags: { name: 'Near' } },  // ~几十米
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const places = await service.nearby(-8.5567, 125.5595);
    expect(places).toHaveLength(2);
    expect(places[0].name).toBe('Near');
    expect(places[0].id).toBe('osm-1');
    expect(places[0].distanceM).toBeLessThan(places[1].distanceM);
    expect(places[1].distanceM).toBeGreaterThan(1000);

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://overpass-api.de/api/interpreter');
    expect((options as RequestInit).method).toBe('POST');
  });

  it('A7 nearby：失败/空结果 → 空列表（不抛错）', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('overpass down'));
    expect(await service.nearby(-8.5567, 125.5595)).toEqual([]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(await service.nearby(-8.5567, 125.5595)).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
