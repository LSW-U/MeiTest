/**
 * WarehouseFeeFields — 配送费三字段（创建页 / 详情页共用，Codex设计 §3.4 / §5.3）
 *
 * 单位约定：
 * - deliveryFee：契约单位分，UI 输入 USD
 * - perKmFee：契约单位分/km，UI 支持 USD / 分 切换（仅展示切换，不改契约单位）
 * - freeKm：km，直接输入
 *
 * 父组件持有展示字符串与单位态；提交映射见 create 页 / fee 卡 onSave。
 */
'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type PerKmUnit = 'USD' | 'CENTS';

export interface WarehouseFeeFieldsProps {
  deliveryFee: string; // USD 展示值
  perKmFee: string; // 按 perKmUnit 的展示值
  perKmUnit: PerKmUnit;
  freeKm: string; // km
  disabled?: boolean;
  onDeliveryFeeChange: (value: string) => void;
  onPerKmFeeChange: (value: string) => void;
  onPerKmUnitChange: (unit: PerKmUnit) => void;
  onFreeKmChange: (value: string) => void;
}

/** USD 展示值 → 整数分（非法输入/溢出返回 null；审查小改进：1e308*100=Infinity 穿透拦截） */
export function usdToCents(usd: string): number | null {
  const n = Number.parseFloat(usd);
  if (!Number.isFinite(n) || n < 0) return null;
  const cents = n * 100;
  if (!Number.isFinite(cents)) return null;
  return Math.round(cents);
}

/** 整数分 → USD 展示值 */
export function centsToUsd(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** perKmFee 单位切换换算（USD↔分）；非法字符串原样返回（Codex设计 §5.4） */
export function convertPerKmFeeValue(value: string, from: PerKmUnit, to: PerKmUnit): string {
  if (from === to) return value;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return value;
  return from === 'USD' ? String(Math.round(n * 100)) : centsToUsd(n);
}

/** 分模式下提交值：整数分（非法返回 null） */
export function perKmFeeToCents(value: string, unit: PerKmUnit): number | null {
  const n = unit === 'USD' ? usdToCents(value) : Number.parseFloat(value);
  if (n === null || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/** freeKm 提交值（非法/越界返回 null；上限 999 与契约 .max(999) 对齐） */
export function freeKmToNumber(value: string): number | null {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0 || n > 999) return null;
  return n;
}

export function WarehouseFeeFields({
  deliveryFee,
  perKmFee,
  perKmUnit,
  freeKm,
  disabled,
  onDeliveryFeeChange,
  onPerKmFeeChange,
  onPerKmUnitChange,
  onFreeKmChange,
}: WarehouseFeeFieldsProps) {
  const t = useTranslations('common');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label>{t('w.warehouses.deliveryFeeUsd')}</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={deliveryFee}
            onChange={(e) => onDeliveryFeeChange(e.target.value)}
            placeholder="2.00"
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('w.warehouses.perKmFeeLabel')}</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              step={perKmUnit === 'USD' ? '0.01' : '1'}
              min="0"
              value={perKmFee}
              onChange={(e) => onPerKmFeeChange(e.target.value)}
              placeholder={perKmUnit === 'USD' ? '0.50' : '50'}
              disabled={disabled}
            />
            <Select
              value={perKmUnit}
              onValueChange={(v) => onPerKmUnitChange(v as PerKmUnit)}
              disabled={disabled}
            >
              <SelectTrigger className="w-28 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">{t('w.warehouses.perKmFeeUnitUsd')}</SelectItem>
                <SelectItem value="CENTS">{t('w.warehouses.perKmFeeUnitCents')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t('w.warehouses.freeKmLabel')}</Label>
          <Input
            type="number"
            step="0.1"
            min="0"
            max="999"
            value={freeKm}
            onChange={(e) => onFreeKmChange(e.target.value)}
            placeholder="2"
            disabled={disabled}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('w.warehouses.feeSavedAsCentsHint')}</p>
    </div>
  );
}
