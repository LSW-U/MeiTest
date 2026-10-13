/**
 * 引导页轮播配置管理页 — /onboarding-slides（引导页内容可配置 · 批2）
 *
 * 后端（批1）：GET/POST/PATCH/DELETE /admin/onboarding/slides（SUPER_ADMIN）。
 * 上传：uploadByScene('onboarding-slide')（批1 新增 slide-image 端点，
 *       竖向 1:1~3:4 + 宽 600-2000px，前端预校验对齐 lib/upload-errors.ts slide-image 规则）。
 *
 * 结构参照 banners/page.tsx：DataTable 列表 + Create/Edit Dialog + Delete AlertDialog。
 * 表单：五语 tab（en 必填其余可空回退 en；id 录入可选不强制——客户端 locales 现为 4 语）
 *       + icon 文本输入（Material Symbol 名）+ 图片上传。
 */
'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { FormField } from '@/components/form/form-field';
import { FormSection } from '@/components/form/form-section';
import { ApiError } from '@/lib/api';
import { uploadByScene } from '@/lib/upload-scenes';
import {
  localizeUploadError,
  phaseToProgress,
  precheckUploadFile,
  PrecheckError,
  toUploadError,
  type UploadPhase,
} from '@/lib/upload-errors';
import { UploadProgressBar } from '@/components/upload/upload-progress-bar';
import {
  useOnboardingSlides,
  useCreateOnboardingSlide,
  useUpdateOnboardingSlide,
  useDeleteOnboardingSlide,
  type OnboardingSlide,
  type I18nText,
  type CreateOnboardingSlideInput,
} from '@/hooks/api/use-onboarding-slides';

/** 表单五语 tab（en 必填；id 录入可选不强制——客户端 locales 现为 4 语无 id） */
type Locale = 'en' | 'pt' | 'tet' | 'id' | 'zh';
const FORM_LOCALES: Locale[] = ['en', 'zh', 'pt', 'id', 'tet'];

