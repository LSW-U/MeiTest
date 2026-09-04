/**
 * WarehouseFeeCard — 详情页·配送费卡（Codex设计 §3.4）
 *
 * 契约单位：deliveryFee/perKmFee 分；freeKm km。UI：deliveryFee USD 输入、
 * perKmFee USD/分切换（仅展示）、freeKm km。含公式说明与试算表（0/2/5/10 km）。
 * dirty 比较契约值（分/分/km），非 UI 展示值。
 */
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import {
  WarehouseFeeFields,
  usdToCents,
  perKmFeeToCents,
  freeKmToNumber,
  centsToUsd,
  convertPerKmFeeValue,
  type PerKmUnit,
} from './warehouse-fee-fields';
import type { Warehouse } from '@/hooks/api/use-warehouses';

export interface WarehouseFeeSaveInput {
  deliveryFee: number; // cents
  perKmFee: number; // cents/km
  freeKm: number; // km
}

interface WarehouseFeeCardProps {
  warehouse: Warehouse;
  saving: boolean;
  error?: string | null;
  onSave: (input: WarehouseFeeSaveInput) => Promise<void>;
}

/** 试算距离（Codex设计 §3.4：0/2/5/10 km） */
const SIM_DISTANCES = [0, 2, 5, 10];

export function WarehouseFeeCard({ warehouse, saving, error, onSave }: WarehouseFeeCardProps) {
  const t = useTranslations('common');

  const [deliveryFee, setDeliveryFee] = useState(() => centsToUsd(warehouse.deliveryFee ?? 0));
  const [perKmFee, setPerKmFee] = useState(() => centsToUsd(warehouse.perKmFee ?? 0));
  const [perKmUnit, setPerKmUnit] = useState<PerKmUnit>('USD');
  const [freeKm, setFreeKm] = useState(String(warehouse.freeKm ?? 2));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) {
      setDeliveryFee(centsToUsd(warehouse.deliveryFee ?? 0));
      setPerKmFee(centsToUsd(warehouse.perKmFee ?? 0));
      setPerKmUnit('USD');
      setFreeKm(String(warehouse.freeKm ?? 2));
    }
  }, [warehouse, touched]);

  // dirty 比较契约值（分 / 分 / km）
  const deliveryFeeCents = usdToCents(deliveryFee);
  const perKmFeeCents = perKmFeeToCents(perKmFee, perKmUnit);
  const freeKmValue = freeKmToNumber(freeKm);
  const dirty =
    touched &&
    (deliveryFeeCents !== warehouse.deliveryFee ||
      perKmFeeCents !== (warehouse.perKmFee ?? 0) ||
      freeKmValue !== (warehouse.freeKm ?? 2));
  const valid = deliveryFeeCents !== null && perKmFeeCents !== null && freeKmValue !== null;

  const handleUnitChange = (next: PerKmUnit) => {
    setPerKmFee(convertPerKmFeeValue(perKmFee, perKmUnit, next));
    setPerKmUnit(next);
  };

  const reset = () => {
    setDeliveryFee(centsToUsd(warehouse.deliveryFee ?? 0));
    setPerKmFee(centsToUsd(warehouse.perKmFee ?? 0));
    setPerKmUnit('USD');
    setFreeKm(String(warehouse.freeKm ?? 2));
    setTouched(false);
  };

  const handleSave = async () => {
    if (!valid) return;
    // 审查 P2-1：仅成功路径清 dirty；失败保留编辑值（父级已 toast）
    try {
      await onSave({
        deliveryFee: deliveryFeeCents!,
        perKmFee: perKmFeeCents!,
        freeKm: freeKmValue!,
      });
      setTouched(false);
    } catch {
      // 保存失败：dirty 保留
    }
  };

  // 试算：配送费 = deliveryFee(baseFee) + max(0, km − freeKm) × perKmFee
  const simulate = (km: number) => {
    const base = deliveryFeeCents ?? warehouse.deliveryFee ?? 0;
    const perKm = perKmFeeCents ?? warehouse.perKmFee ?? 0;
    const free = freeKmValue ?? warehouse.freeKm ?? 2;
    return base + Math.max(0, km - free) * perKm;
  };
  const perKmDisabled = (perKmFeeCents ?? warehouse.perKmFee ?? 0) === 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('w.warehouses.cardFeeTitle')}</CardTitle>
        {dirty && <Badge variant="warning">{t('w.warehouses.unsaved')}</Badge>}
      </CardHeader>
      <CardContent className="space-y-4">
        <WarehouseFeeFields
          deliveryFee={deliveryFee}
          perKmFee={perKmFee}
          perKmUnit={perKmUnit}
          freeKm={freeKm}
          disabled={saving}
          onDeliveryFeeChange={(v) => {
            setDeliveryFee(v);
            setTouched(true);
          }}
          onPerKmFeeChange={(v) => {
            setPerKmFee(v);
            setTouched(true);
          }}
          onPerKmUnitChange={handleUnitChange}
          onFreeKmChange={(v) => {
            setFreeKm(v);
            setTouched(true);
          }}
        />

        <div className="space-y-1 rounded-md bg-muted px-3 py-2">
          <p className="text-xs font-medium">{t('w.warehouses.feeFormulaTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('w.warehouses.feeFormula')}</p>
        </div>

        {perKmDisabled && (
          <p className="text-xs text-amber-600">{t('w.warehouses.perKmFeeDisabledHint')}</p>
        )}

        <div className="space-y-1">
          <p className="text-xs font-medium">{t('w.warehouses.feeSimulationTitle')}</p>
          <div className="grid grid-cols-4 gap-2">
            {SIM_DISTANCES.map((km) => (
              <div key={km} className="rounded-md border px-2 py-1.5 text-center">
                <p className="text-xs text-muted-foreground">{km} km</p>
                <p className="font-mono text-xs font-medium">{formatCurrency(simulate(km))}</p>
              </div>
            ))}
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
