/**
 * Geo Module — 地址 geocoding（W7 P0-3）
 *
 * 公开 endpoint：GET /api/v1/common/geo/geocode?address=xxx
 * Service 调 Nominatim OpenStreetMap，失败 fallback Dili 中心坐标。
 */
import { Module } from '@nestjs/common';
import { GeoService } from './geo.service';
import { GeoController } from './geo.controller';

@Module({
  controllers: [GeoController],
  providers: [GeoService],
  exports: [GeoService],
})
export class GeoModule {}
