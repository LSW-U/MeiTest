/**
 * Banner 管理页 — /banners
 *
 * 首页轮播图 CRUD（§7.2，后端 /admin/banners 已就绪，admin-web 此前零接入）。
 *
 * 后端：
 *   - GET    /admin/banners        列表
 *   - POST   /admin/banners        新建
 *   - PATCH  /admin/banners/:id    更新
 *   - DELETE /admin/banners/:id    硬删
 */
'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { apiUploadFile, type ApiSuccess, ApiError } from '@/lib/api';
import {
  useBanners,
  useCreateBanner,
  useUpdateBanner,
  useDeleteBanner,
  type Banner,
  type BannerLinkType,
  type I18nText,
} from '@/hooks/api/use-banners';

type Locale = 'en' | 'zh' | 'id' | 'pt';
const LINK_TYPES: BannerLinkType[] = ['PRODUCT', 'CATEGORY', 'URL', 'NONE'];

/** linkType → 本地化文案（完整 i18n key，避免动态拼接） */
function useLinkTypeLabel() {
  const t = useTranslations('common');
  return (lt: BannerLinkType) =>
    lt === 'PRODUCT'
      ? t('w.banners.linkTypeProduct')
      : lt === 'CATEGORY'
        ? t('w.banners.linkTypeCategory')
        : lt === 'URL'
          ? t('w.banners.linkTypeUrl')
          : t('w.banners.linkTypeNone');
}

/** Banner 图片上传（复用 POST /admin/uploads/product-image，裸 input 与 products/create 一致） */
function BannerImageUploader({
  imageUrl,
  setImageUrl,
}: {
  imageUrl: string;
  setImageUrl: (v: string) => void;
}) {
  const t = useTranslations('common');
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);

  async function handleUpload(file: File) {
    if (!file) return;
    setUploading(true);
    try {
      const res = await apiUploadFile<ApiSuccess<{ url: string; key: string; size: number }>>(
        '/admin/uploads/product-image',
        file,
      );
      setImageUrl(res.data.url);
      toast({ title: t('w.banners.uploadSuccess') });
    } catch (err) {
      toast({
        title: t('w.banners.uploadFailed'),
        description: err instanceof ApiError ? err.message : '',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {imageUrl && (
        <img src={imageUrl} alt="" className="h-20 w-full rounded border object-cover" />
      )}
      <Input
        type="file"
        accept="image/png,image/webp,image/jpeg"
        disabled={uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleUpload(f);
        }}
      />
      <Input
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
        placeholder={t('w.banners.imageUrlPlaceholder')}
      />
      {uploading && <p className="text-xs text-muted-foreground">{t('w.banners.uploading')}</p>}
      <p className="text-xs text-muted-foreground">{t('w.banners.imageHint')}</p>
    </div>
  );
}

function AltI18nInputs({
  value,
  onChange,
}: {
  value: I18nText;
  onChange: (v: I18nText) => void;
}) {
  const t = useTranslations('common');
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {(['en', 'zh', 'id', 'pt'] as Locale[]).map((locale) => (
        <div key={locale} className="space-y-1">
          <Label className="text-xs uppercase text-muted-foreground">
            {t('w.banners.formAltLabel', { locale })}
          </Label>
          <Input
            value={value[locale] ?? ''}
            onChange={(e) => onChange({ ...value, [locale]: e.target.value })}
          />
        </div>
      ))}
    </div>
  );
}

