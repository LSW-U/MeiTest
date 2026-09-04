/**
 * Common Module — 公共 endpoint 聚合（W7 P0-3）
 *
 * 下属：
 *   - geo: 地址 geocoding
 *   - legal: 服务条款/隐私政策正文下发（P5 #3，2026-08-25）
 *
 * 不限制 deviceType，path 前缀 /api/v1/common/* 自动放行 DeviceTypeGuard。
 */
import { Module } from '@nestjs/common';
import { GeoModule } from './geo/geo.module';
import { LegalModule } from '../legal/legal.module';

@Module({
  imports: [GeoModule, LegalModule],
  exports: [GeoModule, LegalModule],
})
export class CommonModule {}
