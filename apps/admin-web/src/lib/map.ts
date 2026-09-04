/**
 * 地图常量（批 C1，Codex设计 §1.1 / §4.8）
 *
 * 瓦片源实测（2026-09-03，任务书 Q3/S3 定稿）：
 * - tile.openstreetmap.de 可达（默认）
 * - tile.openstreetmap.org 本机连接被重置；Carto 超时
 * 做成可配置常量，后续可通过 env 或替换常量切换底图。
 *
 * 注意：本模块被 client-only 动态加载的地图编辑器引用，
 * 但常量本身无副作用，SSR 安全。
 */

/** OSM 标准瓦片（de 镜像，本机可达） */
export const WAREHOUSE_MAP_TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL ?? 'https://tile.openstreetmap.de/{z}/{x}/{y}.png';

export const WAREHOUSE_MAP_ATTRIBUTION = '&copy; OpenStreetMap contributors';

/** 默认中心 zoom（有覆盖区时 fitBounds 后最大 zoom 见 Codex设计 §1.1） */
export const WAREHOUSE_MAP_ZOOM = 14;
export const WAREHOUSE_MAP_MAX_FIT_ZOOM = 17;

/** 地图容器高度（Codex设计 §3.5：min(58vh, 480px)） */
export const WAREHOUSE_MAP_HEIGHT = 'min(58vh, 480px)';
