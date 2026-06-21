/**
 * Google Maps 实现 — Stub（W6 切真实）
 *
 * 决策依据：CLAUDE.md §测试阶段支付方案 + 本地化清单 §二
 *   - 测试阶段：Google Maps key 未申请，返回固定假数据（Dili 中心区域）
 *   - W6 申请 key 后切真实 API（接口不变）
 *
 * 日志标 [GMAPS_STUB]
 */
import type {
  MapClient,
  GeocodeResult,
  ReverseGeocodeInput,
  DistanceResult,
} from './map-client';
import { logger } from '../../shared/logger/logger';

const STUB_TAG = '[GMAPS_STUB]';

// Dili 中心坐标（用于 stub 地址匹配）
const DILI_CENTER = { lat: -8.5568, lng: 125.56 };
const DILI_ADDRESS = 'Dili, Timor-Leste';

export class GoogleMapsStubClient implements MapClient {
  readonly isMock = true;

  async geocode(address: string): Promise<GeocodeResult[]> {
    logger.info(`${STUB_TAG} geocode address="${address}" → Dili center (stub)`);
    return [
      {
        ...DILI_CENTER,
        formattedAddress: address || DILI_ADDRESS,
      },
    ];
  }

  async reverseGeocode(input: ReverseGeocodeInput): Promise<GeocodeResult[]> {
    logger.info(
      `${STUB_TAG} reverseGeocode lat=${input.lat} lng=${input.lng} → formatted Dili address (stub)`,
    );
    return [
      {
        lat: input.lat,
        lng: input.lng,
        formattedAddress: `${input.lat.toFixed(4)}, ${input.lng.toFixed(4)} (near ${DILI_ADDRESS})`,
      },
    ];
  }

  async estimateDistance(
    from: ReverseGeocodeInput,
    to: ReverseGeocodeInput,
  ): Promise<DistanceResult> {
    // Haversine 公式计算直线距离
    const R = 6371000; // 地球半径（米）
    const dLat = ((to.lat - from.lat) * Math.PI) / 180;
    const dLng = ((to.lng - from.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((from.lat * Math.PI) / 180) *
        Math.cos((to.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const straightMeters = Math.round(R * c);

    // 假设平均配送速度 25 km/h（≈7m/s）
    const etaSeconds = Math.round(straightMeters / 7);

    logger.info(
      `${STUB_TAG} estimateDistance straightMeters=${straightMeters} etaSeconds=${etaSeconds}`,
    );
    return { straightMeters, etaSeconds };
  }
}

/**
 * 真实 Google Maps Client（W6 启用）
 *
 * TODO W6：申请 Google Maps API key 后用 @googlemaps/google-maps-services-js 实现
 * 现在导出 stub 实例。
 */
export const mapClient: MapClient = new GoogleMapsStubClient();
