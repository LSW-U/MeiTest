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
      this.logger.warn({
        msg: 'GEOCODE_ADDRESS_LENGTH_INVALID',
        addressLen: trimmed.length,
      });
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
}
