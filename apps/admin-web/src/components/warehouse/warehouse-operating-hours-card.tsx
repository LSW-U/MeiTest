/**
 * WarehouseOperatingHoursCard — 详情页·营业时间周表卡（Codex设计 §3.3）
 *
 * 语义（与批 B Zod 契约一致）：
 * - rest:true 或 open/close 同空 = 休息日；非休息日 close > open；不支持跨天
 * - rest 开启时禁用时间输入；提交统一 { open:'', close:'', rest:true }
 * - 套用默认模板：直接覆盖本地表单态（mon..sun 08:00–22:00），保存仍需点保存
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
import {
  OPERATING_DAYS,
  type OperatingDay,
  type OperatingHours,
  type OperatingHour,
  type Warehouse,
} from '@/hooks/api/use-warehouses';

const DAY_KEY: Record<OperatingDay, string> = {
  mon: 'dayMon',
  tue: 'dayTue',
  wed: 'dayWed',
  thu: 'dayThu',
  fri: 'dayFri',
  sat: 'daySat',
  sun: 'daySun',
};

/** 服务端 operatingHours → 本地行态（缺失/null 天 = 休息） */
function toLocalHours(hours: OperatingHours | null | undefined): Record<OperatingDay, OperatingHour> {
  return Object.fromEntries(
    OPERATING_DAYS.map((day) => {
      const d = hours?.[day];
      const rest = !d || d.rest === true || !d.open || !d.close;
      return [day, { open: rest ? '' : d.open, close: rest ? '' : d.close, rest }];
    }),
  ) as Record<OperatingDay, OperatingHour>;
}

/** 提交归一化（Codex设计 §3.3 伪代码）；返回 null 表示存在非法日 */
function normalizeForSave(
  local: Record<OperatingDay, OperatingHour>,
): OperatingHours | null {
  const out: Partial<Record<OperatingDay, OperatingHour>> = {};
  for (const day of OPERATING_DAYS) {
    const row = local[day];
    if (row.rest || !row.open || !row.close) {
      out[day] = { open: '', close: '', rest: true };
    } else if (row.close <= row.open) {
      return null; // 非休息日 close > open（不支持跨天）
    } else {
      out[day] = { open: row.open, close: row.close, rest: false };
    }
  }
  return out as OperatingHours;
}

/** 默认模板：mon..sun 08:00–22:00 */
const DEFAULT_TEMPLATE = Object.fromEntries(
  OPERATING_DAYS.map((day) => [day, { open: '08:00', close: '22:00', rest: false }]),
) as Record<OperatingDay, OperatingHour>;

export interface WarehouseOperatingHoursCardProps {
  warehouse: Warehouse;
  saving: boolean;
  error?: string | null;
  onSave: (input: { operatingHours: OperatingHours }) => Promise<void>;
}

export function WarehouseOperatingHoursCard({
  warehouse,
  saving,
  error,
  onSave,
}: WarehouseOperatingHoursCardProps) {
  const t = useTranslations('common');
  const [local, setLocal] = useState(() => toLocalHours(warehouse.operatingHours));
  const [touched, setTouched] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!touched) {
      setLocal(toLocalHours(warehouse.operatingHours));
      setInvalid(false);
    }
  }, [warehouse, touched]);

  const dirty = touched && JSON.stringify(local) !== JSON.stringify(toLocalHours(warehouse.operatingHours));

  const updateDay = (day: OperatingDay, patch: Partial<OperatingHour>) => {
    setLocal((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
    setTouched(true);
  };

  const applyDefault = () => {
    setLocal({ ...DEFAULT_TEMPLATE });
    setTouched(true);
    setInvalid(false);
  };

  const reset = () => {
    setLocal(toLocalHours(warehouse.operatingHours));
    setTouched(false);
    setInvalid(false);
  };

  const handleSave = async () => {
    const normalized = normalizeForSave(local);
    if (!normalized) {
      setInvalid(true);
      return;
    }
    // 审查 P2-1：仅成功路径清 dirty；失败保留编辑值（父级已 toast）
    try {
      await onSave({ operatingHours: normalized });
      setTouched(false);
    } catch {
      // 保存失败：dirty 保留
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{t('w.warehouses.cardOperatingHoursTitle')}</CardTitle>
        <div className="flex items-center gap-2">
          {dirty && <Badge variant="warning">{t('w.warehouses.unsaved')}</Badge>}
          <Button type="button" variant="outline" size="sm" onClick={applyDefault} disabled={saving}>
            {t('w.warehouses.applyDefaultHours')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {OPERATING_DAYS.map((day) => {
          const row = local[day];
          const isRest = row.rest || !row.open || !row.close;
          return (
            <div key={day} className="flex items-center gap-3 rounded-md border px-3 py-2">
              <span className="w-10 text-sm font-medium">{t(`w.warehouses.${DAY_KEY[day]}`)}</span>
              <div className="flex items-center gap-1.5">
                <Switch
                  checked={row.rest === true}
                  onCheckedChange={(v) => {
                    if (v) {
                      updateDay(day, { rest: true, open: '', close: '' });
                    } else {
                      updateDay(day, { rest: false });
                    }
                  }}
                  disabled={saving}
                />
                <Label className="text-xs text-muted-foreground">{t('w.warehouses.restDay')}</Label>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Input
                  type="time"
                  value={row.open}
                  onChange={(e) => updateDay(day, { open: e.target.value })}
                  disabled={isRest || saving}
                  className={`w-28 ${row.close && row.open && row.close <= row.open ? 'border-destructive' : ''}`}
                  aria-label={t('w.warehouses.openTime')}
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  type="time"
                  value={row.close}
                  onChange={(e) => updateDay(day, { close: e.target.value })}
                  disabled={isRest || saving}
                  className={`w-28 ${row.close && row.open && row.close <= row.open ? 'border-destructive' : ''}`}
                  aria-label={t('w.warehouses.closeTime')}
                />
              </div>
              <span className={`w-8 text-right text-xs ${isRest ? 'text-muted-foreground' : 'text-green-600'}`}>
                {isRest ? t('w.warehouses.closed') : t('w.warehouses.operating')}
              </span>
            </div>
          );
        })}

        {(invalid || Object.values(local).some((r) => !r.rest && r.open && r.close && r.close <= r.open)) && (
          <p className="text-xs text-destructive">{t('w.warehouses.invalidOperatingHours')}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={reset} disabled={!dirty || saving}>
            {t('w.warehouses.resetChanges')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={!dirty || saving}>
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
