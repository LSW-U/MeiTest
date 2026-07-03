/**
 * Common Module — 公共 endpoint 聚合（W7 P0-3）
 *
 * 下属：
 *   - geo: 地址 geocoding
 *
 * 不限制 deviceType，path 前缀 /api/v1/common/* 自动放行 DeviceTypeGuard。
 */
import { Module } from '@nestjs/common';
import { GeoModule } from './geo/geo.module';

@Module({
  imports: [GeoModule],
  exports: [GeoModule],
})
export class CommonModule {}
