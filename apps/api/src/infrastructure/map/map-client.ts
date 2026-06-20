/**
 * 地图/定位服务抽象
 *
 * 决策依据：CLAUDE.md §技术栈 + 本地化清单 §二
 *   - MVP：用 Google Maps Platform（个人 key，W6 申）
 *   - 测试阶段：stub 返回固定假数据（W6 切真）
 *   - 不用高德/腾讯（东帝汶覆盖差）
 *
 * 业务用途：
 *   - 地址 → 经纬度（geocode）
 *   - 经纬度 → 地址（reverseGeocode）
 *   - ETA / 距离计算（骑手配送）
 */

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

export interface ReverseGeocodeInput {
  lat: number;
  lng: number;
}

export interface DistanceResult {
  /** 直线距离（米） */
  straightMeters: number;
  /** 预估 ETA（秒） */
  etaSeconds: number;
}

export interface MapClient {
  geocode(address: string): Promise<GeocodeResult[]>;
  reverseGeocode(input: ReverseGeocodeInput): Promise<GeocodeResult[]>;
  /** 两点距离 + ETA */
  estimateDistance(from: ReverseGeocodeInput, to: ReverseGeocodeInput): Promise<DistanceResult>;
  readonly isMock: boolean;
}
