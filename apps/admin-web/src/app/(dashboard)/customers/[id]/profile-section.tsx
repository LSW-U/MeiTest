/**
 * 画像 360 + 客户标记区块（客户画像批1 2026-10-18）
 *
 * 从 customers/[id]/page.tsx 拆出，避免单文件过长；消费：
 *   - useCustomerProfile360（GET /admin/users/:id/profile —— 查看即审计）
 *   - useCustomerNotes + 标记 CRUD（D6）
 */
'use client';

import { useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { StatusBadge } from '@/components/common/status-badge';
import {
  useCustomerProfile360,
  useCustomerNotes,
  useCreateCustomerNote,
  useUpdateCustomerNote,
  useDeleteCustomerNote,
  type CustomerNote,
} from '@/hooks/api/use-customers';
import { formatCurrency } from '@/lib/utils';

function lifecycleBadgeVariant(
  stage: string,
): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info' {
  switch (stage) {
    case 'ACTIVE':
      return 'success';
    case 'SLEEPING':
      return 'warning';
    case 'CHURNED':
      return 'destructive';
    case 'NEW':
      return 'info';
    default:
      return 'secondary';
  }
}

function lifecycleLabelKey(stage: string): string {
  const map: Record<string, string> = {
    NEW: 'admin.customers.lifecycleNew',
    FIRST_PURCHASE: 'admin.customers.lifecycleFirstPurchase',
    ACTIVE: 'admin.customers.lifecycleActive',
    SLEEPING: 'admin.customers.lifecycleSleeping',
    CHURNED: 'admin.customers.lifecycleChurned',
  };
  return map[stage] ?? 'admin.customers.lifecycleNew';
}

