/**
 * 分层运营页（客户画像批2 2026-10-18，D2/D3/D4/D7 + C5）
 *
 * 五个 Tab：
 *   - 看板（D2）：各层人数 / GMV / 占比条形 + 回购率（D3）
 *   - 交叉分析（D3）：买 X 还买 Y 共现
 *   - 券归因（D4）：按层领取/核销/复购
 *   - 导出与发券（D7）：CSV 导出（查看即审计）+ 批量发券（幂等）
 *   - 分层定向券（C5）：规则 CRUD
 */
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { getLocale } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import {
  SEGMENT_STAGES,
  useSegmentDashboard,
  useSegmentRepurchase,
  useCoPurchase,
  useCouponAttribution,
  useGrantCoupons,
  useSegmentCouponRules,
  useCreateSegmentCouponRule,
  useDeleteSegmentCouponRule,
  downloadSegmentCsv,
  type SegmentStage,
} from '@/hooks/api/use-segments';

function stageLabelKey(stage: string): string {
  const map: Record<string, string> = {
    NEW: 'admin.marketing.stageNew',
    FIRST_PURCHASE: 'admin.marketing.stageFirstPurchase',
    ACTIVE: 'admin.marketing.stageActive',
    SLEEPING: 'admin.marketing.stageSleeping',
    CHURNED: 'admin.marketing.stageChurned',
  };
  return map[stage] ?? 'admin.marketing.stageNew';
}

function pct(v: number | null | undefined): string {
  if (v == null) return '-';
  return `${Math.round(v * 100)}%`;
}