/** 五语输入组：en 必填其余可空（留空回退 en，placeholder 标注） */
function I18nInputs({
  value,
  onChange,
  labelEn,
  labelOther,
  multiline,
}: {
  value: I18nText;
  onChange: (v: I18nText) => void;
  labelEn: string;
  labelOther: string;
  multiline?: boolean;
}) {
  const t = useTranslations('common');
  return (
    <Tabs defaultValue="en">
      <TabsList className="flex-wrap">
        {FORM_LOCALES.map((locale) => (
          <TabsTrigger key={locale} value={locale} className="uppercase">
            {locale}
          </TabsTrigger>
        ))}
      </TabsList>
      {FORM_LOCALES.map((locale) => (
        <TabsContent key={locale} value={locale} className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {locale === 'en' ? labelEn : labelOther}
          </Label>
          {multiline ? (
            <textarea
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={value[locale] ?? ''}
              onChange={(e) => onChange({ ...value, [locale]: e.target.value })}
            />
          ) : (
            <Input
              value={value[locale] ?? ''}
              onChange={(e) => onChange({ ...value, [locale]: e.target.value })}
            />
          )}
          {locale !== 'en' && (
            <p className="text-xs text-muted-foreground">{t('w.onboardingSlides.fallbackHint')}</p>
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}

/** 引导图上传（slide-image 场景：竖向 1:1~3:4 + 宽 600-2000px，预校验→重试→阶段回调，参照 banners uploader） */
function SlideImageUploader({
  imageUrl,
  setImageUrl,
}: {
  imageUrl: string;
  setImageUrl: (v: string) => void;
}) {
  const t = useTranslations('common');
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const lastFileRef = useRef<File | null>(null);

  async function handleUpload(file: File) {
    if (!file) return;
    setCanRetry(false);
    // 上传前本地预校验（slide-image 规则：宽 600-2000 + 竖向比例 0.75~1.0 即 3:4~1:1），
    // PrecheckError 直接 toast 不进重试链
    try {
      await precheckUploadFile('onboarding-slide', file);
    } catch (err) {
      if (err instanceof PrecheckError) {
        toast({
          title: t('w.onboardingSlides.uploadFailed'),
          description: t.has(`errors.${err.code}`) ? t(`errors.${err.code}`) : err.message,
          variant: 'destructive',
        });
        return;
      }
      throw err;
    }
    setUploading(true);
    try {
      const res = await uploadByScene<{ url: string; key: string; size: number }>(
        'onboarding-slide',
        file,
        'file',
        {
          onPhase: (phase: UploadPhase) => {
            if (phase === 'done') setUploading(false);
          },
        },
      );
      setImageUrl(res.data.url);
      toast({ title: t('w.onboardingSlides.uploadSuccess') });
    } catch (err) {
      const uploadErr = toUploadError(err);
      toast({
        title: t('w.onboardingSlides.uploadFailed'),
        description: localizeUploadError(uploadErr, t, t.has.bind(t)),
        variant: 'destructive',
      });
      // 网络类耗尽自动重试后开放手动兜底；4xx 校验失败重试无意义
      if (uploadErr.kind === 'network') {
        setCanRetry(true);
        lastFileRef.current = file;
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {imageUrl && (
        <img src={imageUrl} alt="" className="h-20 w-20 rounded border object-cover" />
      )}
      <Input
        type="file"
        accept="image/png,image/webp,image/jpeg"
        disabled={uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleUpload(f);
        }}
      />
      <Input
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
        placeholder={t('w.onboardingSlides.imageUrlPlaceholder')}
      />
      {uploading && (
        <>
          <UploadProgressBar progress={phaseToProgress('uploading')} />
          <p className="text-xs text-muted-foreground">{t('w.onboardingSlides.uploading')}</p>
        </>
      )}
      {canRetry && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => {
            if (lastFileRef.current) void handleUpload(lastFileRef.current);
          }}
        >
          {t('retry')}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">{t('w.onboardingSlides.imageHint')}</p>
    </div>
  );
}

/** 表单内部状态/校验/清洗转换（纯函数抽出至 slide-form.ts，node 单测可导入） */
import {
  validateForm,
  toCreateInput,
  type SlideFormState,
} from './slide-form';

const EMPTY_FORM: SlideFormState = {
  icon: '',
  imageUrl: '',
  title: {},
  description: {},
  sortOrder: '0',
  enabled: true,
};

/** Slide 表单（新建/编辑共用主体） */
function SlideFormFields({
  form,
  setForm,
  error,
}: {
  form: SlideFormState;
  setForm: (s: SlideFormState) => void;
  error?: string;
}) {
  const t = useTranslations('common');
  return (
    <div className="space-y-4">
      <FormSection title={t('w.onboardingSlides.sectionContent')}>
        <FormField label={t('w.onboardingSlides.formTitle')} required>
          <I18nInputs
            value={form.title}
            onChange={(title) => setForm({ ...form, title })}
            labelEn={t('w.onboardingSlides.formTitle')}
            labelOther={t('w.onboardingSlides.formTitleOther')}
          />
        </FormField>
        {error === 'titleEnRequired' && (
          <p className="text-xs text-destructive">{t('w.onboardingSlides.titleEnRequired')}</p>
        )}
        <FormField label={t('w.onboardingSlides.formDescription')}>
          <I18nInputs
            value={form.description}
            onChange={(description) => setForm({ ...form, description })}
            labelEn={t('w.onboardingSlides.formDescription')}
            labelOther={t('w.onboardingSlides.formDescriptionOther')}
            multiline
          />
        </FormField>
      </FormSection>
      <FormSection title={t('w.onboardingSlides.sectionVisual')}>
        <FormField
          label={t('w.onboardingSlides.formIcon')}
          hint={t('w.onboardingSlides.formIconHint')}
        >
          <Input
            value={form.icon}
            onChange={(e) => setForm({ ...form, icon: e.target.value })}
            placeholder="waving_hand"
          />
        </FormField>
        <FormField label={t('w.onboardingSlides.formImageUrl')}>
          <SlideImageUploader imageUrl={form.imageUrl} setImageUrl={(v) => setForm({ ...form, imageUrl: v })} />
        </FormField>
      </FormSection>
      <FormSection title={t('w.onboardingSlides.sectionDisplay')}>
        <FormField label={t('w.onboardingSlides.formSortOrder')}>
          <Input
            type="number"
            min={0}
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
          />
        </FormField>
        {error === 'sortOrderInvalid' && (
          <p className="text-xs text-destructive">{t('w.onboardingSlides.sortOrderInvalid')}</p>
        )}
        <div className="flex items-center gap-2">
          <Switch
            checked={form.enabled}
            onCheckedChange={(c) => setForm({ ...form, enabled: c })}
            aria-label={t('w.onboardingSlides.columnEnabled')}
          />
          <Label>{t('w.onboardingSlides.columnEnabled')}</Label>
        </div>
      </FormSection>
    </div>
  );
}

/** 新建 Dialog */
function CreateSlideDialog({
  open,
  onOpenChange,
  onCreate,
  pending,
  apiError,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (input: CreateOnboardingSlideInput) => void;
  pending: boolean;
  apiError?: string;
}) {
  const t = useTranslations('common');
  const [form, setForm] = useState<SlideFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_FORM);
      setError(undefined);
    }
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errKey = validateForm(form);
    if (errKey) {
      setError(errKey);
      return;
    }
    setError(undefined);
    onCreate(toCreateInput(form));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('w.onboardingSlides.newSlide')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <SlideFormFields form={form} setForm={setForm} error={error} />
          {apiError && <p className="text-sm text-destructive">{apiError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('w.onboardingSlides.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('w.onboardingSlides.creating') : t('w.onboardingSlides.createSubmit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 编辑 Dialog（打开时回填） */
function EditSlideDialog({
  slide,
  onSave,
  pending,
}: {
  slide: OnboardingSlide;
  onSave: (input: Partial<CreateOnboardingSlideInput>) => void;
  pending: boolean;
}) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SlideFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (open) {
      setForm({
        icon: slide.icon ?? '',
        imageUrl: slide.imageUrl ?? '',
        title: slide.title ?? {},
        description: slide.description ?? {},
        sortOrder: String(slide.sortOrder ?? 0),
        enabled: slide.enabled,
      });
      setError(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errKey = validateForm(form);
    if (errKey) {
      setError(errKey);
      return;
    }
    setError(undefined);
    onSave(toCreateInput(form));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('w.onboardingSlides.edit')}>
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('w.onboardingSlides.edit')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <SlideFormFields form={form} setForm={setForm} error={error} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('w.onboardingSlides.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('w.onboardingSlides.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 删除确认（后端硬删） */
function DeleteSlideDialog({
  slide,
  pending,
  onConfirm,
}: {
  slide: OnboardingSlide;
  pending: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const { toast } = useToast();
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);

  const handleConfirm = async () => {
    try {
      await onConfirm();
      setOpen(false);
      toast({
        title: t('w.onboardingSlides.deleted'),
        description: slide.title?.en ?? '',
        variant: 'info',
      });
    } catch (err) {
      toast({
        title: t('w.onboardingSlides.deleteTitle'),
        description: err instanceof ApiError ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" disabled={pending} aria-label={t('w.onboardingSlides.deleteTitle')}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('w.onboardingSlides.deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('w.onboardingSlides.deleteDesc')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('w.onboardingSlides.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? t('w.onboardingSlides.deleting') : t('w.onboardingSlides.deleteConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function OnboardingSlidesPage() {
  const t = useTranslations('common');
  const slidesQ = useOnboardingSlides();
  const createMutation = useCreateOnboardingSlide();
  const updateMutation = useUpdateOnboardingSlide();
  const deleteMutation = useDeleteOnboardingSlide();

  const slides = slidesQ.data?.data ?? [];

  /** 排序调整：与相邻项互换 sortOrder 后各自 PATCH */
  const move = (row: OnboardingSlide, dir: -1 | 1) => {
    const sorted = [...slides].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((s) => s.id === row.id);
    const target = sorted[idx + dir];
    if (!target) return;
    updateMutation.mutate({ id: row.id, input: { sortOrder: target.sortOrder } });
    updateMutation.mutate({ id: target.id, input: { sortOrder: row.sortOrder } });
  };

  const columns: Column<OnboardingSlide>[] = [
    {
      key: 'image',
      header: t('w.onboardingSlides.columnImage'),
      render: (row) =>
        row.imageUrl ? (
          <img src={row.imageUrl} alt="" className="h-10 w-10 rounded object-cover" />
        ) : row.icon ? (
          <span className="text-lg" aria-hidden>
            {row.icon}
          </span>
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
            —
          </div>
        ),
    },
    {
      key: 'titleEn',
      header: t('w.onboardingSlides.columnTitleEn'),
      render: (row) => <span className="text-muted-foreground">{row.title?.en ?? '—'}</span>,
    },
    {
      key: 'sortOrder',
      header: t('w.onboardingSlides.columnSort'),
      render: (row) => (
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">{row.sortOrder}</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={t('w.onboardingSlides.moveUp')} onClick={() => move(row, -1)}>
            <ArrowUp className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={t('w.onboardingSlides.moveDown')} onClick={() => move(row, 1)}>
            <ArrowDown className="h-3 w-3" />
          </Button>
        </div>
      ),
    },
    {
      key: 'enabled',
      header: t('w.onboardingSlides.columnEnabled'),
      render: (row) => (
        <Switch
          checked={row.enabled}
          onCheckedChange={(c) => updateMutation.mutate({ id: row.id, input: { enabled: c } })}
          aria-label={t('w.onboardingSlides.columnEnabled')}
        />
      ),
    },
  ];

  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <PageHeader
        title={t('w.onboardingSlides.title') as string}
        description={t('w.onboardingSlides.listDesc')}
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('w.onboardingSlides.newSlide')}
          </Button>
        }
      />
      {slidesQ.isLoading ? (
        <LoadingSkeleton lines={5} />
      ) : slidesQ.error ? (
        <ErrorState message={slidesQ.error.message} onRetry={() => slidesQ.refetch()} />
      ) : (
        <DataTable
          data={slides}
          columns={columns}
          emptyState={
            <EmptyState
              title={t('w.onboardingSlides.emptyTitle')}
              description={t('w.onboardingSlides.emptyDesc')}
            />
          }
          rowActions={(row) => (
            <div className="flex justify-end gap-1">
              <EditSlideDialog
                slide={row}
                onSave={(input) => updateMutation.mutate({ id: row.id, input })}
                pending={updateMutation.isPending}
              />
              <DeleteSlideDialog
                slide={row}
                pending={deleteMutation.isPending}
                onConfirm={() => deleteMutation.mutateAsync(row.id)}
              />
            </div>
          )}
        />
      )}

      <CreateSlideDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(input) => createMutation.mutate(input)}
        pending={createMutation.isPending}
        apiError={createMutation.error?.message}
      />
    </>
  );
}