function LinkTypeSelect({
  value,
  onChange,
}: {
  value: BannerLinkType;
  onChange: (v: BannerLinkType) => void;
}) {
  const label = useLinkTypeLabel();
  return (
    <Select value={value} onValueChange={(v) => onChange(v as BannerLinkType)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LINK_TYPES.map((lt) => (
          <SelectItem key={lt} value={lt}>
            {label(lt)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function BannersPage() {
  const t = useTranslations('common');
  const linkTypeLabel = useLinkTypeLabel();
  const bannersQ = useBanners();
  const createMutation = useCreateBanner();
  const updateMutation = useUpdateBanner();
  const deleteMutation = useDeleteBanner();

  const columns: Column<Banner>[] = [
    {
      key: 'image',
      header: t('w.banners.columnImage'),
      render: (row) =>
        row.imageUrl ? (
          <img src={row.imageUrl} alt="" className="h-10 w-20 rounded object-cover" />
        ) : (
          <div className="flex h-10 w-20 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
            —
          </div>
        ),
    },
    {
      key: 'altEn',
      header: t('w.banners.columnAltEn'),
      render: (row) => <span className="text-muted-foreground">{row.alt?.en ?? '—'}</span>,
    },
    {
      key: 'linkType',
      header: t('w.banners.columnLinkType'),
      render: (row) => <span>{linkTypeLabel(row.linkType)}</span>,
    },
    {
      key: 'linkValue',
      header: t('w.banners.columnLinkValue'),
      render: (row) => (
        <span className="text-xs text-muted-foreground">{row.linkValue ?? '—'}</span>
      ),
    },
    {
      key: 'sortOrder',
      header: t('w.banners.columnSort'),
      render: (row) => <span className="text-muted-foreground">{row.sortOrder ?? 0}</span>,
    },
    {
      key: 'status',
      header: t('w.banners.columnStatus'),
      render: (row) => (
        <StatusBadge
          status={row.status}
          label={
            row.status === 'ACTIVE'
              ? t('w.banners.statusActive')
              : t('w.banners.statusInactive')
          }
        />
      ),
    },
  ];

  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <PageHeader
        title={t('w.banners.title') as string}
        description={t('w.banners.listDesc')}
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('w.banners.newBanner')}
          </Button>
        }
      />
      {bannersQ.isLoading ? (
        <LoadingSkeleton lines={5} />
      ) : bannersQ.error ? (
        <ErrorState message={bannersQ.error.message} onRetry={() => bannersQ.refetch()} />
      ) : (
        <DataTable
          data={bannersQ.data?.data ?? []}
          columns={columns}
          emptyState={
            <EmptyState
              title={t('w.banners.emptyTitle')}
              description={t('w.banners.emptyDesc')}
            />
          }
          rowActions={(row) => (
            <div className="flex justify-end gap-1">
              <EditBannerDialog
                banner={row}
                onSave={(input) => updateMutation.mutate({ id: row.id, input })}
                pending={updateMutation.isPending}
              />
              <DeleteBannerDialog
                banner={row}
                pending={deleteMutation.isPending}
                onConfirm={() => deleteMutation.mutate(row.id)}
              />
            </div>
          )}
        />
      )}

      <CreateBannerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(input) => createMutation.mutate(input)}
        pending={createMutation.isPending}
        error={createMutation.error?.message}
      />
    </>
  );
}

/** 新建 Banner Dialog */
function CreateBannerDialog({
  open,
  onOpenChange,
  onCreate,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (input: {
    imageUrl: string;
    alt?: I18nText;
    linkType: BannerLinkType;
    linkValue?: string | null;
    sortOrder?: number;
    status?: 'ACTIVE' | 'INACTIVE';
  }) => void;
  pending: boolean;
  error?: string;
}) {
  const t = useTranslations('common');
  const [imageUrl, setImageUrl] = useState('');
  const [alt, setAlt] = useState<I18nText>({});
  const [linkType, setLinkType] = useState<BannerLinkType>('NONE');
  const [linkValue, setLinkValue] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  // 关闭时重置
  useEffect(() => {
    if (!open) {
      setImageUrl('');
      setAlt({});
      setLinkType('NONE');
      setLinkValue('');
      setSortOrder('0');
      setStatus('ACTIVE');
    }
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageUrl) return;
    onCreate({
      imageUrl,
      alt,
      linkType,
      linkValue: linkValue || undefined,
      sortOrder: parseInt(sortOrder, 10) || 0,
      status,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('w.banners.newBanner')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label>
              {t('w.banners.formImageUrl')} <span className="text-destructive">*</span>
            </Label>
            <BannerImageUploader imageUrl={imageUrl} setImageUrl={setImageUrl} />
          </div>
          <AltI18nInputs value={alt} onChange={setAlt} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('w.banners.formLinkType')}</Label>
              <LinkTypeSelect value={linkType} onChange={setLinkType} />
            </div>
            <div className="space-y-1">
              <Label>{t('w.banners.formLinkValue')}</Label>
              <Input
                value={linkValue}
                onChange={(e) => setLinkValue(e.target.value)}
                disabled={linkType === 'NONE'}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('w.banners.formSortOrder')}</Label>
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch
                checked={status === 'ACTIVE'}
                onCheckedChange={(c) => setStatus(c ? 'ACTIVE' : 'INACTIVE')}
                aria-label={t('w.banners.columnStatus')}
              />
              <Label>
                {status === 'ACTIVE'
                  ? t('w.banners.statusActive')
                  : t('w.banners.statusInactive')}
              </Label>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('w.banners.editCancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('w.banners.creating') : t('w.banners.createSubmit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 编辑 Banner Dialog（打开时回填） */
function EditBannerDialog({
  banner,
  onSave,
  pending,
}: {
  banner: Banner;
  onSave: (input: {
    imageUrl?: string;
    alt?: I18nText;
    linkType?: BannerLinkType;
    linkValue?: string | null;
    sortOrder?: number;
    status?: 'ACTIVE' | 'INACTIVE';
  }) => void;
  pending: boolean;
}) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState(banner.imageUrl);
  const [alt, setAlt] = useState<I18nText>(banner.alt ?? {});
  const [linkType, setLinkType] = useState<BannerLinkType>(banner.linkType);
  const [linkValue, setLinkValue] = useState(banner.linkValue ?? '');
  const [sortOrder, setSortOrder] = useState(String(banner.sortOrder ?? 0));
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(banner.status);

  // 每次打开回填到最新 banner（仅 open 切换时同步）
  useEffect(() => {
    if (open) {
      setImageUrl(banner.imageUrl);
      setAlt(banner.alt ?? {});
      setLinkType(banner.linkType);
      setLinkValue(banner.linkValue ?? '');
      setSortOrder(String(banner.sortOrder ?? 0));
      setStatus(banner.status);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      imageUrl,
      alt,
      linkType,
      linkValue: linkValue || null,
      sortOrder: parseInt(sortOrder, 10) || 0,
      status,
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('w.banners.editDialogTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label>{t('w.banners.formImageUrl')}</Label>
            <BannerImageUploader imageUrl={imageUrl} setImageUrl={setImageUrl} />
          </div>
          <AltI18nInputs value={alt} onChange={setAlt} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('w.banners.formLinkType')}</Label>
              <LinkTypeSelect value={linkType} onChange={setLinkType} />
            </div>
            <div className="space-y-1">
              <Label>{t('w.banners.formLinkValue')}</Label>
              <Input
                value={linkValue}
                onChange={(e) => setLinkValue(e.target.value)}
                disabled={linkType === 'NONE'}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('w.banners.formSortOrder')}</Label>
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch
                checked={status === 'ACTIVE'}
                onCheckedChange={(c) => setStatus(c ? 'ACTIVE' : 'INACTIVE')}
                aria-label={t('w.banners.columnStatus')}
              />
              <Label>
                {status === 'ACTIVE'
                  ? t('w.banners.statusActive')
                  : t('w.banners.statusInactive')}
              </Label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('w.banners.editCancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('w.banners.editSave')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 删除 Banner Dialog（后端硬删，async + toast） */
function DeleteBannerDialog({
  banner,
  pending,
  onConfirm,
}: {
  banner: Banner;
  pending: boolean;
  onConfirm: () => void;
}) {
  const { toast } = useToast();
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);

  const handleConfirm = () => {
    onConfirm();
    setOpen(false);
    toast({
      title: t('w.banners.deleted'),
      description: banner.alt?.en ?? '',
      variant: 'info',
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" disabled={pending}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('w.banners.deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('w.banners.deleteDesc')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('w.banners.deleteCancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? t('w.banners.deleting') : t('w.banners.deleteConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
