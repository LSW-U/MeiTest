/**
 * 系统设置页 - /settings
 *
 * W7-ext-F 实现（2026-07-10）
 * 后端三组接口：
 *   1. Shop：GET/PATCH /admin/shop
 *   2. Pricing：GET /admin/pricing/config + PATCH /admin/pricing/warehouses/:id/base-fee
 *   3. SystemConfig：GET /admin/platform/system-configs + PUT /admin/platform/system-configs/:key
 */
'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/common/error-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  useShop,
  useUpdateShop,
  usePricingConfig,
  useUpdateWarehouseBaseFee,
  useSystemConfigs,
  useUpdateSystemConfig,
  type Shop,
  type WarehousePricing,
  type SystemConfigItem,
} from '@/hooks/api/use-settings';
import { ApiError } from '@/lib/api';

const SHOP_NAME_LOCALES = ['en', 'zh', 'id', 'pt'] as const;
const CONFIG_GROUP_PREFIXES = ['platform', 'delivery', 'rider', 'order'] as const;
type ConfigGroupPrefix = (typeof CONFIG_GROUP_PREFIXES)[number];

function configGroupOf(key: string): ConfigGroupPrefix | 'other' {
  const prefix = key.split('.')[0] as ConfigGroupPrefix;
  return (CONFIG_GROUP_PREFIXES as readonly string[]).includes(prefix) ? prefix : 'other';
}

