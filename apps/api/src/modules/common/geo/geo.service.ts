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
 * 不做：
 *   - 不缓存（Nominatim Usage Policy 允许但不强制；地址输入多样化，缓存命中率低）
 *   - 不限频（前端调用频次低，单用户日均 < 5 次）
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

/** 东帝汶 Dili 中心坐标（fallback 用） */
const DILI_FALLBACK = {
  lat: -8.5567,
  lng: 125.5595,
  formattedAddress: 'Dili, Timor-Leste (fallback)',
};

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_TIMEOUT_MS = 5000;
const USER_AGENT = 'MeiMart/0.3 (dev; contact: admin@meimart.dev)';

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  /**
   * 地址 → 经纬度
   *
   * 失败/无结果不抛错，返回 Dili fallback（业务上保证地址可保存，地理编码是辅助信息）
   */
  async geocode(address: string): Promise<GeocodeResult> {
    const trimmed = address.trim();
    if (trimmed.length < 2 || trimmed.length > 500) {
      // 入参校验已在 controller 用 zod 做过，这里再兜底
      this.logger.warn(`geocode address length invalid: ${trimmed.length}`);
      return { ...DILI_FALLBACK, source: 'fallback', formattedAddress: null };
    }

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
        this.logger.warn(`nominatim HTTP ${res.status}: ${await res.text().catch(() => '')}`);
        return { ...DILI_FALLBACK, source: 'fallback', formattedAddress: null };
      }

      const data = (await res.json()) as NominatimResult[];
      if (!Array.isArray(data) || data.length === 0) {
        this.logger.warn(`nominatim no result for: ${trimmed.slice(0, 50)}`);
        return { ...DILI_FALLBACK, source: 'fallback', formattedAddress: null };
      }

      const hit = data[0];
      const lat = parseFloat(hit.lat);
      const lng = parseFloat(hit.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        this.logger.warn(`nominatim invalid lat/lng: lat=${hit.lat} lon=${hit.lon}`);
        return { ...DILI_FALLBACK, source: 'fallback', formattedAddress: null };
      }

      return {
        lat,
        lng,
        source: 'nominatim',
        formattedAddress: hit.display_name,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`geocode error for "${trimmed.slice(0, 50)}": ${msg}`);
      return { ...DILI_FALLBACK, source: 'fallback', formattedAddress: null };
    }
  }
}
