/**
 * 新建仓库表单页 — /warehouses/create
 *
 * 后端：POST /admin/warehouses（UpsertWarehouseRequest 全必填）
 *
 * 批 C1（Codex设计 §5）：
 * - 新增配送费区：deliveryFee（USD）/ perKmFee（默认 0，USD/分切换）/ freeKm（默认 2）
 * - 新增默认营业时间开关（默认开启）：提交 mon..sun 08:00–22:00；关闭不提交 operatingHours
 * - 覆盖区不在创建页绘制（拍板 6-A），创建成功跳详情页
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateWarehouse, OPERATING_DAYS, type OperatingHours } from '@/hooks/api/use-warehouses';
import {
  WarehouseFeeFields,
  usdToCents,
  perKmFeeToCents,
  freeKmToNumber,
  convertPerKmFeeValue,
  type PerKmUnit,
} from '@/components/warehouse/warehouse-fee-fields';
import type { I18nText } from '@/hooks/api/use-products';

type Locale = 'en' | 'zh' | 'id' | 'pt';

const WAREHOUSE_CODES = Array.from({ length: 10 }, (_, i) =>
  `W${String(i + 1).padStart(2, '0')}`,
);

/** 默认营业时间模板：mon..sun 08:00–22:00（拍板 1-A） */
function buildDefaultOperatingHours(): OperatingHours {
  return Object.fromEntries(
    OPERATING_DAYS.map((day) => [day, { open: '08:00', close: '22:00', rest: false }]),
  ) as OperatingHours;
}

export default function CreateWarehousePage() {
  const t = useTranslations('common');
  const router = useRouter();
  const createMutation = useCreateWarehouse();

  const [code, setCode] = useState('W01');
  const [name, setName] = useState<I18nText>({});
  const [address, setAddress] = useState('');
  const [centerLat, setCenterLat] = useState('');
  const [centerLng, setCenterLng] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [perKmFee, setPerKmFee] = useState('0');
  const [perKmUnit, setPerKmUnit] = useState<PerKmUnit>('USD');
  const [freeKm, setFreeKm] = useState('2');
  const [useDefaultHours, setUseDefaultHours] = useState(true);
  const [isActive, setIsActive] = useState(true);

  /** perKmUnit 切换只转换展示值（非法字符串保留原样，Codex设计 §5.4） */
  const handlePerKmUnitChange = (next: PerKmUnit) => {
    const converted = convertPerKmFeeValue(perKmFee, perKmUnit, next);
    setPerKmFee(converted);
    setPerKmUnit(next);
  };

  // 审查 P3-1：非法输入显性化（提交禁用 + 费用卡错误提示），不再静默 return / 静默归 0
  const feesValid =
    usdToCents(deliveryFee) !== null &&
    perKmFeeToCents(perKmFee, perKmUnit) !== null &&
    freeKmToNumber(freeKm) !== null;
  const formValid =
    feesValid &&
    !Number.isNaN(Number.parseFloat(centerLat)) &&
    !Number.isNaN(Number.parseFloat(centerLng));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const lat = parseFloat(centerLat);
    const lng = parseFloat(centerLng);
    const deliveryFeeCents = usdToCents(deliveryFee);
    const perKmFeeCents = perKmFeeToCents(perKmFee, perKmUnit);
    const freeKmValue = freeKmToNumber(freeKm);
    // 审查 P3-1：非法输入不再静默 return / 静默归 0，提交按钮已按 formValid 禁用
    if (isNaN(lat) || isNaN(lng) || deliveryFeeCents === null || perKmFeeCents === null || freeKmValue === null) {
      return;
    }
    try {
      const res = await createMutation.mutateAsync({
        code,
        name,
        address,
        centerLat: lat,
        centerLng: lng,
        deliveryFee: deliveryFeeCents,
        perKmFee: perKmFeeCents,
        freeKm: freeKmValue,
        isActive,
        // 审查 P1-1：UpsertWarehouseRequest 的 coverageArea/operatingHours 是必填键（nullable 但键必须出现），
        // 缺键 400 E-WAREHOUSE-004。coverageArea 恒传 null（service 有 5km 兜底框）；hours 关传 null，
        // 创建后到详情页编辑（Codex设计 §5.1）
        coverageArea: null,
        operatingHours: useDefaultHours ? buildDefaultOperatingHours() : null,
      });
      router.push(`/warehouses/${res.data.id}`);
    } catch {
      // mutation error 展示在表单底部
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PageHeader
        title={t('w.warehouses.create') as string}
        breadcrumb={[
          { label: t('w.warehouses.title'), href: '/warehouses' },
          { label: t('w.warehouses.create') },
        ]}
        action={
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              {t('w.form.cancel')}
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !formValid}>
              {createMutation.isPending ? t('w.form.saving') : t('w.form.save')}
            </Button>
          </div>
        }
      />

      {createMutation.error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t('w.form.errorPrefix', { message: createMutation.error.message })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('w.form.basicInfo')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('w.warehouses.code')}</Label>
              <Select value={code} onValueChange={setCode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WAREHOUSE_CODES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('w.form.active')}</Label>
              <div className="flex h-10 items-center gap-2">
                <Switch checked={isActive} onCheckedChange={setIsActive} />
                <span className="text-sm text-muted-foreground">
                  {isActive ? t('w.form.enabled') : t('w.form.disabled')}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('w.warehouses.name4Lang')}</Label>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {(['en', 'zh', 'id', 'pt'] as Locale[]).map((locale) => (
                <div key={locale} className="space-y-1">
                  <Label className="text-xs uppercase text-muted-foreground">{locale}</Label>
                  <Input
                    value={name[locale] ?? ''}
                    onChange={(e) => setName({ ...name, [locale]: e.target.value })}
                    required={locale === 'en'}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('w.form.address')}</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, city"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('w.warehouses.centerLatLabel')}</Label>
              <Input
                type="number"
                step="0.0001"
                value={centerLat}
                onChange={(e) => setCenterLat(e.target.value)}
                placeholder="-8.5569"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t('w.warehouses.centerLngLabel')}</Label>
              <Input
                type="number"
                step="0.0001"
                value={centerLng}
                onChange={(e) => setCenterLng(e.target.value)}
                placeholder="125.5603"
                required
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('w.warehouses.sectionFees')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!feesValid && (
            <p className="mb-2 text-xs text-destructive">
              {t('w.warehouses.feeInvalidHint')}
            </p>
          )}
          <WarehouseFeeFields
            deliveryFee={deliveryFee}
            perKmFee={perKmFee}
            perKmUnit={perKmUnit}
            freeKm={freeKm}
            disabled={createMutation.isPending}
            onDeliveryFeeChange={setDeliveryFee}
            onPerKmFeeChange={setPerKmFee}
            onPerKmUnitChange={handlePerKmUnitChange}
            onFreeKmChange={setFreeKm}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('w.warehouses.sectionOperatingHours')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={useDefaultHours}
              onCheckedChange={setUseDefaultHours}
              disabled={createMutation.isPending}
            />
            <Label>{t('w.warehouses.useDefaultHours')}</Label>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('w.warehouses.defaultHoursSummary')}
          </p>
          <p className="text-xs text-muted-foreground">{t('w.warehouses.defaultHoursHint')}</p>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{t('w.warehouses.coverageEditHint')}</p>
    </form>
  );
}