function formatDate(d: string | null | undefined, format: ReturnType<typeof useFormatter>): string {
  if (!d) return '-';
  return format.dateTime(new Date(d), { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** 画像 360 区块（RFM / 生命周期 / 品类偏好 / 价带 / 折扣 / 时段 / 地址 / 时间线） */
export function Profile360Section({ id }: { id: string }) {
  const t = useTranslations('common');
  const format = useFormatter();
  const { data: profile, isLoading, error } = useCustomerProfile360(id);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">{t('loading')}</CardContent>
      </Card>
    );
  }
  if (error || !profile) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          {t('admin.customers.profileNoData')}
        </CardContent>
      </Card>
    );
  }

  const { rfm, lifecycle, categoryPreferences, priceBand, discountSensitivity, peakHours, frequentAddresses, timeline } = profile;
  const noPurchase = rfm.fCount === 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* RFM */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.customers.sectionRfm')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{t('admin.customers.rfmRecency')}</dt>
                <dd>{noPurchase ? '-' : formatDate(rfm.lastPurchaseAt, format)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('admin.customers.rfmFrequency')}</dt>
                <dd className="font-mono">
                  {rfm.fCount} {t('admin.customers.timesUnit')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('admin.customers.rfmMonetary')}</dt>
                <dd className="font-mono">{formatCurrency(rfm.mTotal)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('admin.customers.rfmFirstPurchase')}</dt>
                <dd>{formatDate(rfm.firstPurchaseAt, format)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        {/* 生命周期 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.customers.sectionLifecycle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={lifecycleBadgeVariant(lifecycle.stage)}>
              {t(lifecycleLabelKey(lifecycle.stage))}
            </Badge>
            <p className="mt-2 text-xs text-muted-foreground">{t('admin.customers.auditViewedNote')}</p>
          </CardContent>
        </Card>
        {/* 价带 + 折扣 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.customers.sectionPriceBand')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-sm">
              {noPurchase ? '-' : `${formatCurrency(priceBand.min)} ~ ${formatCurrency(priceBand.max)}`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('admin.customers.sectionDiscount')}:{' '}
              {discountSensitivity.ratio == null ? '-' : `${Math.round(discountSensitivity.ratio * 100)}%`}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 品类偏好 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.customers.sectionCategories')}</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryPreferences.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('admin.customers.profileNoData')}</p>
            ) : (
              <div className="space-y-2">
                {categoryPreferences.map((cat, i) => (
                  <div key={`${cat.categoryId ?? 'none'}-${i}`} className="flex items-center gap-2 text-sm">
                    <span className="w-28 shrink-0 truncate">{cat.name || '-'}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className="h-full rounded bg-primary"
                        style={{ width: `${Math.round(cat.share * 100)}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right font-mono text-xs">
                      {Math.round(cat.share * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        {/* 高峰时段 + 常用地址 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.customers.sectionPeakHours')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {peakHours.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('admin.customers.profileNoData')}</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {peakHours.map((h) => (
                  <Badge key={h.hour} variant="outline">
                    {String(h.hour).padStart(2, '0')}:00 · {h.freq}
                  </Badge>
                ))}
              </div>
            )}
            <div>
              <p className="mb-1 text-xs text-muted-foreground">{t('admin.customers.sectionFrequentAddresses')}</p>
              {frequentAddresses.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('admin.customers.profileNoData')}</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {frequentAddresses.map((a, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {a.region} {a.detail}
                      </span>
                      <span className="shrink-0 font-mono text-muted-foreground">×{a.freq}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 时间线 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t('admin.customers.sectionTimeline')}</CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('admin.customers.profileNoData')}</p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {timeline.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
                  <div className="space-y-0.5">
                    <p className="font-mono text-xs">{o.orderNo}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(o.createdAt, format)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={o.status} />
                    <span className="font-mono text-xs">{formatCurrency(o.payableAmount)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** 客户标记区块（D6 CRUD + 写审计） */
export function CustomerNotesSection({ id }: { id: string }) {
  const t = useTranslations('common');
  const format = useFormatter();
  const { toast } = useToast();
  const { data: notesData, isLoading } = useCustomerNotes(id);
  const createMutation = useCreateCustomerNote();
  const updateMutation = useUpdateCustomerNote();
  const deleteMutation = useDeleteCustomerNote();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<CustomerNote | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerNote | null>(null);
  const [form, setForm] = useState({ type: '', content: '' });

  function openCreate() {
    setEditingNote(null);
    setForm({ type: '', content: '' });
    setEditorOpen(true);
  }

  function openEdit(note: CustomerNote) {
    setEditingNote(note);
    setForm({ type: note.type, content: note.content });
    setEditorOpen(true);
  }

  function handleSave() {
    const mutation = editingNote ? updateMutation : createMutation;
    const payload = editingNote
      ? { id, noteId: editingNote.id, input: { type: form.type, content: form.content } }
      : { id, input: { type: form.type, content: form.content } };
    mutation.mutate(payload as never, {
      onSuccess: () => {
        setEditorOpen(false);
        toast({ title: t('admin.customers.toastUpdated') });
      },
      onError: (err: Error) => {
        toast({
          title: t('admin.customers.toastFailed'),
          description: err.message,
          variant: 'destructive',
        });
      },
    });
  }

  function handleDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(
      { id, noteId: deleteTarget.id },
      {
        onSuccess: () => {
          setDeleteTarget(null);
          toast({ title: t('admin.customers.toastUpdated') });
        },
        onError: (err: Error) => {
          toast({
            title: t('admin.customers.toastFailed'),
            description: err.message,
            variant: 'destructive',
          });
        },
      },
    );
  }

  const notes = notesData?.items ?? [];
  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{t('admin.customers.sectionNotes')}</CardTitle>
        <Button variant="outline" size="sm" onClick={openCreate}>
          {t('admin.customers.noteAddButton')}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('admin.customers.noteEmpty')}</p>
        ) : (
          <div className="space-y-2">
            {notes.map((note) => (
              <div key={note.id} className="flex items-start justify-between gap-2 rounded border p-2">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{note.type}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {format.dateTime(new Date(note.createdAt), {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="break-words text-sm">{note.content}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(note)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(note)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Create/Edit Dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('admin.customers.sectionNotes')}</DialogTitle>
            <DialogDescription>{t('admin.customers.auditViewedNote')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="note-type">{t('admin.customers.noteType')}</Label>
              <Input
                id="note-type"
                value={form.type}
                maxLength={30}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                placeholder={t('admin.customers.noteTypePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="note-content">{t('admin.customers.noteContent')}</Label>
              <Textarea
                id="note-content"
                value={form.content}
                maxLength={500}
                rows={3}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder={t('admin.customers.noteContentPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              {t('admin.customers.commonCancel')}
            </Button>
            <Button
              variant="default"
              onClick={handleSave}
              disabled={saving || !form.type.trim() || !form.content.trim()}
            >
              {saving ? t('admin.customers.noteSubmitting') : t('admin.customers.noteSaveButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog（页面内建确认，无 window.confirm） */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.customers.noteDeleteConfirm')}</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `${deleteTarget.type}: ${deleteTarget.content}` : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t('admin.customers.commonCancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {t('admin.customers.noteDeleteButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
