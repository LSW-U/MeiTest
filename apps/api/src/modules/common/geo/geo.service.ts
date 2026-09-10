/**
 * Geo Service — 地址 → 经纬度 geocoding（W7 P0-3）
 *
 * 方案 A（后端 geocoding）：客户端保存地址时传 address 字符串，后端调 Nominatim 补 lat/lng。
 *
 * 设计要点：
 *   - 调 Nominatim OpenStreetMap 公共 API（免费，无 key），按 Nominatim Usage Policy
 *     必传 User-Agent + Accept-Language
 *   - 5s 超时，失败/无结果 → fallback 东帝汶 Dili 中心坐标（-8.5567, 125.5595）
 *   - source 字段标识来源，前端可展示"已定位"/"默认位置"提示
 *
 * 保证金批A A7（2026-09-10）：
 *   - geocode 加内存 LRU 缓存（key=归一化地址，TTL 5min，上限 500 条）
 *   - 新增 suggest()：Nominatim 多候选（limit=5，viewbox 限定东帝汶，照抄 client geocode.ts 先例）
 *   - 新增 nearby()：Overpass 坐标 2km 内带名称节点（client fetchNearbyPlaces 逻辑收进后端）
 *
 * 日志策略（W7-fix P2-1）：
 *   - 不记用户地址明文（PII），只记 addressLen + 来源
 *   - 结构化日志 { msg, ... } 而非字符串拼接
 */
import { Injectable, Logger } from '@nestjs/common';

/** Nominatim 返回单条结果（仅取我们关心的字段） */
interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

/** Geocoding 返回值 */
export interface GeocodeResult {
  lat: number;
  lng: number;
  source: 'nominatim' | 'fallback';
  formattedAddress: string | null;
}

/** suggest 单条候选（契约 GeoSuggestHit：与 client GeoHit 同形态） */
export interface GeoSuggestHit {
  lat: number;
  lng: number;
  label: string;
}

/** nearby 单条结果（契约 GeoNearbyPlace：client NearbyPlaceResult 同形态） */
export interface GeoNearbyPlace {
  id: string;
  name: string;
  distanceM: number;
  lat: number;
  lng: number;
}

/** 东帝汶 Dili 中心坐标（fallback 用） */
const DILI_FALLBACK = {
  lat: -8.5567,
  lng: 125.5595,
  formattedAddress: 'Dili, Timor-Leste (fallback)',
};

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const NOMINATIM_TIMEOUT_MS = 5000;
// P3-4（批A 审查 2026-09-10）：Overpass 公共实例高峰常超 5s，fetch abort 与
// query 声明 [timeout:10] 对齐用独立 10s，避免频繁 abort 空列表
const OVERPASS_TIMEOUT_MS = 10_000;
const USER_AGENT = 'MeiMart/0.3 (dev; contact: admin@meimart.dev)';

// ===== A7 缓存（geocode 内存 LRU：key=归一化地址，TTL 5min，上限 500 条）=====

const GEO_CACHE_TTL_MS = 5 * 60_000;
const GEO_CACHE_MAX = 500;

/** LRU 条目：值 + 写入时间 */
interface GeoCacheEntry {
  value: GeocodeResult;
  at: number;
}

