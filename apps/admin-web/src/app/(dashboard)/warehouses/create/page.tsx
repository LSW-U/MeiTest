/**
 * 新建仓库表单页 — /warehouses/create
 *
 * 后端：POST /admin/warehouses
 *
 * 字段（按契约 warehouse.ts UpsertWarehouseRequest）：
 *   - code（W01-W10）
 *   - name（4 语言）
 *   - address
 *   - centerLat / centerLng
 *   - deliveryFee（cents）
 *   - isActive（switch）
 *   - operatingHours（JSON 7 天）— MVP 默认 9:00-22:00，可在详情页编辑
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
import { useCreateWarehouse } from '@/hooks/api/use-warehouses';
import type { I18nText } from '@/hooks/api/use-products';

type Locale = 'en' | 'zh' | 'id' | 'pt';

const WAREHOUSE_CODES = Array.from({ length: 10 }, (_, i) =>
  `W${String(i + 1).padStart(2, '0')}`,
);

export default function CreateWarehousePage() {
  const t = useTranslations();
  const router = useRouter();
  const createMutation = useCreateWarehouse();

  const [code, setCode] = useState('W01');
  const [name, setName] = useState<I18nText>({});
  const [address, setAddress] = useState('');
  const [centerLat, setCenterLat] = useState('');
  const [centerLng, setCenterLng] = useState('');
  const [deliveryFee, setDeliveryFee] = useState(''); // 元字符串
  const [isActive, setIsActive] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const lat = parseFloat(centerLat);
    const lng = parseFloat(centerLng);
    const fee = Math.round(parseFloat(deliveryFee) * 100);
    if (isNaN(lat) || isNaN(lng) || isNaN(fee)) return;
    try {
      const res = await createMutation.mutateAsync({
        code,
        name,
        address,
        centerLat: lat,
        centerLng: lng,
        deliveryFee: fee,
        isActive,
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
          { label: 'Warehouses', href: '/warehouses' },
          { label: 'Create' },
        ]}
        action={
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        }
      />

      {createMutation.error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Error: {createMutation.error.message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Basic Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Code</Label>
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
              <Label>Active</Label>
              <div className="flex h-10 items-center gap-2">
                <Switch checked={isActive} onCheckedChange={setIsActive} />
                <span className="text-sm text-muted-foreground">
                  {isActive ? '启用' : '停用'}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Name (4 languages)</Label>
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
            <Label>Address</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, city"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Center Latitude</Label>
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
              <Label>Center Longitude</Label>
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

          <div className="space-y-2">
            <Label>Delivery Fee (USD)</Label>
            <Input
              type="number"
              step="0.01"
              value={deliveryFee}
              onChange={(e) => setDeliveryFee(e.target.value)}
              placeholder="2.00"
              required
            />
            <p className="text-xs text-muted-foreground">
              配送费以美元输入，存为 cents（2.00 → 200）。
            </p>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        配送范围（coverageArea GeoJSON Polygon）和营业时间（operatingHours）可在详情页编辑。
      </p>
    </form>
  );
}
