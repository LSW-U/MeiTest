/**
 * WarehouseCoverageMapEditor — 覆盖区地图编辑器（批 C1，Codex设计 §4）
 *
 * Leaflet + @geoman-io/leaflet-geoman-free（npm 实名，任务书 @geoman-io/leaflet-geoman 同库）。
 * 本模块仅经父级 next/dynamic ssr:false 加载（client-only），SSR 不触碰 window。
 *
 * 交互：
 * - 隐藏 Geoman 默认工具栏，页面自定义按钮调用能力；只允许多边形
 * - 中心 marker 只展示不拖动；覆盖区只保存单个 GeoJSON Polygon（非 Multi）
 * - 撤销 = geometry 快照栈；重置 = 回到服务端 initialCoverage（dirty 时先确认）
 * - 高级 JSON 默认折叠，以「从地图读取 / 应用到地图」显式同步，不做双向实时绑定
 * - 保存前确认弹窗 → PATCH /:id/coverage（onSave 由父级 mutation 提供）
 * - tile-error 不阻塞编辑；library-error 才显示 ErrorState（mapKey 重挂载）
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
// 值导入：本模块仅经父级 next/dynamic ssr:false 加载，client-only，SSR 不触碰 window
import * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
// geoman 是 side-effect import（扩展 Leaflet 原型），必须在 leaflet 之后
import '@geoman-io/leaflet-geoman-free';
import { useTranslations } from 'next-intl';
import {
  Code2,
  MoveVertical,
  PenTool,
  RotateCcw,
  Save,
  Trash2,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import {
  WAREHOUSE_MAP_ATTRIBUTION,
  WAREHOUSE_MAP_HEIGHT,
  WAREHOUSE_MAP_MAX_FIT_ZOOM,
  WAREHOUSE_MAP_TILE_URL,
  WAREHOUSE_MAP_ZOOM,
} from '@/lib/map';
import type { GeoJsonPolygon } from '@/hooks/api/use-warehouses';

/** 事件快照 debounce（ms） */
const SNAPSHOT_DEBOUNCE_MS = 200;

/** 快照栈上限（防长会话无限增长） */
const HISTORY_MAX = 50;

/**
 * 坐标容差比较键（6 位小数 ≈ 0.1m，审查 P2-2）：
 * 服务端回读 ST_AsGeoJSON 默认 9 位小数，geoman 产出全精度 double，
 * JSON 严格比较会让保存成功后 dirty 恒 true 永不收敛——数值圆整后比较。
 */
function ringKey(ring: number[][] | undefined): string {
  if (!Array.isArray(ring)) return '';
  return ring.map(([lng, lat]) => `${Math.round(lng * 1e6)}:${Math.round(lat * 1e6)}`).join(';');
}

/** 深比较两个 Polygon（数值容差） */
function samePolygon(a: GeoJsonPolygon | null, b: GeoJsonPolygon | null): boolean {
  if ((a === null) !== (b === null)) return false;
  if (!a || !b) return true;
  if (a.type !== b.type || a.coordinates.length !== b.coordinates.length) return false;
  return ringKey(a.coordinates[0]) === ringKey(b.coordinates[0]);
}

/** Polygon 校验（Codex设计 §4.5）：单 ring、≥4 点、闭合、坐标合法 */
export function isValidCoverage(c: unknown): c is GeoJsonPolygon {
  if (!c || typeof c !== 'object') return false;
  const p = c as GeoJsonPolygon;
  if (p.type !== 'Polygon' || !Array.isArray(p.coordinates) || p.coordinates.length !== 1) {
    return false;
  }
  const ring = p.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const [first] = ring;
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) return false;
  return ring.every(
    (pt) =>
      Array.isArray(pt) &&
      pt.length >= 2 &&
      Number.isFinite(pt[0]) &&
      Number.isFinite(pt[1]) &&
      pt[1] >= -90 &&
      pt[1] <= 90 && // lat
      pt[0] >= -180 &&
      pt[0] <= 180, // lng
  );
}

/** 保存前自动闭合 ring（§4.5） */
function closeRing(p: GeoJsonPolygon): GeoJsonPolygon {
  const ring = p.coordinates[0];
  const [first] = ring;
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return p;
  return { type: 'Polygon', coordinates: [[...ring, first]] };
}

export interface WarehouseCoverageMapEditorProps {
  warehouseId: string;
  center: { lat: number; lng: number };
  initialCoverage?: GeoJsonPolygon | null;
  saving: boolean;
  /** 父级 mutation（PATCH /:id/coverage + toast + query invalidate） */
  onSave: (input: { coverageArea: GeoJsonPolygon }) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  /** 父级 mutation 错误信息（卡片内联展示） */
  error?: string | null;
  className?: string;
}

