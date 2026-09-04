/**
 * WarehouseCoverageCard — 详情页·覆盖区地图卡（Codex设计 §3.5）
 *
 * 包一层 WarehouseCoverageMapEditor；编辑器经 next/dynamic ssr:false 加载
 * （Leaflet 依赖 window，SSR 不触碰），loading 骨架避免页面跳动（§4.4）。
 */
'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { GeoJsonPolygon } from '@/hooks/api/use-warehouses';
import { WAREHOUSE_MAP_HEIGHT } from '@/lib/map';

// client-only 动态加载（§1.1 / §4.10）
const WarehouseCoverageMapEditor = dynamic(
  () =>
    import('./warehouse-coverage-map-editor').then((m) => m.WarehouseCoverageMapEditor),
  {
    ssr: false,
    loading: () => <Skeleton className="w-full" style={{ height: WAREHOUSE_MAP_HEIGHT }} />,
  },
);

export interface WarehouseCoverageCardProps {
  warehouseId: string;
  center: { lat: number; lng: number };
  coverageArea?: GeoJsonPolygon | null;
  saving: boolean;
  onSave: (input: { coverageArea: GeoJsonPolygon }) => Promise<void>;
  error?: string | null;
}

export function WarehouseCoverageCard({
  warehouseId,
  center,
  coverageArea,
  saving,
  onSave,
  error,
}: WarehouseCoverageCardProps) {
  const t = useTranslations('common');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('w.warehouses.cardCoverageTitle')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('w.warehouses.coverageHintImmediate')}</p>
      </CardHeader>
      <CardContent>
        <WarehouseCoverageMapEditor
          warehouseId={warehouseId}
          center={center}
          initialCoverage={coverageArea ?? null}
          saving={saving}
          onSave={onSave}
          error={error}
        />
      </CardContent>
    </Card>
  );
}
