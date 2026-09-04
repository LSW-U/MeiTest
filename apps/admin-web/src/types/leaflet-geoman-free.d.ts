/**
 * @geoman-io/leaflet-geoman-free 类型 shim（批 C1）
 *
 * 该包不带官方 TS 类型，这里只声明批 C1 用到的最小 API 面：
 * - map.pm.removeControls() 隐藏默认工具栏（§4.1 自定义按钮）
 * - map.pm.enableDraw/disableDraw 多边形绘制
 * - layer.pm.enable/disable 顶点编辑
 * 事件（pm:create / pm:edit / pm:update / pm:remove）走 Leaflet 通用 on(type: string) 重载。
 */
import 'leaflet';

declare module 'leaflet' {
  interface GeomanDrawOptions {
    allowSelfIntersection?: boolean;
    continueDrawing?: boolean;
  }

  interface Geoman {
    removeControls(): void;
    enableDraw(shape: 'Polygon' | 'Line' | 'Marker' | 'Rectangle' | 'Circle' | 'Cut', options?: GeomanDrawOptions): void;
    disableDraw(): void;
    enable(options?: Record<string, unknown>): void;
    disable(): void;
  }

  interface Map {
    pm: Geoman;
  }

  interface Path {
    pm: Geoman;
  }
}