// ===== Tab 1: 看板（D2 + D3 回购率） =====
function DashboardTab() {
  const t = useTranslations('common');
  const { data, isLoading } = useSegmentDashboard();
  const { data: rep } = useSegmentRepurchase();

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">{t('loading')}</CardContent>
      </Card>
    );
  }

  const repMap = new Map((rep?.stages ?? []).map((r) => [r.stage, r]));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.marketing.colUsers')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl">{data.totalUsers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.marketing.colGmv')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl">
              {formatCurrency(data.buckets.reduce((s, b) => s + b.gmvTotal, 0))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.marketing.tabDashboard')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{data.generatedAt.slice(0, 10)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t('admin.marketing.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.marketing.colStage')}</TableHead>
                <TableHead className="text-right">{t('admin.marketing.colUsers')}</TableHead>
                <TableHead className="text-right">{t('admin.marketing.colGmv')}</TableHead>
                <TableHead>{t('admin.marketing.colGmvShare')}</TableHead>
                <TableHead className="text-right">{t('admin.marketing.colRepurchaseRate')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.buckets.map((b) => {
                const r = repMap.get(b.stage);
                return (
                  <TableRow key={b.stage}>
                    <TableCell>
                      <Badge variant="outline">{t(stageLabelKey(b.stage))}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">{b.userCount}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(b.gmvTotal)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded bg-muted">
                          <div
                            className="h-full rounded bg-primary"
                            style={{ width: `${Math.round(b.gmvShare * 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs">{pct(b.gmvShare)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{pct(r?.repurchaseRate)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ===== Tab 2: 交叉分析（D3 共现） =====
function CoPurchaseTab() {
  const t = useTranslations('common');
  const [input, setInput] = useState('');
  const [productId, setProductId] = useState<string | undefined>();
  const { data, isLoading } = useCoPurchase(productId);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('admin.marketing.coPurchaseTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('admin.marketing.coPurchaseProductPlaceholder')}
            className="max-w-md"
          />
          <Button onClick={() => setProductId(input.trim() || undefined)} disabled={!input.trim()}>
            {t('admin.marketing.coPurchaseSearch')}
          </Button>
        </div>
        {isLoading && <p className="text-sm text-muted-foreground">{t('loading')}</p>}
        {!isLoading && data && (
          <>
            <p className="text-sm text-muted-foreground">
              {t('admin.marketing.coPurchaseProduct')}: {data.product.name} ·{' '}
              {t('admin.marketing.coPurchaseBase')}: <span className="font-mono">{data.baseOrderCount}</span>
            </p>
            {data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('admin.marketing.coPurchaseEmpty')}</p>
            ) : (
              <div className="space-y-2">
                {data.items.map((item) => (
                  <div key={item.productId} className="flex items-center gap-2 text-sm">
                    <span className="w-48 shrink-0 truncate">{item.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className="h-full rounded bg-primary"
                        style={{ width: `${Math.round(item.share * 100)}%` }}
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right font-mono text-xs">
                      {item.coOrderCount} · {pct(item.share)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ===== Tab 3: 券归因（D4） =====
function CouponAttributionTab() {
  const t = useTranslations('common');
  const [input, setInput] = useState('');
  const [promotionId, setPromotionId] = useState<string | undefined>();
  const { data, isLoading } = useCouponAttribution(promotionId);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('admin.marketing.tabCoupon')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('admin.marketing.couponPromotionPlaceholder')}
            className="max-w-md"
          />
          <Button onClick={() => setPromotionId(input.trim() || undefined)} disabled={!input.trim()}>
            {t('admin.marketing.couponSearch')}
          </Button>
        </div>
        {isLoading && <p className="text-sm text-muted-foreground">{t('loading')}</p>}
        {!isLoading && data && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.marketing.colStage')}</TableHead>
                <TableHead className="text-right">{t('admin.marketing.colClaimed')}</TableHead>
                <TableHead className="text-right">{t('admin.marketing.colRedeemed')}</TableHead>
                <TableHead className="text-right">{t('admin.marketing.colRedeemRate')}</TableHead>
                <TableHead className="text-right">{t('admin.marketing.colRepurchaseOrders')}</TableHead>
                <TableHead className="text-right">{t('admin.marketing.colUserCount')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.stage}>
                  <TableCell>
                    <Badge variant="outline">{t(stageLabelKey(r.stage))}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{r.claimed}</TableCell>
                  <TableCell className="text-right font-mono">{r.redeemed}</TableCell>
                  <TableCell className="text-right font-mono">{pct(r.redeemRate)}</TableCell>
                  <TableCell className="text-right font-mono">{r.repurchaseOrders}</TableCell>
                  <TableCell className="text-right font-mono">{r.userCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ===== Tab 4: 导出与发券（D7） =====
function ExportGrantTab() {
  const t = useTranslations('common');
  const { toast } = useToast();
  const [stage, setStage] = useState<SegmentStage>('ACTIVE');
  const [promotionId, setPromotionId] = useState('');
  const [userIdsText, setUserIdsText] = useState('');
  const [result, setResult] = useState<{ granted: number; skipped: number; failed: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const grant = useGrantCoupons();

  function handleExport() {
    setExporting(true);
    downloadSegmentCsv(stage, getLocale())
      .catch((err: Error) =>
        toast({ title: t('admin.promotions.toastFailed'), description: err.message, variant: 'destructive' }),
      )
      .finally(() => setExporting(false));
  }

  function handleGrant() {
    const userIds = userIdsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!promotionId.trim() || userIds.length === 0) return;
    grant.mutate(
      { promotionId: promotionId.trim(), userIds },
      {
        onSuccess: (data) => {
          setResult({ granted: data.granted, skipped: data.skipped, failed: data.failed });
          toast({ title: t('admin.marketing.grantSubmit') });
        },
        onError: (err: Error) =>
          toast({ title: t('admin.promotions.toastFailed'), description: err.message, variant: 'destructive' }),
      },
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t('admin.marketing.exportButton')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label>{t('admin.marketing.exportStage')}</Label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value as SegmentStage)}
                className="block rounded border bg-background px-2 py-1.5 text-sm"
              >
                {SEGMENT_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {t(stageLabelKey(s))}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={handleExport} disabled={exporting}>
              {exporting ? t('loading') : t('admin.marketing.exportButton')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('admin.customers.auditViewedNote')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t('admin.marketing.grantTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="grant-promotion">{t('admin.marketing.grantPromotion')}</Label>
            <Input
              id="grant-promotion"
              value={promotionId}
              onChange={(e) => setPromotionId(e.target.value)}
              className="max-w-md"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="grant-users">{t('admin.marketing.grantUserIds')}</Label>
            <Textarea
              id="grant-users"
              value={userIdsText}
              onChange={(e) => setUserIdsText(e.target.value)}
              rows={5}
              className="max-w-md font-mono text-xs"
            />
          </div>
          <Button onClick={handleGrant} disabled={grant.isPending || !promotionId.trim()}>
            {grant.isPending ? t('loading') : t('admin.marketing.grantSubmit')}
          </Button>
          {result && (
            <p className="text-sm">
              {t('admin.marketing.grantResult', {
                granted: result.granted,
                skipped: result.skipped,
                failed: result.failed,
              })}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ===== Tab 5: 分层定向券规则（C5） =====
function RulesTab() {
  const t = useTranslations('common');
  const { toast } = useToast();
  const { data, isLoading } = useSegmentCouponRules();
  const createRule = useCreateSegmentCouponRule();
  const deleteRule = useDeleteSegmentCouponRule();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<{ stage: SegmentStage; promotionId: string }>({
    stage: 'ACTIVE',
    promotionId: '',
  });

  const rules = data?.items ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{t('admin.marketing.tabRules')}</CardTitle>
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
          {t('admin.marketing.ruleAdd')}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('admin.marketing.ruleEmpty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.marketing.ruleStage')}</TableHead>
                <TableHead>{t('admin.marketing.rulePromotion')}</TableHead>
                <TableHead>{t('admin.marketing.ruleEnabled')}</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge variant="outline">{t(stageLabelKey(r.stage))}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.promotionId}</TableCell>
                  <TableCell>
                    <Badge variant={r.enabled ? 'success' : 'secondary'}>
                      {r.enabled ? t('admin.marketing.ruleEnabled') : '-'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        deleteRule.mutate(r.id, {
                          onError: (err: Error) =>
                            toast({
                              title: t('admin.promotions.toastFailed'),
                              description: err.message,
                              variant: 'destructive',
                            }),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('admin.marketing.ruleAdd')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>{t('admin.marketing.ruleStage')}</Label>
                <select
                  value={form.stage}
                  onChange={(e) => setForm({ ...form, stage: e.target.value as SegmentStage })}
                  className="block w-full rounded border bg-background px-2 py-1.5 text-sm"
                >
                  {SEGMENT_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {t(stageLabelKey(s))}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-promotion">{t('admin.marketing.rulePromotion')}</Label>
                <Input
                  id="rule-promotion"
                  value={form.promotionId}
                  onChange={(e) => setForm({ ...form, promotionId: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>
                {t('admin.customers.commonCancel')}
              </Button>
              <Button
                disabled={!form.promotionId.trim() || createRule.isPending}
                onClick={() =>
                  createRule.mutate(
                    { stage: form.stage, promotionId: form.promotionId.trim() },
                    {
                      onSuccess: () => {
                        setAddOpen(false);
                        setForm({ stage: 'ACTIVE', promotionId: '' });
                        toast({ title: t('admin.promotions.toastUpdated') });
                      },
                      onError: (err: Error) =>
                        toast({
                          title: t('admin.promotions.toastFailed'),
                          description: err.message,
                          variant: 'destructive',
                        }),
                    },
                  )
                }
              >
                {t('admin.marketing.ruleAdd')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export default function SegmentsPage() {
  const t = useTranslations('common');
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">{t('admin.marketing.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.marketing.description')}</p>
      </div>
      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">{t('admin.marketing.tabDashboard')}</TabsTrigger>
          <TabsTrigger value="co-purchase">{t('admin.marketing.tabCoPurchase')}</TabsTrigger>
          <TabsTrigger value="coupon">{t('admin.marketing.tabCoupon')}</TabsTrigger>
          <TabsTrigger value="export">{t('admin.marketing.tabExport')}</TabsTrigger>
          <TabsTrigger value="rules">{t('admin.marketing.tabRules')}</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard">
          <DashboardTab />
        </TabsContent>
        <TabsContent value="co-purchase">
          <CoPurchaseTab />
        </TabsContent>
        <TabsContent value="coupon">
          <CouponAttributionTab />
        </TabsContent>
        <TabsContent value="export">
          <ExportGrantTab />
        </TabsContent>
        <TabsContent value="rules">
          <RulesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
