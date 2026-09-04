/**
 * use-apps — 应用中心 hooks（admin-web 优化方案 批次3 2026-08-29）
 *
 * 复用 SystemConfig 通用端点（GET /admin/platform/system-configs + PUT .../:key），
 * 仅在前端收敛「应用配置」固定 key 白名单，后端无需新增端点。
 *
 * 固定 key（与客户端/骑手 App 落地页约定）：
 *   app.client.ios.url       客户端 iOS 下载地址
 *   app.client.android.url   客户端 Android 下载地址
 *   app.client.qr            客户端下载二维码图片 URL
 *   app.client.version       客户端最新版本号
 *   app.client.changelog     客户端更新日志
 *   app.rider.ios.url        骑手 iOS 下载地址
 *   app.rider.android.url    骑手 Android 下载地址
 *   app.rider.qr             骑手下载二维码图片 URL
 *   app.rider.version        骑手最新版本号
 *   app.rider.changelog      骑手更新日志
 *
 * 设计：
 *   - useAppConfigs() 复用 useSystemConfigs() 全量列表 → 前端按 key 白名单分流到客户端/骑手两卡片
 *   - useSaveAppCard() 批量 upsert 一张卡片的所有 key（逐 key PUT，全部完成后失效缓存）
 *   - 未配置的 key 显示空态（value 为空字符串）
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';
import {
  useSystemConfigs,
  useUpdateSystemConfig,
  type SystemConfigItem,
} from './use-settings';

/** 客户端 App 固定配置 key 列表 */
export const CLIENT_APP_KEYS = [
  'app.client.ios.url',
  'app.client.android.url',
  'app.client.qr',
  'app.client.version',
  'app.client.changelog',
] as const;

/** 骑手 App 固定配置 key 列表 */
export const RIDER_APP_KEYS = [
  'app.rider.ios.url',
  'app.rider.android.url',
  'app.rider.qr',
  'app.rider.version',
  'app.rider.changelog',
] as const;

/** 全量应用配置 key 白名单（客户端 + 骑手） */
export const APP_CONFIG_KEYS = [...CLIENT_APP_KEYS, ...RIDER_APP_KEYS] as const;

export type AppConfigKey = (typeof APP_CONFIG_KEYS)[number];

/** 单个 App 配置项视图（从 SystemConfigItem 收敛） */
export interface AppConfigEntry {
  key: AppConfigKey;
  /** 当前值（未配置为空字符串） */
  value: string;
  description: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** 一张 App 卡片的完整配置（客户端或骑手） */
export interface AppConfigCard {
  /** 卡片下所有 key 的配置项 */
  entries: AppConfigEntry[];
  /** 是否全部未配置（全空 → 卡片显示空态） */
  allEmpty: boolean;
}

/**
 * 把 SystemConfigItem[] 按 key 白名单分流成客户端/骑手两张卡片。
 *
 * 未在白名单内的 SystemConfig 行忽略（SystemConfig 是通用表，可能存其他配置）。
 * 白名单内但 DB 无对应行 → 视为未配置（value='' ）。
 */
export function splitAppConfigs(
  items: SystemConfigItem[],
): { client: AppConfigCard; rider: AppConfigCard } {
  const map = new Map<string, SystemConfigItem>();
  for (const it of items) map.set(it.key, it);

  const toCard = (keys: readonly AppConfigKey[]): AppConfigCard => {
    const entries: AppConfigEntry[] = keys.map((key) => {
      const it = map.get(key);
      return {
        key,
        value: it?.value ?? '',
        description: it?.description ?? null,
        updatedAt: it?.updatedAt ?? null,
        updatedBy: it?.updatedBy ?? null,
      };
    });
    const allEmpty = entries.every((e) => !e.value);
    return { entries, allEmpty };
  };

  return { client: toCard(CLIENT_APP_KEYS), rider: toCard(RIDER_APP_KEYS) };
}

/**
 * 应用中心配置查询（复用 SystemConfig 列表，前端按白名单分流）。
 *
 * queryKey 与 use-settings 的 ['settings','system-configs'] 一致 → 设置页改值会自动失效缓存。
 */
export function useAppConfigs() {
  const query = useSystemConfigs();
  const data = query.data ? splitAppConfigs(query.data) : undefined;
  return { ...query, data };
}

/** 更新单个应用配置项（复用 SystemConfig upsert） */
export function useUpdateAppConfig() {
  return useUpdateSystemConfig();
}

/** 单 key 批量保存结果项 */
export interface SaveAppEntryResult {
  key: AppConfigKey;
  ok: boolean;
  error?: unknown;
}

/**
 * 批量保存一张卡片的配置（逐 key 调用 upsert，全部完成后失效缓存）。
 *
 * 前端展示「保存中 / 成功 / 部分失败」由返回的 results 数组判定。
 */
export function useSaveAppCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entries: AppConfigEntry[]): Promise<SaveAppEntryResult[]> => {
      const results = await Promise.all(
        entries.map((entry) =>
          apiFetch<ApiSuccess<SystemConfigItem>>(
            `/admin/platform/system-configs/${entry.key}`,
            { method: 'PUT', body: JSON.stringify({ value: entry.value }) },
          )
            .then(() => ({ key: entry.key, ok: true }))
            .catch((err) => ({ key: entry.key, ok: false, error: err })),
        ),
      );
      return results;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'system-configs'] });
    },
  });
}
