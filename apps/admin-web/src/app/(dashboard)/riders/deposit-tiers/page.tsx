/**
 * 保证金规则页（档位 CRUD）— /riders/deposit-tiers（批 E，2026-09-03）
 *
 * 后端：GET/POST /admin/deposit/tiers + PATCH/DELETE /admin/deposit/tiers/:id
 *   - DELETE = 软停用（enabled=false，保留历史档定义）
 *   - 停用语义（批 D 拍板）：档位完全退出派单资格，已缴该档骑手上限实时回落
 *
 * 交互：
 *   - 新增/编辑 Dialog（minAmount / maxOrderAmount 空=不限 / sortOrder / enabled）
 *   - 停用确认 Dialog：提示「将影响已缴该档骑手上限」（任务书 §三）
 *   - 规则实时生效说明（存量骑手自动按新档位重算上限，无数据回填）
 */
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Plus, Pencil, Ban } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  useDepositTiers,
  useCreateTier,
  useUpdateTier,
  useDeleteTier,
  type RiderDepositTier,
} from '@/hooks/api/use-deposit';
import { formatCurrency } from '@/lib/utils';
import { ApiError } from '@/lib/api';

/** 表单状态：金额输入按 dollar（展示直觉），提交转 cents */
interface TierFormState {
  minAmount: string;
  maxOrderAmount: string;
  sortOrder: string;
}

const EMPTY_FORM: TierFormState = { minAmount: '', maxOrderAmount: '', sortOrder: '' };

