/**
 * 仓库详情/编辑页 — /warehouses/[id]
 *
 * 后端：
 *   - GET/PATCH /admin/warehouses/:id（基本信息 + 启停）
 *   - PATCH /admin/warehouses/:id/coverage（配送范围）
 *   - GET /admin/inventory/stocks?warehouseId=xxx
 *   - PATCH /admin/inventory/stocks
 *   - GET /admin/inventory/logs?warehouseId=xxx
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  useWarehouse,
  useUpdateWarehouse,
  useUpdateWarehouseCoverage,
} from '@/hooks/api/use-warehouses';
import { useToast } from '@/hooks/use-toast';
import { useStocks, useStockLogs, useAdjustStock, type Stock, type StockLog } from '@/hooks/api/use-inventory';
import type { I18nText } from '@/hooks/api/use-products';

type Locale = 'en' | 'zh' | 'id' | 'pt';

export default function WarehouseDetailPage() {
  const t = useTranslations('common');
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const warehouseQ = useWarehouse(id);
  const updateMutation = useUpdateWarehouse();
  const coverageMutation = useUpdateWarehouseCoverage();
  const stocksQ = useStocks({ warehouseId: id });
  const logsQ = useStockLogs(id);
  const { toast } = useToast();

  const [name, setName] = useState<I18nText>({});
  const [address, setAddress] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [coverageJson, setCoverageJson] = useState('');

  useEffect(() => {
    if (warehouseQ.data?.data) {
      const w = warehouseQ.data.data;
      setName(w.name ?? {});
      setAddress(w.address ?? '');
      setIsActive(w.isActive);
      setCoverageJson(w.coverageArea ? JSON.stringify(w.coverageArea, null, 2) : '');
    }
  }, [warehouseQ.data]);

  if (warehouseQ.isLoading) return <LoadingSkeleton lines={8} />;
  if (warehouseQ.error)
    return <ErrorState message={warehouseQ.error.message} onRetry={() => warehouseQ.refetch()} />;
  if (!warehouseQ.data?.data) return null;

  const warehouse = warehouseQ.data.data;

  const saveBasic = async () => {
    await updateMutation.mutateAsync({
      id,
      input: { name, address, isActive },
    });
  };

  const toggleActive = async () => {
    const next = !isActive;
    setIsActive(next);
    await updateMutation.mutateAsync({ id, input: { isActive: next } });
  };

  const saveCoverage = async () => {
    try {
      const parsed = JSON.parse(coverageJson);
      await coverageMutation.mutateAsync({ id, input: { coverageArea: parsed } });
      toast({ title: t('w.warehouses.coverageSaved'), variant: 'success' });
    } catch (e) {
      toast({
        title: t('w.warehouses.invalidJson'),
        description: (e as Error).message,
        variant: 'destructive',
      });
    }
  };

  const i18nInputs = (
    label: string,
    value: I18nText,
    onChange: (v: I18nText) => void,
  ) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {(['en', 'zh', 'id', 'pt'] as Locale[]).map((locale) => (
          <div key={locale} className="space-y-1">
            <Label className="text-xs uppercase text-muted-foreground">{locale}</Label>
            <Input
              value={value[locale] ?? ''}
              onChange={(e) => onChange({ ...value, [locale]: e.target.value })}
            />
          </div>
        ))}
      </div>
    </div>
  );

  const stockColumns: Column<Stock>[] = [
    {
      key: 'skuId',
      header: t('w.warehouses.columnSkuId'),
      render: (row) => <code className="text-xs">{row.skuId.slice(0, 8)}...</code>,
    },
    {
      key: 'quantity',
      header: t('w.warehouses.columnQuantity'),
      render: (row) => <span className="font-mono">{row.quantity}</span>,
    },
    {
      key: 'safetyStock',
      header: t('w.warehouses.columnSafety'),
      render: (row) => (
        <span className="text-muted-foreground">{row.safetyStock ?? '—'}</span>
      ),
    },
  ];

  const logColumns: Column<StockLog>[] = [
    {
      key: 'createdAt',
      header: t('w.warehouses.columnTime'),
      render: (row) => (
        <span className="font-mono text-xs">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'skuId',
      header: t('w.warehouses.columnSku'),
      render: (row) => <code className="text-xs">{row.skuId.slice(0, 8)}...</code>,
    },
    {
      key: 'change',
      header: t('w.warehouses.columnChange'),
      render: (row) => (
        <span className={row.change >= 0 ? 'text-green-600' : 'text-destructive'}>
          {row.change >= 0 ? '+' : ''}
          {row.change}
        </span>
      ),
    },
    {
      key: 'afterQuantity',
      header: t('w.warehouses.columnAfter'),
      render: (row) => <span className="font-mono">{row.afterQuantity}</span>,
    },
    {
      key: 'reason',
      header: t('w.warehouses.columnReason'),
      render: (row) => (
        <span className="text-muted-foreground">{row.reason ?? '—'}</span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={`${warehouse.code} · ${warehouse.name?.en ?? warehouse.name?.zh ?? warehouse.id}`}
        breadcrumb={[
          { label: t('w.warehouses.title'), href: '/warehouses' },
          { label: warehouse.code },
        ]}
        action={
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">{t('w.form.active')}</Label>
            <Switch
              checked={isActive}
              onCheckedChange={toggleActive}
              disabled={updateMutation.isPending}
            />
          </div>
        }
      />

      <Tabs defaultValue="basic">
        <TabsList>
          <TabsTrigger value="basic">{t('w.warehouses.tabBasic')}</TabsTrigger>
          <TabsTrigger value="coverage">{t('w.warehouses.tabCoverage')}</TabsTrigger>
          <TabsTrigger value="inventory">{t('w.warehouses.tabInventory')}</TabsTrigger>
          <TabsTrigger value="logs">{t('w.warehouses.tabLogs')}</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('w.warehouses.editWarehouseTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {i18nInputs(t('w.form.name'), name, setName)}
              <div className="space-y-2">
                <Label>{t('w.form.address')}</Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push('/warehouses')}
                >
                  {t('w.form.back')}
                </Button>
                <Button
                  type="button"
                  onClick={saveBasic}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? t('w.form.saving') : t('w.form.save')}
                </Button>
              </div>
              {updateMutation.error && (
                <p className="text-sm text-destructive">
                  {t('w.form.saveFailed', { message: updateMutation.error.message })}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="coverage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('w.warehouses.coverageAreaTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {t('w.warehouses.coverageHintFormat')}{' '}
                <code className="ml-1 rounded bg-muted px-1">
                  {`{"type":"Polygon","coordinates":[[[lng,lat],...]]}`}
                </code>
              </p>
              <Textarea
                value={coverageJson}
                onChange={(e) => setCoverageJson(e.target.value)}
                rows={12}
                className="font-mono text-xs"
                placeholder='{ "type": "Polygon", "coordinates": [[[125.55, -8.56], ...]] }'
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  onClick={saveCoverage}
                  disabled={coverageMutation.isPending}
                >
                  {coverageMutation.isPending
                    ? t('w.form.saving')
                    : t('w.warehouses.saveCoverage')}
                </Button>
              </div>
              {coverageMutation.error && (
                <p className="text-sm text-destructive">
                  {t('w.form.saveFailed', { message: coverageMutation.error.message })}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t('w.warehouses.stockListTitle')}</CardTitle>
              <AdjustStockDialog warehouseId={id} />
            </CardHeader>
            <CardContent>
              <DataTable
                data={
                  Array.isArray(stocksQ.data?.data)
                    ? (stocksQ.data.data as Stock[])
                    : (stocksQ.data?.data as { items?: Stock[] })?.items ?? []
                }
                columns={stockColumns}
                isLoading={stocksQ.isLoading}
                errorState={
                  stocksQ.error ? (
                    <ErrorState message={stocksQ.error.message} onRetry={() => stocksQ.refetch()} />
                  ) : null
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('w.warehouses.stockLogsTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={logsQ.data?.data ?? []}
                columns={logColumns}
                isLoading={logsQ.isLoading}
                errorState={
                  logsQ.error ? (
                    <ErrorState message={logsQ.error.message} onRetry={() => logsQ.refetch()} />
                  ) : null
                }
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function AdjustStockDialog({ warehouseId }: { warehouseId: string }) {
  const t = useTranslations('common');
  const adjustMutation = useAdjustStock();
  const [open, setOpen] = useState(false);
  const [skuId, setSkuId] = useState('');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const d = parseInt(delta, 10);
    if (isNaN(d) || !skuId) return;
    adjustMutation.mutate({
      warehouseId,
      skuId,
      delta: d,
      reason: reason || undefined,
    });
    setOpen(false);
    setSkuId('');
    setDelta('');
    setReason('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          {t('w.warehouses.adjustStock')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('w.warehouses.adjustStockDialogTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label>{t('w.warehouses.skuIdLabel')}</Label>
            <Input
              value={skuId}
              onChange={(e) => setSkuId(e.target.value)}
              placeholder={t('w.warehouses.skuIdPlaceholder')}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>{t('w.warehouses.deltaLabel')}</Label>
            <Input
              type="number"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder={t('w.warehouses.deltaPlaceholder')}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>{t('w.warehouses.reasonLabel')}</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('w.warehouses.reasonPlaceholder')}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('w.form.cancel')}
            </Button>
            <Button type="submit" disabled={adjustMutation.isPending}>
              {adjustMutation.isPending ? t('w.form.adjusting') : t('w.form.confirm')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