export function WarehouseCoverageMapEditor({
  center,
  initialCoverage = null,
  saving,
  onSave,
  onDirtyChange,
  error,
  className,
}: WarehouseCoverageMapEditorProps) {
  const t = useTranslations('common');

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layerRef = useRef<Leaflet.Polygon | null>(null);
  const historyRef = useRef<string[]>([]); // geometry JSON 快照栈
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // geoRef 初始即含服务端覆盖区：init effect 早于 initialSignature 同步 effect 执行
  const [geo, setGeo] = useState<GeoJsonPolygon | null>(() =>
    isValidCoverage(initialCoverage) ? initialCoverage : null,
  );
  const geoRef = useRef<GeoJsonPolygon | null>(geo);

  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [mapKey, setMapKey] = useState(0);

  const setGeometry = useCallback((next: GeoJsonPolygon | null) => {
    geoRef.current = next;
    setGeo(next);
  }, []);

  // dirty 派生：当前 geometry ≠ 服务端 initialCoverage（免维护独立 dirty 标志）
  const initialValid = isValidCoverage(initialCoverage);
  const dirty = !samePolygon(geo, initialValid ? initialCoverage : null);
  const valid = geo === null || isValidCoverage(geo);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  /** 服务端 initialCoverage 变化（保存成功 invalidate / 外部更新）且本地无改动 → 同步回显 */
  const initialSignature = JSON.stringify(initialCoverage ?? null);
  useEffect(() => {
    if (dirty) return;
    const next = (JSON.parse(initialSignature) as GeoJsonPolygon | null) ?? null;
    if (samePolygon(geoRef.current, next)) return;
    // 重渲染图层（组件已 ready 场景，如保存成功后回显）
    if (mapRef.current) {
      renderPolygon(next);
    }
    setGeometry(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSignature]);

  /** 退出绘制/编辑态（undo/reset/应用 JSON 前必须先退，Codex设计 §4.5） */
  const exitModes = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.pm.disableDraw();
    layerRef.current?.pm.disable();
    setDrawing(false);
    setEditing(false);
  }, []);

  /** 用 geometry 渲染图层（替换旧图层并挂编辑监听） */
  const renderPolygon = useCallback(
    (next: GeoJsonPolygon | null) => {
      const map = mapRef.current;
      const L = Leaflet;
      if (!map) return;
      if (layerRef.current) {
        layerRef.current.pm.disable();
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      if (!next) return;
      const ring = next.coordinates[0].map(([lng, lat]) => [lat, lng]) as [number, number][];
      const layer = L.polygon(ring).addTo(map);
      layer.on('pm:edit pm:update', () => {
        // 拖点/移动实时同步 React 态（derived dirty + 顶点数）
        if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
        snapshotTimerRef.current = setTimeout(() => {
          const gj = (layer.toGeoJSON() as GeoJSON.Feature).geometry as unknown as GeoJsonPolygon;
          setGeometry(closeRing(gj));
        }, SNAPSHOT_DEBOUNCE_MS);
      });
      layerRef.current = layer;
    },
    [setGeometry],
  );

  /** 快照入栈（同一 geometry 跳过，§4.5；上限 HISTORY_MAX） */
  const pushHistory = useCallback((snapshot: GeoJsonPolygon | null) => {
    const s = JSON.stringify(snapshot ?? null);
    if (historyRef.current[historyRef.current.length - 1] === s) return;
    historyRef.current.push(s);
    if (historyRef.current.length > HISTORY_MAX) historyRef.current.shift();
  }, []);

  // —— 地图初始化（mapKey 变化重挂载；map instance 只进 ref 不进 state）——
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let map: Leaflet.Map | null = null;
    try {
      const L = Leaflet;
      map = L.map(container, { center: [center.lat, center.lng], zoom: WAREHOUSE_MAP_ZOOM });
      mapRef.current = map;
      // 隐藏 Geoman 默认工具栏（自定义按钮，§4.1）
      map.pm.removeControls();
      // 底图（可配置常量 lib/map.ts）；tile 失败只提示不阻塞编辑（§4.8）
      L.tileLayer(WAREHOUSE_MAP_TILE_URL, {
        attribution: WAREHOUSE_MAP_ATTRIBUTION,
        maxZoom: 19,
      })
        .on('tileerror', () => setTileError(true))
        .addTo(map);
      // 中心 marker：只展示不拖动（§4.1）
      L.marker([center.lat, center.lng], { draggable: false, interactive: true })
        .bindTooltip(t('w.warehouses.coverageCenterTooltip'))
        .addTo(map);

      map.on('pm:create', (e: Leaflet.LeafletEvent) => {
        map?.pm.disableDraw();
        setDrawing(false);
        pushHistory(geoRef.current);
        const layer = (e as unknown as { layer: Leaflet.Polygon }).layer;
        layerRef.current = layer;
        layer.on('pm:edit pm:update', () => {
          if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
          snapshotTimerRef.current = setTimeout(() => {
            const gj = (layer.toGeoJSON() as GeoJSON.Feature).geometry as unknown as GeoJsonPolygon;
            setGeometry(closeRing(gj));
          }, SNAPSHOT_DEBOUNCE_MS);
        });
        const gj = (layer.toGeoJSON() as GeoJSON.Feature).geometry as unknown as GeoJsonPolygon;
        setGeometry(closeRing(gj));
      });
      map.on('pm:drawend', () => setDrawing(false));

      // 初始覆盖区回显 + fitBounds（有覆盖区时最大 zoom 17，§1.1）
      const initial = geoRef.current;
      if (initial) {
        const ring = initial.coordinates[0].map(([lng, lat]) => [lat, lng]) as [number, number][];
        const layer = L.polygon(ring).addTo(map);
        layerRef.current = layer;
        map.fitBounds(layer.getBounds(), { maxZoom: WAREHOUSE_MAP_MAX_FIT_ZOOM });
      }
      setReady(true);
    } catch {
      setInitError(true);
      setReady(false);
    }
    return () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      if (map) map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // center/t 只认首次挂载（Codex设计 §4.10：initialCoverage 不作为重初始化依赖）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey]);

  // —— 工具栏行为（Codex设计 §4.3）——
  const startDraw = () => {
    const map = mapRef.current;
    if (!map || geo) return;
    map.pm.enableDraw('Polygon', { allowSelfIntersection: false });
    setDrawing(true);
  };

  const toggleEdit = () => {
    const layer = layerRef.current;
    if (!layer) return;
    if (editing) {
      layer.pm.disable();
      setEditing(false);
    } else {
      layer.pm.enable();
      setEditing(true);
    }
  };

  const deleteCoverage = () => {
    const map = mapRef.current;
    if (!map || !geo) return;
    pushHistory(geo);
    exitModes();
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    setGeometry(null);
  };

  const undo = () => {
    const prev = historyRef.current.pop();
    if (prev === undefined) return;
    exitModes();
    const next = JSON.parse(prev) as GeoJsonPolygon | null;
    renderPolygon(next);
    setGeometry(next);
  };

  const reset = () => {
    exitModes();
    historyRef.current = [];
    const next = initialValid ? initialCoverage : null;
    renderPolygon(next);
    setGeometry(next);
    setResetConfirmOpen(false);
  };

  const handleSave = async () => {
    if (!geo || !isValidCoverage(geo)) return;
    setConfirmOpen(false);
    // 审查 P2-1：onSave 失败会 rethrow（父级已 toast）；dirty 为派生态，
    // 失败时 geo 不变 → dirty 保持 true，编辑不丢；成功由 query invalidate 回显复位
    try {
      await onSave({ coverageArea: closeRing(geo) });
    } catch {
      // 失败：保持当前几何与 dirty
    }
  };

  // —— 高级 JSON（§4.6：显式读取/应用，不做双向实时绑定）——
  const readJsonFromMap = () => {
    setJsonError(null);
    setJsonText(geo ? JSON.stringify(geo, null, 2) : '');
  };

  const applyJsonToMap = () => {
    try {
      const parsed = JSON.parse(jsonText) as GeoJsonPolygon;
      if (!isValidCoverage(parsed)) {
        setJsonError(t('w.warehouses.coverageInvalid'));
        return;
      }
      pushHistory(geo);
      exitModes();
      const closed = closeRing(parsed);
      renderPolygon(closed);
      setGeometry(closed);
      setJsonError(null);
      setJsonOpen(false);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  };

  // 撤销可用：有历史快照；绘制中不可点其它按钮
  const canUndo = historyRef.current.length > 0;
  const vertexCount = geo ? geo.coordinates[0].length - 1 : 0;

  return (
    <div className={className}>
      {/* 工具栏（§4.2） */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={startDraw}
          disabled={ready && (!!geo || drawing)}
        >
          <PenTool className="mr-1.5 h-3.5 w-3.5" />
          {t('w.warehouses.coverageDraw')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={toggleEdit}
          disabled={!ready || !geo}
          className={editing ? 'border-primary' : undefined}
        >
          <MoveVertical className="mr-1.5 h-3.5 w-3.5" />
          {t('w.warehouses.coverageEditVertices')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={deleteCoverage} disabled={!ready || !geo}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          {t('w.warehouses.coverageDelete')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={undo} disabled={!canUndo}>
          <Undo2 className="mr-1.5 h-3.5 w-3.5" />
          {t('w.warehouses.coverageUndo')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => (dirty ? setResetConfirmOpen(true) : reset())}
          disabled={!ready}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          {t('w.warehouses.coverageReset')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setJsonOpen((v) => !v)}
          disabled={!ready}
        >
          <Code2 className="mr-1.5 h-3.5 w-3.5" />
          {t('w.warehouses.coverageAdvancedTitle')}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          disabled={!ready || !dirty || !valid || geo === null || saving}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {saving ? t('w.form.saving') : t('w.warehouses.coverageSave')}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {geo && (
            <Badge variant="secondary">
              {t('w.warehouses.coverageVertexCount', { count: vertexCount })}
            </Badge>
          )}
          {dirty ? (
            <Badge variant="warning">{t('w.warehouses.coverageDirty')}</Badge>
          ) : (
            initialValid && <Badge variant="success">{t('w.warehouses.coverageSavedState')}</Badge>
          )}
        </div>
      </div>

      {/* 底图错误条（不阻塞编辑，§4.8） */}
      {tileError && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          {t('w.warehouses.coverageTileError')}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-2"
            onClick={() => setMapKey((k) => k + 1)}
          >
            {t('w.warehouses.coverageRetryMap')}
          </Button>
        </div>
      )}

      {/* 地图容器（固定高度，否则 Leaflet 高度为 0，§4.10） */}
      <div className="relative overflow-hidden rounded-md border" style={{ height: WAREHOUSE_MAP_HEIGHT }}>
        <div ref={containerRef} className="h-full w-full" />
        {!initError && !ready && (
          <div className="absolute inset-0 space-y-2 bg-muted/40 p-3">
            <Skeleton className="h-full w-full" />
          </div>
        )}
        {ready && geo === null && !drawing && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <EmptyState
              title={t('w.warehouses.coverageEmpty')}
              description={t('w.warehouses.coverageEmptyHint')}
            />
          </div>
        )}
      </div>

      {/* library-error：ErrorState + mapKey 重挂载（§4.4/§4.8） */}
      {initError && (
        <div className="mt-2">
          <ErrorState
            message={t('w.warehouses.coverageLibraryError')}
            onRetry={() => {
              setInitError(false);
              setTileError(false);
              setReady(false);
              setMapKey((k) => k + 1);
            }}
          />
        </div>
      )}

      {/* 高级 JSON 折叠区（默认折叠，拍板 5-A） */}
      {jsonOpen && (
        <div className="mt-3 space-y-2 rounded-md border p-3">
          <Label>{t('w.warehouses.coverageAdvancedTitle')}</Label>
          <Textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={8}
            className="font-mono text-xs"
            placeholder='{ "type": "Polygon", "coordinates": [[[lng, lat], ...]] }'
          />
          {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={readJsonFromMap}>
              {t('w.warehouses.coverageJsonFromMap')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={applyJsonToMap}>
              {t('w.warehouses.coverageJsonApply')}
            </Button>
          </div>
        </div>
      )}

      {/* 保存确认（§4.7） */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('w.warehouses.coverageConfirmTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('w.warehouses.coverageConfirmBody')}</p>
          {geo && (
            <p className="text-sm">
              {t('w.warehouses.coverageVertexCount', { count: geo.coordinates[0].length - 1 })}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              {t('w.form.cancel')}
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? t('w.form.saving') : t('w.warehouses.coverageConfirmSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置确认（dirty 时，§4.3） */}
      <Dialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('w.warehouses.coverageReset')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('w.warehouses.coverageConfirmBody')}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setResetConfirmOpen(false)}>
              {t('w.form.cancel')}
            </Button>
            <Button type="button" variant="destructive" onClick={reset}>
              {t('w.warehouses.coverageReset')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 保存失败内联错误 */}
      {error && (
        <p className="mt-2 text-sm text-destructive">{t('w.form.saveFailed', { message: error })}</p>
      )}
    </div>
  );
}