export default function SettingsPage() {
  const t = useTranslations('common');
  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('admin.settings.title')} description={t('admin.settings.description')} />
      <Tabs defaultValue="shop">
        <TabsList>
          <TabsTrigger value="shop">{t('admin.settings.shopTab')}</TabsTrigger>
          <TabsTrigger value="pricing">{t('admin.settings.pricingTab')}</TabsTrigger>
          <TabsTrigger value="platform">{t('admin.settings.platformTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="shop">
          <ShopTab />
        </TabsContent>
        <TabsContent value="pricing">
          <PricingTab />
        </TabsContent>
        <TabsContent value="platform">
          <PlatformTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ===== Shop Tab =====

function ShopTab() {
  const t = useTranslations('common');
  const format = useFormatter();
  const { toast } = useToast();
  const { data: shop, isLoading, error, refetch } = useShop();
  const updateMutation = useUpdateShop();

  const [name, setName] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState<Record<string, string>>({});
  const [logoUrl, setLogoUrl] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [businessHours, setBusinessHours] = useState('');
  const [statusActive, setStatusActive] = useState(true);

  useEffect(() => {
    if (shop) {
      setName(shop.name ?? {});
      setAnnouncement(shop.announcement ?? {});
      setLogoUrl(shop.logoUrl ?? '');
      setPhone(shop.phone ?? '');
      setAddress(shop.address ?? '');
      setBusinessHours(shop.businessHours ?? '');
      setStatusActive(shop.status === 'ACTIVE');
    }
  }, [shop]);

  function formatDateTime(date: string): string {
    return format.dateTime(new Date(date), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  async function handleSave() {
    if (!shop) return;
    const input: Partial<Shop> = {
      name,
      announcement,
      logoUrl: logoUrl.trim() === '' ? null : logoUrl.trim(),
      phone,
      address,
      businessHours: businessHours.trim() === '' ? null : businessHours.trim(),
      status: statusActive ? 'ACTIVE' : 'INACTIVE',
    };
    try {
      await updateMutation.mutateAsync(input);
      toast({ title: t('admin.settings.shopSaved') });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.settings.saveFailed');
      toast({ title: t('admin.settings.saveFailed'), description: message, variant: 'destructive' });
    }
  }

  if (error) return <ErrorState onRetry={() => refetch()} />;
  if (isLoading) {
    return <div className="rounded-md border p-8 text-center text-muted-foreground">{t('loading')}</div>;
  }
  if (!shop) {
    return <div className="rounded-md border p-8 text-center text-muted-foreground">{t('empty')}</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin.settings.shopInfo')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 多语言名称 */}
        <div className="space-y-2">
          <Label>{t('admin.settings.shopName')}</Label>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
            {SHOP_NAME_LOCALES.map((lang) => (
              <div key={lang} className="space-y-1">
                <Label className="text-xs text-muted-foreground">{lang.toUpperCase()}</Label>
                <Input
                  value={name[lang] ?? ''}
                  onChange={(e) => setName((prev) => ({ ...prev, [lang]: e.target.value }))}
                  placeholder={`MeiMart (${lang})`}
                />
              </div>
            ))}
          </div>
        </div>

        {/* 多语言公告 */}
        <div className="space-y-2">
          <Label>{t('admin.settings.shopAnnouncement')}</Label>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
            {SHOP_NAME_LOCALES.map((lang) => (
              <div key={lang} className="space-y-1">
                <Label className="text-xs text-muted-foreground">{lang.toUpperCase()}</Label>
                <Textarea
                  value={announcement[lang] ?? ''}
                  onChange={(e) => setAnnouncement((prev) => ({ ...prev, [lang]: e.target.value }))}
                  rows={2}
                  placeholder={`(${lang})`}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="logoUrl">{t('admin.settings.shopLogoUrl')}</Label>
            <Input
              id="logoUrl"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">{t('admin.settings.shopPhone')}</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="address">{t('admin.settings.shopAddress')}</Label>
          <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="businessHours">{t('admin.settings.shopBusinessHours')}</Label>
            <Input
              id="businessHours"
              value={businessHours}
              onChange={(e) => setBusinessHours(e.target.value)}
              placeholder="08:00-22:00"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="shop-status">{t('admin.settings.shopStatus')}</Label>
              <p className="text-xs text-muted-foreground">
                {statusActive
                  ? t('admin.settings.shopStatusActive')
                  : t('admin.settings.shopStatusInactive')}
              </p>
            </div>
            <Switch
              id="shop-status"
              checked={statusActive}
              onCheckedChange={setStatusActive}
              disabled={updateMutation.isPending}
            />
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {t('admin.settings.updatedAt')}: {shop.updatedAt ? formatDateTime(shop.updatedAt) : '-'}
          </p>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? t('admin.settings.saving') : t('admin.settings.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ===== Pricing Tab =====

function PricingTab() {
  const t = useTranslations('common');
  const { toast } = useToast();
  const { data: items, isLoading, error, refetch } = usePricingConfig();
  const updateMutation = useUpdateWarehouseBaseFee();

  const [editing, setEditing] = useState<WarehousePricing | null>(null);
  const [baseFeeInput, setBaseFeeInput] = useState('');

  function openEdit(row: WarehousePricing) {
    setEditing(row);
    setBaseFeeInput(String(row.baseFee));
  }

  async function handleSaveBaseFee() {
    if (!editing) return;
    const baseFee = Number(baseFeeInput);
    if (!Number.isFinite(baseFee) || baseFee < 0 || !Number.isInteger(baseFee)) {
      toast({ title: t('admin.settings.invalidFee'), variant: 'destructive' });
      return;
    }
    try {
      await updateMutation.mutateAsync({ warehouseId: editing.warehouseId, baseFee });
      toast({ title: t('admin.settings.baseFeeSaved') });
      setEditing(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.settings.saveFailed');
      toast({ title: t('admin.settings.saveFailed'), description: message, variant: 'destructive' });
    }
  }

  if (error) return <ErrorState onRetry={() => refetch()} />;
  if (isLoading) {
    return <div className="rounded-md border p-8 text-center text-muted-foreground">{t('loading')}</div>;
  }
  if (!items || items.length === 0) {
    return <div className="rounded-md border p-8 text-center text-muted-foreground">{t('empty')}</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin.settings.pricingConfig')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.settings.warehouseCode')}</TableHead>
              <TableHead>{t('admin.settings.warehouseName')}</TableHead>
              <TableHead className="text-right">{t('admin.settings.baseFee')}</TableHead>
              <TableHead className="text-right">{t('admin.settings.perKmFee')}</TableHead>
              <TableHead className="text-right">{t('admin.settings.minOrderAmount')}</TableHead>
              <TableHead>{t('status')}</TableHead>
              <TableHead className="text-right">{t('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((row) => (
              <TableRow key={row.warehouseId}>
                <TableCell className="font-mono text-xs">{row.code}</TableCell>
                <TableCell>{(row.name as Record<string, string>)?.en ?? row.code}</TableCell>
                <TableCell className="text-right">{row.baseFee}</TableCell>
                <TableCell className="text-right">{row.perKmFee}</TableCell>
                <TableCell className="text-right">{row.minOrderAmount}</TableCell>
                <TableCell>
                  <Badge variant={row.status === 'ACTIVE' ? 'default' : 'secondary'}>
                    {row.status === 'ACTIVE' ? t('admin.settings.shopStatusActive') : t('admin.settings.shopStatusInactive')}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                    {t('admin.settings.editBaseFee')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.settings.editBaseFeeTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.settings.editBaseFeeDescription')}
              {editing ? ` (${editing.code})` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="baseFeeInput">{t('admin.settings.baseFee')}</Label>
            <Input
              id="baseFeeInput"
              type="number"
              min={0}
              value={baseFeeInput}
              onChange={(e) => setBaseFeeInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('admin.settings.baseFeeHint')}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSaveBaseFee} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? t('admin.settings.saving') : t('admin.settings.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ===== Platform Tab =====

function PlatformTab() {
  const t = useTranslations('common');
  const format = useFormatter();
  const { toast } = useToast();
  const { data: items, isLoading, error, refetch } = useSystemConfigs();
  const updateMutation = useUpdateSystemConfig();

  const [editing, setEditing] = useState<SystemConfigItem | null>(null);
  const [valueInput, setValueInput] = useState('');
  const [descInput, setDescInput] = useState('');

  function formatDateTime(date: string): string {
    return format.dateTime(new Date(date), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function openEdit(row: SystemConfigItem) {
    setEditing(row);
    setValueInput(row.value);
    setDescInput(row.description ?? '');
  }

  async function handleSaveConfig() {
    if (!editing) return;
    try {
      await updateMutation.mutateAsync({
        key: editing.key,
        value: valueInput,
        description: descInput.trim() === '' ? undefined : descInput.trim(),
      });
      toast({ title: t('admin.settings.configSaved') });
      setEditing(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.settings.saveFailed');
      toast({ title: t('admin.settings.saveFailed'), description: message, variant: 'destructive' });
    }
  }

  if (error) return <ErrorState onRetry={() => refetch()} />;
  if (isLoading) {
    return <div className="rounded-md border p-8 text-center text-muted-foreground">{t('loading')}</div>;
  }
  if (!items || items.length === 0) {
    return <div className="rounded-md border p-8 text-center text-muted-foreground">{t('empty')}</div>;
  }

  const groups = new Map<ConfigGroupPrefix | 'other', SystemConfigItem[]>();
  for (const item of items) {
    const g = configGroupOf(item.key);
    const arr = groups.get(g) ?? [];
    arr.push(item);
    groups.set(g, arr);
  }

  const groupOrder: Array<{ prefix: ConfigGroupPrefix | 'other'; labelKey: string }> = [
    { prefix: 'platform', labelKey: 'admin.settings.groupPlatform' },
    { prefix: 'delivery', labelKey: 'admin.settings.groupDelivery' },
    { prefix: 'rider', labelKey: 'admin.settings.groupRider' },
    { prefix: 'order', labelKey: 'admin.settings.groupOrder' },
    { prefix: 'other', labelKey: 'admin.settings.groupOther' },
  ];

  return (
    <div className="space-y-4">
      {groupOrder.map(({ prefix, labelKey }) => {
        const list = groups.get(prefix);
        if (!list || list.length === 0) return null;
        return (
          <Card key={prefix}>
            <CardHeader>
              <CardTitle>{t(labelKey as 'admin.settings.groupPlatform')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin.settings.configKey')}</TableHead>
                    <TableHead className="min-w-[200px]">{t('admin.settings.configValue')}</TableHead>
                    <TableHead>{t('admin.settings.configDescription')}</TableHead>
                    <TableHead>{t('admin.settings.updatedAt')}</TableHead>
                    <TableHead className="text-right">{t('actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="font-mono text-xs">{row.key}</TableCell>
                      <TableCell className="font-medium">{row.value}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.description ?? '-'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.updatedAt ? formatDateTime(row.updatedAt) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                          {t('admin.settings.editValue')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.settings.editValueTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.settings.editValueDescription')}
              {editing ? ` (${editing.key})` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="configValueInput">{t('admin.settings.configValue')}</Label>
              <Input
                id="configValueInput"
                value={valueInput}
                onChange={(e) => setValueInput(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="configDescInput">{t('admin.settings.configDescription')}</Label>
              <Textarea
                id="configDescInput"
                value={descInput}
                onChange={(e) => setDescInput(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSaveConfig} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? t('admin.settings.saving') : t('admin.settings.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
