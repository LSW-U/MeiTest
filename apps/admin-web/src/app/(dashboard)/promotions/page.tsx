/**
 * 营销管理页 - /promotions
 *
 * W7-ext-G 实现（2026-07-10）
 * 后端 7 endpoints（/api/v1/admin/promotions）
 *
 * 功能：
 *   - 列表（status / type / keyword 筛选）
 *   - 新建促销 Dialog（3 类型）
 *   - 编辑 Dialog
 *   - 激活 / 暂停 / 删除 动作
 */
'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  usePromotions,
  useCreatePromotion,
  useUpdatePromotion,
  useActivatePromotion,
  usePausePromotion,
  useDeletePromotion,
  type Promotion,
  type PromotionType,
  type PromotionStatus,
  type CreatePromotionInput,
  type UpdatePromotionInput,
} from '@/hooks/api/use-promotions';

const STATUS_FILTERS = ['ALL', 'ACTIVE', 'PAUSED', 'DELETED'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const TYPE_FILTERS = ['ALL', 'PERCENTAGE', 'FIXED_AMOUNT', 'FREE_DELIVERY'] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

const TYPE_OPTIONS: PromotionType[] = ['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_DELIVERY'];

function toLocalDatetimeInput(iso: string): string {
  // ISO -> "YYYY-MM-DDTHH:MM" 本地时间（datetime-local input 格式）
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalDatetimeInput(local: string): string {
  // datetime-local -> ISO（带 Z）
  if (!local) return '';
  return new Date(local).toISOString();
}

export default function PromotionsPage() {
  const t = useTranslations('common');
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [keyword, setKeyword] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Promotion | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Promotion | null>(null);

  const params = {
    ...(statusFilter !== 'ALL' ? { status: statusFilter as PromotionStatus } : {}),
    ...(typeFilter !== 'ALL' ? { type: typeFilter as PromotionType } : {}),
    ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
  };
  const { data, isLoading, error, refetch } = usePromotions(params);
  const createMutation = useCreatePromotion();
  const updateMutation = useUpdatePromotion();
  const activateMutation = useActivatePromotion();
  const pauseMutation = usePausePromotion();
  const deleteMutation = useDeletePromotion();

  const items: Promotion[] = data ?? [];

  function handleActivate(promo: Promotion) {
    activateMutation.mutate(
      { id: promo.id },
      {
        onSuccess: () => toast({ title: t('admin.promotions.toastActivated') }),
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : t('admin.promotions.toastFailed');
          toast({ title: t('admin.promotions.toastFailed'), description: message, variant: 'destructive' });
        },
      },
    );
  }

  function handlePause(promo: Promotion) {
    pauseMutation.mutate(
      { id: promo.id },
      {
        onSuccess: () => toast({ title: t('admin.promotions.toastPaused') }),
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : t('admin.promotions.toastFailed');
          toast({ title: t('admin.promotions.toastFailed'), description: message, variant: 'destructive' });
        },
      },
    );
  }

  function handleDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => {
          toast({ title: t('admin.promotions.toastDeleted') });
          setDeleteTarget(null);
        },
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : t('admin.promotions.toastFailed');
          toast({ title: t('admin.promotions.toastFailed'), description: message, variant: 'destructive' });
        },
      },
    );
  }

  const columns: Column<Promotion>[] = [
    {
      key: 'code',
      header: t('admin.promotions.columnCode'),
      render: (row) => <span className="font-mono font-medium">{row.code}</span>,
    },
    {
      key: 'name',
      header: t('admin.promotions.columnName'),
      render: (row) => <span>{row.name}</span>,
    },
    {
      key: 'type',
      header: t('admin.promotions.columnType'),
      render: (row) => (
        <Badge variant="outline">
          {t(`admin.promotions.type${row.type === 'PERCENTAGE' ? 'Percentage' : row.type === 'FIXED_AMOUNT' ? 'FixedAmount' : 'FreeDelivery'}` as 'admin.promotions.typePercentage')}
        </Badge>
      ),
    },
    {
      key: 'value',
      header: t('admin.promotions.columnValue'),
      render: (row) => (
        <span className="font-mono text-xs">
          {row.type === 'PERCENTAGE' ? `${row.value}%` : row.type === 'FIXED_AMOUNT' ? row.value : '-'}
        </span>
      ),
    },
    {
      key: 'quota',
      header: t('admin.promotions.columnQuota'),
      render: (row) => (
        <span className="font-mono text-xs">
          {row.usedCount}/{row.totalQuota ?? '∞'}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('admin.promotions.columnStatus'),
      render: (row) => (
        <StatusBadge
          status={row.status}
          label={t(`admin.promotions.status${row.status === 'ACTIVE' ? 'Active' : row.status === 'PAUSED' ? 'Paused' : 'Deleted'}` as 'admin.promotions.statusActive')}
        />
      ),
    },
    {
      key: 'createdBy',
      header: t('admin.promotions.columnCreatedBy'),
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground" title={row.createdBy}>
          {row.createdBy.slice(0, 8)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('admin.promotions.columnActions'),
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.status !== 'DELETED' && (
            <Button size="sm" variant="outline" onClick={() => setEditTarget(row)}>
              {t('admin.promotions.editButton')}
            </Button>
          )}
          {row.status === 'PAUSED' && (
            <Button size="sm" onClick={() => handleActivate(row)} disabled={activateMutation.isPending}>
              {t('admin.promotions.activateButton')}
            </Button>
          )}
          {row.status === 'ACTIVE' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handlePause(row)}
              disabled={pauseMutation.isPending}
            >
              {t('admin.promotions.pauseButton')}
            </Button>
          )}
          {row.status !== 'DELETED' && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setDeleteTarget(row)}
              disabled={deleteMutation.isPending}
            >
              {t('admin.promotions.deleteButton')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t('admin.promotions.title')}
        description={t('admin.promotions.description')}
        action={
          <Button onClick={() => setCreateOpen(true)}>{t('admin.promotions.createButton')}</Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'ALL'
                  ? t('admin.promotions.statusAll')
                  : t(`admin.promotions.status${s === 'ACTIVE' ? 'Active' : s === 'PAUSED' ? 'Paused' : 'Deleted'}` as 'admin.promotions.statusActive')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_FILTERS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'ALL'
                  ? t('admin.promotions.typeAll')
                  : t(`admin.promotions.type${s === 'PERCENTAGE' ? 'Percentage' : s === 'FIXED_AMOUNT' ? 'FixedAmount' : 'FreeDelivery'}` as 'admin.promotions.typePercentage')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="w-[240px]"
          placeholder={t('admin.promotions.searchPlaceholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">{t('loading')}</div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('admin.promotions.empty')}
          description={t('admin.promotions.emptyDescription')}
        />
      ) : (
        <DataTable data={items} columns={columns} />
      )}

      <PromotionFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSubmit={async (input) => {
          try {
            await createMutation.mutateAsync(input as CreatePromotionInput);
            toast({ title: t('admin.promotions.toastCreated') });
            setCreateOpen(false);
          } catch (err) {
            const message = err instanceof ApiError ? err.message : t('admin.promotions.toastFailed');
            toast({ title: t('admin.promotions.toastFailed'), description: message, variant: 'destructive' });
            throw err;
          }
        }}
        pending={createMutation.isPending}
      />

      <PromotionFormDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        mode="edit"
        promotion={editTarget}
        onSubmit={async (input) => {
          if (!editTarget) return;
          try {
            await updateMutation.mutateAsync({ id: editTarget.id, input: input as UpdatePromotionInput });
            toast({ title: t('admin.promotions.toastUpdated') });
            setEditTarget(null);
          } catch (err) {
            const message = err instanceof ApiError ? err.message : t('admin.promotions.toastFailed');
            toast({ title: t('admin.promotions.toastFailed'), description: message, variant: 'destructive' });
            throw err;
          }
        }}
        pending={updateMutation.isPending}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.promotions.deleteDialogTitle')}</DialogTitle>
            <DialogDescription>{t('admin.promotions.deleteDialogDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? t('loading') : t('admin.promotions.deleteDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===== 表单 Dialog（创建 + 编辑共用） =====

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  promotion?: Promotion | null;
  onSubmit: (input: CreatePromotionInput | UpdatePromotionInput) => Promise<void>;
  pending: boolean;
}

function PromotionFormDialog({ open, onOpenChange, mode, promotion, onSubmit, pending }: FormDialogProps) {
  const t = useTranslations('common');

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<PromotionType>('PERCENTAGE');
  const [value, setValue] = useState('10');
  const [minOrderAmount, setMinOrderAmount] = useState('0');
  const [maxDiscountAmount, setMaxDiscountAmount] = useState('');
  const [totalQuota, setTotalQuota] = useState('');
  const [perUserLimit, setPerUserLimit] = useState('1');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && promotion) {
      setCode(promotion.code);
      setName(promotion.name);
      setDescription(promotion.description ?? '');
      setType(promotion.type);
      setValue(String(promotion.value));
      setMinOrderAmount(String(promotion.minOrderAmount));
      setMaxDiscountAmount(promotion.maxDiscountAmount ? String(promotion.maxDiscountAmount) : '');
      setTotalQuota(promotion.totalQuota ? String(promotion.totalQuota) : '');
      setPerUserLimit(String(promotion.perUserLimit));
      setStartAt(toLocalDatetimeInput(promotion.startAt));
      setEndAt(toLocalDatetimeInput(promotion.endAt));
    } else {
      // 创建：默认值
      setCode('');
      setName('');
      setDescription('');
      setType('PERCENTAGE');
      setValue('10');
      setMinOrderAmount('0');
      setMaxDiscountAmount('');
      setTotalQuota('');
      setPerUserLimit('1');
      const now = new Date();
      const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      setStartAt(toLocalDatetimeInput(now.toISOString()));
      setEndAt(toLocalDatetimeInput(nextMonth.toISOString()));
    }
  }, [open, mode, promotion]);

  async function handleSubmit() {
    const startIso = fromLocalDatetimeInput(startAt);
    const endIso = fromLocalDatetimeInput(endAt);
    if (mode === 'create') {
      const input: CreatePromotionInput = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        value: Number(value),
        minOrderAmount: Number(minOrderAmount),
        maxDiscountAmount: maxDiscountAmount.trim() ? Number(maxDiscountAmount) : null,
        totalQuota: totalQuota.trim() ? Number(totalQuota) : null,
        perUserLimit: Number(perUserLimit),
        startAt: startIso,
        endAt: endIso,
      };
      await onSubmit(input);
    } else {
      const input: UpdatePromotionInput = {
        name: name.trim(),
        description: description.trim() || null,
        value: Number(value),
        minOrderAmount: Number(minOrderAmount),
        maxDiscountAmount: maxDiscountAmount.trim() ? Number(maxDiscountAmount) : null,
        totalQuota: totalQuota.trim() ? Number(totalQuota) : null,
        perUserLimit: Number(perUserLimit),
        startAt: startIso,
        endAt: endIso,
      };
      await onSubmit(input);
    }
  }

  const valueHintKey =
    type === 'PERCENTAGE'
      ? 'admin.promotions.fieldValueHintPercentage'
      : type === 'FIXED_AMOUNT'
      ? 'admin.promotions.fieldValueHintFixed'
      : 'admin.promotions.fieldValueHintFreeDelivery';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? t('admin.promotions.createDialogTitle') : t('admin.promotions.editDialogTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="promo-code">{t('admin.promotions.fieldCode')}</Label>
              <Input
                id="promo-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t('admin.promotions.fieldCodePlaceholder')}
                disabled={mode === 'edit'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="promo-name">{t('admin.promotions.fieldName')}</Label>
              <Input id="promo-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="promo-desc">{t('admin.promotions.fieldDescription')}</Label>
            <Textarea
              id="promo-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="promo-type">{t('admin.promotions.fieldType')}</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as PromotionType)}
                disabled={mode === 'edit'}
              >
                <SelectTrigger id="promo-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((ty) => (
                    <SelectItem key={ty} value={ty}>
                      {t(`admin.promotions.type${ty === 'PERCENTAGE' ? 'Percentage' : ty === 'FIXED_AMOUNT' ? 'FixedAmount' : 'FreeDelivery'}` as 'admin.promotions.typePercentage')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="promo-value">{t('admin.promotions.fieldValue')}</Label>
              <Input
                id="promo-value"
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={type === 'FREE_DELIVERY'}
              />
              <p className="text-xs text-muted-foreground">{t(valueHintKey as 'admin.promotions.fieldValueHintPercentage')}</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="promo-min">{t('admin.promotions.fieldMinOrder')}</Label>
              <Input
                id="promo-min"
                type="number"
                value={minOrderAmount}
                onChange={(e) => setMinOrderAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="promo-max">{t('admin.promotions.fieldMaxDiscount')}</Label>
              <Input
                id="promo-max"
                type="number"
                value={maxDiscountAmount}
                onChange={(e) => setMaxDiscountAmount(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="promo-quota">{t('admin.promotions.fieldTotalQuota')}</Label>
              <Input
                id="promo-quota"
                type="number"
                value={totalQuota}
                onChange={(e) => setTotalQuota(e.target.value)}
                placeholder="∞"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="promo-peruser">{t('admin.promotions.fieldPerUserLimit')}</Label>
              <Input
                id="promo-peruser"
                type="number"
                value={perUserLimit}
                onChange={(e) => setPerUserLimit(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="promo-start">{t('admin.promotions.fieldStartAt')}</Label>
              <Input
                id="promo-start"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="promo-end">{t('admin.promotions.fieldEndAt')}</Label>
              <Input
                id="promo-end"
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? t('admin.settings.saving') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
