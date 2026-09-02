/**
 * 缴纳点管理页 — /riders/deposit-locations（批 E，2026-09-03）
 *
 * 后端：GET/POST /admin/deposit/locations + PATCH/DELETE /admin/deposit/locations/:id
 *   - DELETE = 软停用（骑手端 COD 下拉不再出现；历史流水不受影响）
 *   - 骑手端「线下缴纳」下拉实时来自此表（enabled 项）
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
import { Loader2, Plus, Pencil, Ban } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  useDepositLocations,
  useCreateLocation,
  useUpdateLocation,
  useDeleteLocation,
  type DepositLocation,
} from '@/hooks/api/use-deposit';
import { ApiError } from '@/lib/api';

interface LocationFormState {
  name: string;
  address: string;
  note: string;
}

const EMPTY_FORM: LocationFormState = { name: '', address: '', note: '' };

export default function DepositLocationsPage() {
  const t = useTranslations('common');
  const { toast } = useToast();

  const { data: locations, isPending, isError, refetch } = useDepositLocations();
  const createLocation = useCreateLocation();
  const updateLocation = useUpdateLocation();
  const deleteLocation = useDeleteLocation();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LocationFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState<DepositLocation | null>(null);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditingId('new');
  }

  function openEdit(loc: DepositLocation) {
    setForm({ name: loc.name, address: loc.address, note: loc.note ?? '' });
    setFormError(null);
    setEditingId(loc.id);
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.address.trim()) {
      setFormError(t('admin.deposit.locations.errorRequired'));
      return;
    }
    setFormError(null);
    const input = { name: form.name.trim(), address: form.address.trim(), note: form.note.trim() || null };
    try {
      if (editingId === 'new') {
        await createLocation.mutateAsync({ ...input, enabled: true });
        toast({ description: t('admin.deposit.locations.toastCreated') });
      } else if (editingId) {
        await updateLocation.mutateAsync({ id: editingId, input });
        toast({ description: t('admin.deposit.locations.toastUpdated') });
      }
      setEditingId(null);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : t('common.error.generic'));
    }
  }

  async function handleDisable() {
    if (!disabling) return;
    try {
      await deleteLocation.mutateAsync({ id: disabling.id });
      toast({ description: t('admin.deposit.locations.toastDisabled') });
    } catch (e) {
      toast({
        variant: 'destructive',
        description: e instanceof ApiError ? e.message : t('common.error.generic'),
      });
    } finally {
      setDisabling(null);
    }
  }

  const columns: Column<DepositLocation>[] = [
    { key: 'name', header: t('admin.deposit.locations.columnName'), render: (loc) => <span className="font-medium">{loc.name}</span> },
    { key: 'address', header: t('admin.deposit.locations.columnAddress') },
    { key: 'note', header: t('admin.deposit.locations.columnNote'), render: (loc) => loc.note ?? '—' },
    {
      key: 'enabled',
      header: t('admin.deposit.locations.columnEnabled'),
      render: (loc) => (
        <StatusBadge
          status={loc.enabled ? 'ACTIVE' : 'INACTIVE'}
          label={loc.enabled ? t('admin.deposit.locations.enabled') : t('admin.deposit.locations.disabled')}
        />
      ),
    },
    {
      key: 'actions',
      header: t('admin.deposit.locations.columnActions'),
      render: (loc) => (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => openEdit(loc)}>
            <Pencil className="mr-1 h-3 w-3" />
            {t('admin.deposit.locations.actionEdit')}
          </Button>
          {loc.enabled && (
            <Button variant="outline" size="sm" onClick={() => setDisabling(loc)}>
              <Ban className="mr-1 h-3 w-3" />
              {t('admin.deposit.locations.actionDisable')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const mutating = createLocation.isPending || updateLocation.isPending;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t('admin.deposit.locations.title')}
        description={t('admin.deposit.locations.description')}
      />

      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {t('admin.deposit.locations.actionCreate')}
        </Button>
      </div>

      {isPending ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !locations || locations.length === 0 ? (
        <EmptyState title={t('admin.deposit.locations.emptyTitle')} description={t('admin.deposit.locations.emptyDescription')} />
      ) : (
        <DataTable columns={columns} data={locations} />
      )}

      {/* 新增/编辑 Dialog */}
      <Dialog open={editingId !== null} onOpenChange={(open) => !open && setEditingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId === 'new'
                ? t('admin.deposit.locations.dialogCreateTitle')
                : t('admin.deposit.locations.dialogEditTitle')}
            </DialogTitle>
            <DialogDescription>{t('admin.deposit.locations.dialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="loc-name">{t('admin.deposit.locations.columnName')}</Label>
              <Input
                id="loc-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Dili Office"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loc-address">{t('admin.deposit.locations.columnAddress')}</Label>
              <Input
                id="loc-address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Dili, Timor-Leste"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loc-note">{t('admin.deposit.locations.columnNote')}</Label>
              <Textarea
                id="loc-note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                rows={2}
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

      {/* 停用确认 Dialog */}
      <Dialog open={disabling !== null} onOpenChange={(open) => !open && setDisabling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.deposit.locations.disableConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {disabling && t('admin.deposit.locations.disableConfirmBody', { name: disabling.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisabling(null)}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDisable} disabled={deleteLocation.isPending}>
              {deleteLocation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('admin.deposit.locations.actionDisable')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
