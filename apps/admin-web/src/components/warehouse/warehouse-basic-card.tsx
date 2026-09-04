/**
 * WarehouseBasicCard — 详情页·基本信息卡（Codex设计 §3.2）
 *
 * 可编辑：name 4 语言 / address / centerLat / centerLng / isActive（拍板 4-A：随基本信息一起保存）。
 * code 只读（创建后不可修改）。
 * 独立 dirty/save：未修改保存 disabled；校验失败 disabled + 字段错误。
 */
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import type { Warehouse } from '@/hooks/api/use-warehouses';
import type { I18nText } from '@/hooks/api/use-products';

type Locale = 'en' | 'zh' | 'id' | 'pt';
const LOCALES: Locale[] = ['en', 'zh', 'id', 'pt'];

export interface WarehouseBasicSaveInput {
  name: I18nText;
  address: string;
  centerLat: number;
  centerLng: number;
  isActive: boolean;
}

interface WarehouseBasicCardProps {
  warehouse: Warehouse;
  saving: boolean;
  error?: string | null;
  onSave: (input: WarehouseBasicSaveInput) => Promise<void>;
}

interface BasicForm {
  name: I18nText;
  address: string;
  centerLat: string;
  centerLng: string;
  isActive: boolean;
}

function toForm(w: Warehouse): BasicForm {
  return {
    name: { ...(w.name ?? {}) },
    address: w.address ?? '',
    centerLat: String(w.centerLat ?? ''),
    centerLng: String(w.centerLng ?? ''),
    isActive: w.isActive,
  };
}

export function WarehouseBasicCard({ warehouse, saving, error, onSave }: WarehouseBasicCardProps) {
  const t = useTranslations('common');
  const [form, setForm] = useState<BasicForm>(() => toForm(warehouse));
  const [touched, setTouched] = useState(false);

  // 服务端数据更新（保存成功 invalidate 后）且本地未编辑时同步
  useEffect(() => {
    if (!touched) setForm(toForm(warehouse));
  }, [warehouse, touched]);

  const dirty =
    touched &&
    (form.address !== warehouse.address ||
      form.centerLat !== String(warehouse.centerLat ?? '') ||
      form.centerLng !== String(warehouse.centerLng ?? '') ||
      form.isActive !== warehouse.isActive ||
      LOCALES.some((l) => (form.name[l] ?? '') !== (warehouse.name?.[l] ?? '')));

  const reset = () => {
    setForm(toForm(warehouse));
    setTouched(false);
  };

  // 校验（Codex设计 §3.2）：en 必填、address 必填、经纬度范围
  const lat = Number.parseFloat(form.centerLat);
  const lng = Number.parseFloat(form.centerLng);
  const errors = {
    nameEn: !(form.name.en ?? '').trim(),
    address: !form.address.trim(),
    centerLat: Number.isNaN(lat) || lat < -90 || lat > 90,
    centerLng: Number.isNaN(lng) || lng < -180 || lng > 180,
  };
  const valid = !Object.values(errors).some(Boolean);

  const handleSave = async () => {
    // 审查 P2-1：仅成功路径清 dirty；失败保留编辑值（错误经父级 toast/error prop 展示）
    try {
      await onSave({
        name: form.name,
        address: form.address,
        centerLat: lat,
        centerLng: lng,
        isActive: form.isActive,
      });
      setTouched(false);
    } catch {
      // 保存失败：dirty 保留（父级已 toast）
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('w.warehouses.cardBasicTitle')}</CardTitle>
        {dirty && <Badge variant="warning">{t('w.warehouses.unsaved')}</Badge>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>{t('w.warehouses.code')}</Label>
            <Input value={warehouse.code} readOnly disabled />
            <p className="text-xs text-muted-foreground">{t('w.warehouses.codeReadOnlyHint')}</p>
          </div>
          <div className="space-y-2">
            <Label>{t('w.form.active')}</Label>
            <div className="flex h-10 items-center gap-2">
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => {
                  setForm((f) => ({ ...f, isActive: v }));
                  setTouched(true);
                }}
                disabled={saving}
              />
              <span className="text-sm text-muted-foreground">
                {form.isActive ? t('w.form.enabled') : t('w.form.disabled')}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t('w.form.name')}</Label>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {LOCALES.map((locale) => (
              <div key={locale} className="space-y-1">
                <Label className="text-xs uppercase text-muted-foreground">{locale}</Label>
                <Input
                  value={form.name[locale] ?? ''}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, name: { ...f.name, [locale]: e.target.value } }));
                    setTouched(true);
                  }}
                  className={errors.nameEn && locale === 'en' ? 'border-destructive' : undefined}
                />
              </div>
            ))}
          </div>
          {errors.nameEn && (
            <p className="text-xs text-destructive">{t('w.form.required')}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>{t('w.form.address')}</Label>
          <Input
            value={form.address}
            onChange={(e) => {
              setForm((f) => ({ ...f, address: e.target.value }));
              setTouched(true);
            }}
            className={errors.address ? 'border-destructive' : undefined}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t('w.warehouses.centerLatLabel')}</Label>
            <Input
              type="number"
              step="0.0001"
              value={form.centerLat}
              onChange={(e) => {
                setForm((f) => ({ ...f, centerLat: e.target.value }));
                setTouched(true);
              }}
              className={errors.centerLat ? 'border-destructive' : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('w.warehouses.centerLngLabel')}</Label>
            <Input
              type="number"
              step="0.0001"
              value={form.centerLng}
              onChange={(e) => {
                setForm((f) => ({ ...f, centerLng: e.target.value }));
                setTouched(true);
              }}
              className={errors.centerLng ? 'border-destructive' : undefined}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={reset} disabled={!dirty || saving}>
            {t('w.warehouses.resetChanges')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={!dirty || !valid || saving}>
            {saving ? t('w.form.saving') : t('w.form.save')}
          </Button>
        </div>
        {error && (
          <p className="text-sm text-destructive">{t('w.form.saveFailed', { message: error })}</p>
        )}
      </CardContent>
    </Card>
  );
}