export default function DepositTiersPage() {
  const t = useTranslations('common');
  const { toast } = useToast();

  const { data: tiers, isPending, isError, refetch } = useDepositTiers();
  const createTier = useCreateTier();
  const updateTier = useUpdateTier();
  const deleteTier = useDeleteTier();

  // 编辑 Dialog（null=关闭；'new'=新增；其他=编辑该档 id）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TierFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  // 停用确认 Dialog
  const [disabling, setDisabling] = useState<RiderDepositTier | null>(null);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditingId('new');
  }

  function openEdit(tier: RiderDepositTier) {
    setForm({
      minAmount: (tier.minAmount / 100).toString(),
      maxOrderAmount: tier.maxOrderAmount === null ? '' : (tier.maxOrderAmount / 100).toString(),
      sortOrder: String(tier.sortOrder),
    });
    setFormError(null);
    setEditingId(tier.id);
  }

  /** dollar → cents；空串 maxOrderAmount = 不限（null） */
  function parseForm(): { minAmount: number; maxOrderAmount: number | null; sortOrder: number } | { error: string } {
    const minDollar = Number(form.minAmount);
    if (!Number.isFinite(minDollar) || minDollar < 1) {
      return { error: t('admin.deposit.tiers.errorMinAmount') };
    }
    const maxDollar = form.maxOrderAmount === '' ? null : Number(form.maxOrderAmount);
    if (maxDollar !== null && (!Number.isFinite(maxDollar) || maxDollar <= minDollar)) {
      return { error: t('admin.deposit.tiers.errorMaxAmount') };
    }
    const sortOrder = Number(form.sortOrder);
    if (!Number.isFinite(sortOrder) || sortOrder < 0) {
      return { error: t('admin.deposit.tiers.errorSortOrder') };
    }
    return {
      minAmount: Math.round(minDollar * 100),
      maxOrderAmount: maxDollar === null ? null : Math.round(maxDollar * 100),
      sortOrder,
    };
  }

  async function handleSubmit() {
    const parsed = parseForm();
    if ('error' in parsed) {
      setFormError(parsed.error);
      return;
    }
    setFormError(null);
    try {
      if (editingId === 'new') {
        await createTier.mutateAsync({ ...parsed, enabled: true });
        toast({ description: t('admin.deposit.tiers.toastCreated') });
      } else if (editingId) {
        await updateTier.mutateAsync({ id: editingId, input: parsed });
        toast({ description: t('admin.deposit.tiers.toastUpdated') });
      }
      setEditingId(null);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : t('common.error.generic'));
    }
  }

  async function handleDisable() {
    if (!disabling) return;
    try {
      await deleteTier.mutateAsync({ id: disabling.id });
      toast({ description: t('admin.deposit.tiers.toastDisabled') });
    } catch (e) {
      toast({
        variant: 'destructive',
        description: e instanceof ApiError ? e.message : t('common.error.generic'),
      });
    } finally {
      setDisabling(null);
    }
  }

  const columns: Column<RiderDepositTier>[] = [
    {
      key: 'minAmount',
      header: t('admin.deposit.tiers.columnMinAmount'),
      render: (tier) => <span className="font-medium">{formatCurrency(tier.minAmount)}</span>,
    },
    {
      key: 'maxOrderAmount',
      header: t('admin.deposit.tiers.columnMaxOrderAmount'),
      render: (tier) =>
        tier.maxOrderAmount === null ? (
          <Badge variant="secondary">{t('admin.deposit.tiers.unlimited')}</Badge>
        ) : (
          formatCurrency(tier.maxOrderAmount)
        ),
    },
    { key: 'sortOrder', header: t('admin.deposit.tiers.columnSortOrder') },
    {
      key: 'enabled',
      header: t('admin.deposit.tiers.columnEnabled'),
      render: (tier) => (
        <StatusBadge
          status={tier.enabled ? 'ACTIVE' : 'INACTIVE'}
          label={tier.enabled ? t('admin.deposit.tiers.enabled') : t('admin.deposit.tiers.disabled')}
        />
      ),
    },
    {
      key: 'actions',
      header: t('admin.deposit.tiers.columnActions'),
      render: (tier) => (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => openEdit(tier)}>
            <Pencil className="mr-1 h-3 w-3" />
            {t('admin.deposit.tiers.actionEdit')}
          </Button>
          {tier.enabled && (
            <Button variant="outline" size="sm" onClick={() => setDisabling(tier)}>
              <Ban className="mr-1 h-3 w-3" />
              {t('admin.deposit.tiers.actionDisable')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const mutating = createTier.isPending || updateTier.isPending;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t('admin.deposit.tiers.title')}
        description={t('admin.deposit.tiers.description')}
      />

      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {t('admin.deposit.tiers.actionCreate')}
        </Button>
      </div>

      {isPending ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !tiers || tiers.length === 0 ? (
        <EmptyState title={t('admin.deposit.tiers.emptyTitle')} description={t('admin.deposit.tiers.emptyDescription')} />
      ) : (
        <DataTable columns={columns} data={tiers} />
      )}

      {/* 新增/编辑 Dialog */}
      <Dialog open={editingId !== null} onOpenChange={(open) => !open && setEditingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId === 'new' ? t('admin.deposit.tiers.dialogCreateTitle') : t('admin.deposit.tiers.dialogEditTitle')}
            </DialogTitle>
            <DialogDescription>{t('admin.deposit.tiers.dialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tier-min">{t('admin.deposit.tiers.columnMinAmount')}</Label>
              <Input
                id="tier-min"
                type="number"
                min={1}
                step="0.01"
                value={form.minAmount}
                onChange={(e) => setForm({ ...form, minAmount: e.target.value })}
                placeholder="1.00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tier-max">{t('admin.deposit.tiers.columnMaxOrderAmount')}</Label>
              <Input
                id="tier-max"
                type="number"
                min={0}
                step="0.01"
                value={form.maxOrderAmount}
                onChange={(e) => setForm({ ...form, maxOrderAmount: e.target.value })}
                placeholder={t('admin.deposit.tiers.unlimitedPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tier-sort">{t('admin.deposit.tiers.columnSortOrder')}</Label>
              <Input
                id="tier-sort"
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                placeholder="1"
              />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingId(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={mutating}>
              {mutating && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 停用确认 Dialog（任务书：提示将影响已缴该档骑手上限） */}
      <Dialog open={disabling !== null} onOpenChange={(open) => !open && setDisabling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.deposit.tiers.disableConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {disabling &&
                t('admin.deposit.tiers.disableConfirmBody', {
                  min: formatCurrency(disabling.minAmount),
                  max:
                    disabling.maxOrderAmount === null
                      ? t('admin.deposit.tiers.unlimited')
                      : formatCurrency(disabling.maxOrderAmount),
                })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisabling(null)}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDisable} disabled={deleteTier.isPending}>
              {deleteTier.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('admin.deposit.tiers.actionDisable')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
