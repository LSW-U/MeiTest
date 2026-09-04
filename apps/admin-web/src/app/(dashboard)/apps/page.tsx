/**
 * 应用中心页 - /apps
 *
 * admin-web 优化方案 批次3（2026-08-29）
 *
 * 复用 SystemConfig 通用端点（前端按固定 key 白名单收敛成客户端/骑手两张卡片）：
 *   app.client.ios.url / app.client.android.url / app.client.qr / app.client.version / app.client.changelog
 *   app.rider.ios.url  / app.rider.android.url  / app.rider.qr  / app.rider.version  / app.rider.changelog
 *
 * 未配置（全空）的卡片显示空态；每张卡片可独立保存（逐 key PUT，全部完成后失效缓存 + 反馈结果）。
 * 视角：platform 独占（菜单仅 platform 可见）。
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/common/error-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/api';
import {
  useAppConfigs,
  useSaveAppCard,
  type AppConfigCard,
  type AppConfigEntry,
  type AppConfigKey,
} from '@/hooks/api/use-apps';

/** 表单字段元数据：按 key 对齐文案 + 输入类型 */
interface FieldMeta {
  key: AppConfigKey;
  labelKey: string;
  /** changelog 用 textarea，其余 input */
  multiline: boolean;
}

/** 客户端卡片字段顺序 */
const CLIENT_FIELDS: FieldMeta[] = [
  { key: 'app.client.ios.url', labelKey: 'admin.apps.fieldIosUrl', multiline: false },
  { key: 'app.client.android.url', labelKey: 'admin.apps.fieldAndroidUrl', multiline: false },
  { key: 'app.client.qr', labelKey: 'admin.apps.fieldQr', multiline: false },
  { key: 'app.client.version', labelKey: 'admin.apps.fieldVersion', multiline: false },
  { key: 'app.client.changelog', labelKey: 'admin.apps.fieldChangelog', multiline: true },
];

/** 骑手卡片字段顺序 */
const RIDER_FIELDS: FieldMeta[] = [
  { key: 'app.rider.ios.url', labelKey: 'admin.apps.fieldIosUrl', multiline: false },
  { key: 'app.rider.android.url', labelKey: 'admin.apps.fieldAndroidUrl', multiline: false },
  { key: 'app.rider.qr', labelKey: 'admin.apps.fieldQr', multiline: false },
  { key: 'app.rider.version', labelKey: 'admin.apps.fieldVersion', multiline: false },
  { key: 'app.rider.changelog', labelKey: 'admin.apps.fieldChangelog', multiline: true },
];

export default function AppsPage() {
  const t = useTranslations('common');
  const { data, isLoading, error, refetch } = useAppConfigs();

  if (error) return <ErrorState onRetry={() => refetch()} />;
  if (isLoading) {
    return (
      <div className="rounded-md border p-8 text-center text-muted-foreground">{t('loading')}</div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('admin.apps.title')} description={t('admin.apps.description')} />
      <div className="grid gap-6 lg:grid-cols-2">
        <AppCard
          title={t('admin.apps.cardClient')}
          card={data?.client}
          fields={CLIENT_FIELDS}
        />
        <AppCard
          title={t('admin.apps.cardRider')}
          card={data?.rider}
          fields={RIDER_FIELDS}
        />
      </div>
    </div>
  );
}

/**
 * 单张应用配置卡片（客户端或骑手）。
 *
 * 本地编辑态用 Record<key,string> 维护，保存时逐 key 调 useSaveAppCard。
 * 全空 → 显示空态提示（仍可填值保存）。
 */
function AppCard({
  title,
  card,
  fields,
}: {
  title: string;
  card?: AppConfigCard;
  fields: FieldMeta[];
}) {
  const t = useTranslations('common');
  const format = useFormatter();
  const { toast } = useToast();
  const saveMutation = useSaveAppCard();

  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  // 服务端数据就绪后灌入本地编辑态。加 dirty 守卫：用户正在编辑未保存时，
  // 即使 card 因别处缓存失效被重拉，也不覆盖本地未保存值（仅首次/保存后才同步）。
  useEffect(() => {
    if (!card || dirty) return;
    const next: Record<string, string> = {};
    for (const e of card.entries) next[e.key] = e.value;
    setValues(next);
  }, [card, dirty]);

  const allEmpty = card?.allEmpty ?? true;
  const lastUpdated = useMemo(() => {
    if (!card) return null;
    const ts = card.entries.map((e) => e.updatedAt).filter(Boolean) as string[];
    if (ts.length === 0) return null;
    return ts.sort().at(-1) ?? null;
  }, [card]);

  async function handleSave() {
    if (!card) return;
    const entries: AppConfigEntry[] = fields.map((f) => {
      const orig = card.entries.find((e) => e.key === f.key);
      return {
        key: f.key,
        value: values[f.key] ?? '',
        description: orig?.description ?? null,
        updatedAt: orig?.updatedAt ?? null,
        updatedBy: orig?.updatedBy ?? null,
      };
    });
    try {
      const results = await saveMutation.mutateAsync(entries);
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast({ title: t('admin.apps.saved') });
      } else {
        toast({
          title: t('admin.apps.partialFail', { failed: failed.length }),
          variant: 'destructive',
        });
      }
      // 保存完成：解除 dirty 守卫，让下次缓存刷新能同步最新服务端值
      setDirty(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.apps.saveFailed');
      toast({ title: t('admin.apps.saveFailed'), description: message, variant: 'destructive' });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {allEmpty && (
          <p className="text-xs text-muted-foreground">
            {t('admin.apps.empty')} — {t('admin.apps.emptyDesc')}
          </p>
        )}
        {!allEmpty && lastUpdated && (
          <p className="text-xs text-muted-foreground">
            {t('admin.apps.updatedAt')}:{' '}
            {format.dateTime(new Date(lastUpdated), {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.map((f) => (
          <div key={f.key} className="space-y-2">
            <Label htmlFor={f.key}>{t(f.labelKey as 'admin.apps.fieldIosUrl')}</Label>
            {f.multiline ? (
              <Textarea
                id={f.key}
                value={values[f.key] ?? ''}
                onChange={(e) => {
                  setValues((prev) => ({ ...prev, [f.key]: e.target.value }));
                  setDirty(true);
                }}
                rows={3}
                placeholder={t('admin.apps.placeholderUrl')}
              />
            ) : (
              <Input
                id={f.key}
                value={values[f.key] ?? ''}
                onChange={(e) => {
                  setValues((prev) => ({ ...prev, [f.key]: e.target.value }));
                  setDirty(true);
                }}
                placeholder={
                  f.key.endsWith('.version') ? t('admin.apps.placeholderVersion') : t('admin.apps.placeholderUrl')
                }
              />
            )}
          </div>
        ))}
        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? t('admin.apps.saving') : t('admin.apps.save')}
        </Button>
      </CardContent>
    </Card>
  );
}