/** 归一化：trim + 折叠空白 + 小写（同地址不同写法尽量命中同一条） */
function normalizeAddressKey(address: string): string {
  return address.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 简易 LRU Map：Map 保持插入序，命中/写入时移到末尾，超容量淘汰最旧（头部）。
 * 单进程内存级（MVP 单实例够用；多实例各自缓存可接受——Nominatim 只要求友好限频）。
 */
const geoCache = new Map<string, GeoCacheEntry>();

function geoCacheGet(key: string, now: number): GeocodeResult | null {
  const entry = geoCache.get(key);
  if (!entry) return null;
  if (now - entry.at >= GEO_CACHE_TTL_MS) {
    geoCache.delete(key);
    return null;
  }
  // 刷新 LRU 位次（移到末尾）
  geoCache.delete(key);
  geoCache.set(key, entry);
  return entry.value;
}

function geoCacheSet(key: string, value: GeocodeResult, now: number): void {
  geoCache.delete(key); // 防重复 key 时旧条目占位
  geoCache.set(key, { value, at: now });
  if (geoCache.size > GEO_CACHE_MAX) {
    // 淘汰最旧（Map 首条）
    const oldest = geoCache.keys().next().value;
    if (oldest !== undefined) geoCache.delete(oldest);
  }
}

/** 单测注入入口：清空 geocode 缓存 */
export function clearGeoCacheForTest(): void {
  geoCache.clear();
}

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  /**
   * 地址 → 经纬度
   *
   * 失败/无结果不抛错，返回 Dili fallback（业务上保证地址可保存，地理编码是辅助信息）
   * A7：缓存命中直接返回（不回源 Nominatim）；fallback 结果也缓存（防打爆）
   */
  async geocode(address: string): Promise<GeocodeResult> {
    const trimmed = address.trim();
    if (trimmed.length < 2 || trimmed.length > 500) {
      this.logger.warn({
        msg: 'GEOCODE_ADDRESS_LENGTH_INVALID',
        addressLen: trimmed.length,
      });
      return { ...DILI_FALLBACK, source: 'fallback', formattedAddress: null };
    }

    // A7 缓存：命中不回源
    const now = Date.now();
    const cacheKey = normalizeAddressKey(trimmed);
    const cached = geoCacheGet(cacheKey, now);
    if (cached) return cached;

    const result = await this.geocodeUncached(trimmed);
    geoCacheSet(cacheKey, result, now);
    return result;
  }

  /** 真实回源路径（geocode 缓存 miss 时调用；suggest/nearby 不走 geocode 缓存） */
  private async geocodeUncached(trimmed: string): Promise<GeocodeResult> {
    try {
      const url = `${NOMINATIM_ENDPOINT}?format=json&limit=1&q=${encodeURIComponent(trimmed)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'en',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn({
          msg: 'NOMINATIM_HTTP_ERROR',
          status: res.status,
          bodyLen: body.length,
        });
        return { ...DILI_FALLBACK, source: 'fallback', formattedAddress: null };
      }

      const data = (await res.json()) as NominatimResult[];
      if (!Array.isArray(data) || data.length === 0) {
        this.logger.warn({
          msg: 'NOMINATIM_NO_RESULT',
          addressLen: trimmed.length,
        });
        return { ...DILI_FALLBACK, source: 'fallback', formattedAddress: null };
      }

      const hit = data[0];
      const lat = parseFloat(hit.lat);
      const lng = parseFloat(hit.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        this.logger.warn({
          msg: 'NOMINATIM_INVALID_COORDS',
          rawLat: hit.lat,
          rawLon: hit.lon,
        });
        return { ...DILI_FALLBACK, source: 'fallback', formattedAddress: null };
      }

      return {
        lat,
        lng,
        source: 'nominatim',
        formattedAddress: hit.display_name,
      };
    } catch (e) {
      this.logger.warn({
        msg: 'GEOCODE_ERROR',
        addressLen: trimmed.length,
        error: e instanceof Error ? e.message : String(e),
      });
      return { ...DILI_FALLBACK, source: 'fallback', formattedAddress: null };
    }
  }

  /**
   * 关键词 → 多候选列表（A7，2026-09-10）
   *
   * Nominatim search limit=5 + viewbox 限定东帝汶（照抄 client geocode.ts TL_VIEWBOX 先例，
   * 避免同名地点干扰）。失败不抛错 → 空列表（suggest 是辅助输入，空态前端自行处理）。
   */
  async suggest(query: string): Promise<GeoSuggestHit[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2 || trimmed.length > 500) {
      this.logger.warn({ msg: 'GEO_SUGGEST_QUERY_LENGTH_INVALID', addressLen: trimmed.length });
      return [];
    }

    try {
      const url =
        `${NOMINATIM_ENDPOINT}?format=jsonv2&limit=5&addressdetails=0` +
        `&viewbox=${GEO_TL_VIEWBOX}&bounded=1&q=${encodeURIComponent(trimmed)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        this.logger.warn({ msg: 'GEO_SUGGEST_HTTP_ERROR', status: res.status });
        return [];
      }
      const rows = (await res.json()) as NominatimResult[];
      if (!Array.isArray(rows)) return [];
      return rows
        .map((r) => ({
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
          label: r.display_name ?? '',
        }))
        .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng) && h.label);
    } catch (e) {
      this.logger.warn({
        msg: 'GEO_SUGGEST_ERROR',
        addressLen: trimmed.length,
        error: e instanceof Error ? e.message : String(e),
      });
      return [];
    }
  }

  /**
   * 坐标 → 附近带名称地点（A7，2026-09-10）
   *
   * Overpass 查坐标 2km 内带名称节点（client fetchNearbyPlaces 逻辑收进后端），
   * Haversine 按距离升序取前 5。失败不抛错 → 空列表。
   */
  async nearby(lat: number, lng: number): Promise<GeoNearbyPlace[]> {
    try {
      const query = `[out:json][timeout:10];node(around:2000,${lat},${lng})["name"];out center 20;`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
      const res = await fetch(OVERPASS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        this.logger.warn({ msg: 'GEO_NEARBY_HTTP_ERROR', status: res.status });
        return [];
      }
      const data = (await res.json()) as {
        elements?: { id: number; lat: number; lon: number; tags?: { name?: string } }[];
      };
      return (data.elements ?? [])
        .filter((e) => e.tags?.name && Number.isFinite(e.lat) && Number.isFinite(e.lon))
        .map((e) => ({
          id: `osm-${e.id}`,
          name: e.tags?.name ?? '',
          distanceM: distanceMeters(lat, lng, e.lat, e.lon),
          lat: e.lat,
          lng: e.lon,
        }))
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, 5);
    } catch (e) {
      this.logger.warn({
        msg: 'GEO_NEARBY_ERROR',
        error: e instanceof Error ? e.message : String(e),
      });
      return [];
    }
  }
}

/** 东帝汶 bounding box（left,top,right,bottom；与 client geocode.ts 同值，A7 suggest 用） */
const GEO_TL_VIEWBOX = '123.9,-10.6,127.5,-7.9';

/** Haversine 距离（米，四舍五入整数；与 client geocode.ts 同公式） */
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}
