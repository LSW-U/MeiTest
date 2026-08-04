/**
 * 分类管理页 — /categories
 *
 * 两层分类树（F1-F8）：
 *   - 树形展示：大类行 + 子分类缩进，大类可展开/收起（F1）
 *   - parentId 列显示父分类名（F2）
 *   - 新建/编辑 Dialog 含 parent 选择器（锁 2 层，只列顶级）+ status Switch（F3/F4）
 *   - 大类行"添加子分类"按钮，预填 parent（F5）
 *   - 删除保护：有子分类时红字拦截 + 禁用确认；mutateAsync 正确报错（F6，修现存误报 bug）
 *   - status 列 Badge（F7）/ sortOrder（F8，沿用）
 *
 * 后端：
 *   - GET    /admin/categories          平铺带 parentId + status（含 INACTIVE）
 *   - POST   /admin/categories          新建（校验 parentId 存在 + 锁 2 层）
 *   - PATCH  /admin/categories/:id      更新（校验 + status toggle）
 *   - DELETE /admin/categories/:id      软删（有 ACTIVE 子分类时 E-CATALOG-014 拦截）
 */
'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Pencil, Trash2, ChevronRight, ChevronDown } from 'lucide-react';
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
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  buildCategoryTree,
  type Category,
  type I18nText,
} from '@/hooks/api/use-categories';

type Locale = 'en' | 'zh' | 'id' | 'pt';

/**
 * 判断 iconUrl 是否是合法图片 URL（http/https/相对路径）。
 * 非图片 URL（如 emoji 字符串）走 emoji 渲染分支。
 * W7-ext-A：修复种子数据 emoji 当 iconUrl 导致 <img src> 404 问题
 */
function isIconUrl(s: string): boolean {
  return /^https?:\/\//.test(s) || s.startsWith('/');
}

/**
 * 分类图标上传组件（W7-ext-H2）
 *
 * 复用 POST /admin/uploads/product-image（1:1 尺寸校验已具备）。
 * 上传成功 -> iconUrl 填入 MinIO URL。保留手填 URL 输入框作兜底。
 */
function CategoryIconUploader({
  iconUrl,
  setIconUrl,
}: {
  iconUrl: string;
  setIconUrl: (v: string) => void;
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
      setIconUrl(res.data.url);
      toast({ title: t('w.categories.iconUploadSuccess') });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('w.categories.iconUploadFailed');
      toast({
        title: t('w.categories.iconUploadFailed'),
        description: message,
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {iconUrl && isIconUrl(iconUrl) && (
        <img
          src={iconUrl}
          alt=""
          className="h-12 w-12 rounded border border-border object-cover"
        />
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
        value={iconUrl}
        onChange={(e) => setIconUrl(e.target.value)}
        placeholder={t('w.categories.iconUrlPlaceholder')}
      />
      {uploading && (
        <p className="text-xs text-muted-foreground">{t('w.categories.uploading')}</p>
      )}
      <p className="text-xs text-muted-foreground">{t('w.categories.iconUploadHint')}</p>
    </div>
  );
}

/** 顶级哨兵：parent 选择器的"（顶级）"选项值（Radix Select 不允许空字符串 value） */
const TOP = '__top__';

/**
 * Parent 选择器（F3/F4）：给分类选父，锁 2 层只列顶级分类。
 * 选"（顶级）"→ parentId=null（新分类成为大类）。
 */
function ParentCategorySelect({
  value,
  onChange,
}: {
  value?: string | null;
  onChange: (id: string | null) => void;
}) {
  const t = useTranslations('common');
  const categoriesQ = useCategories();
  const flat = categoriesQ.data?.data ?? [];
  const roots = flat
    .filter((c) => !c.parentId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return (
    <Select value={value ?? TOP} onValueChange={(v) => onChange(v === TOP ? null : v)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TOP}>{t('w.categories.parentTop')}</SelectItem>
        {roots.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {r.name?.en ?? r.name?.zh ?? r.id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** 4 语言 name 输入网格（新建/编辑复用） */
function NameI18nInputs({
  value,
  onChange,
  requiredEn,
}: {
  value: I18nText;
  onChange: (v: I18nText) => void;
  requiredEn?: boolean;
}) {
  const t = useTranslations('common');
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {(['en', 'zh', 'id', 'pt'] as Locale[]).map((locale) => (
        <div key={locale} className="space-y-1">
          <Label className="text-xs uppercase text-muted-foreground">
            {t('w.categories.formNameLabel', { locale })}
          </Label>
          <Input
            value={value[locale] ?? ''}
            onChange={(e) => onChange({ ...value, [locale]: e.target.value })}
            required={requiredEn && locale === 'en'}
          />
        </div>
      ))}
    </div>
  );
}

export default function CategoriesPage() {
  const t = useTranslations('common');
  const categoriesQ = useCategories();
  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();
  const deleteMutation = useDeleteCategory();

  const flat = categoriesQ.data?.data ?? [];
  const tree = useMemo(() => buildCategoryTree(flat), [flat]);
  /** id → 父分类名（F2 显示父名而非 uuid） */
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    flat.forEach((c) => m.set(c.id, c.name?.en ?? c.name?.zh ?? c.id));
    return m;
  }, [flat]);
  /** 大类 id → 子分类数（F5 添加子分类可见性 + F6 删除保护预判） */
  const childrenCountMap = useMemo(() => {
    const m = new Map<string, number>();
    flat.forEach((c) => {
      if (c.parentId) m.set(c.parentId, (m.get(c.parentId) ?? 0) + 1);
    });
    return m;
  }, [flat]);

  /** 收起的大类 id（默认空 = 全展开；新增大类自动展开） */
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const isExpanded = useCallback((id: string) => !collapsedIds.has(id), [collapsedIds]);

  /** DataTable 展示行：大类 +（展开则跟子分类）的平铺序列 */
  const displayRows: Category[] = useMemo(() => {
    const rows: Category[] = [];
    tree.forEach((root) => {
      rows.push(root);
      if (isExpanded(root.id)) {
        root.children.forEach((child) => rows.push(child));
      }
    });
    return rows;
  }, [tree, isExpanded]);

  /** 新建 Dialog：F5 "添加子分类" 预填 parent */
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialParent, setCreateInitialParent] = useState<string | null>(null);
  const openCreate = (parentId: string | null) => {
    setCreateInitialParent(parentId);
    setCreateOpen(true);
  };

  const columns: Column<Category>[] = [
    {
      key: 'icon',
      header: t('w.categories.columnIcon'),
      render: (row) => {
        const isRoot = !row.parentId;
        const expanded = isExpanded(row.id);
        const hasChildren = isRoot && (childrenCountMap.get(row.id) ?? 0) > 0;
        return (
          <div className={`flex items-center gap-1 ${row.parentId ? 'pl-7' : ''}`}>
            {isRoot && hasChildren && (
              <button
                type="button"
                onClick={() => toggle(row.id)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={expanded ? t('w.categories.treeCollapse') : t('w.categories.treeExpand')}
              >
                {expanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            )}
            {row.iconUrl ? (
              isIconUrl(row.iconUrl) ? (
                <img src={row.iconUrl} alt="" className="h-8 w-8 rounded object-cover" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded bg-muted text-lg">
                  {row.iconUrl}
                </span>
              )
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded bg-muted text-xs">
                🗂
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'name',
      header: t('w.categories.columnNameEn'),
      render: (row) => <span className="font-medium">{row.name?.en ?? '—'}</span>,
    },
    {
      key: 'nameZh',
      header: t('w.categories.columnNameZh'),
      render: (row) => <span className="text-muted-foreground">{row.name?.zh ?? '—'}</span>,
    },
    {
      key: 'parent',
      header: t('w.categories.columnParent'),
      render: (row) =>
        row.parentId ? (
          <span className="text-muted-foreground">
            └ {nameMap.get(row.parentId) ?? row.parentId.slice(0, 8)}
          </span>
        ) : (
          <span className="text-muted-foreground">{t('w.categories.parentTop')}</span>
        ),
    },
    {
      key: 'childrenCount',
      header: t('w.categories.columnChildrenCount'),
      render: (row) =>
        !row.parentId ? (
          <span>{childrenCountMap.get(row.id) ?? 0}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'status',
      header: t('w.categories.columnStatus'),
      render: (row) => (
        <StatusBadge
          status={row.status}
          label={
            row.status === 'ACTIVE'
              ? t('w.categories.statusActive')
              : t('w.categories.statusInactive')
          }
        />
      ),
    },
    {
      key: 'sortOrder',
      header: t('w.categories.columnSort'),
      render: (row) => <span className="text-muted-foreground">{row.sortOrder ?? 0}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('w.categories.title') as string}
        description={t('w.categories.listDesc')}
        action={
          <Button onClick={() => openCreate(null)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('w.categories.newCat')}
          </Button>
        }
      />
      {categoriesQ.isLoading ? (
        <LoadingSkeleton lines={5} />
      ) : categoriesQ.error ? (
        <ErrorState
          message={categoriesQ.error.message}
          onRetry={() => categoriesQ.refetch()}
        />
      ) : (
        <DataTable
          data={displayRows}
          columns={columns}
          emptyState={
            <EmptyState
              title={t('w.categories.emptyTitle')}
              description={t('w.categories.emptyDesc')}
            />
          }
          rowActions={(row) => (
            <div className="flex justify-end gap-1">
              {!row.parentId && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openCreate(row.id)}
                  aria-label={t('w.categories.addChildCategory')}
                  title={t('w.categories.addChildCategory')}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
              <EditCategoryDialog
                category={row}
                onSave={(input) => updateMutation.mutate({ id: row.id, input })}
                pending={updateMutation.isPending}
              />
              <DeleteCategoryDialog
                category={row}
                childrenCount={childrenCountMap.get(row.id) ?? 0}
                productCount={row.productCount ?? 0}
                pending={deleteMutation.isPending}
                onConfirm={() => deleteMutation.mutateAsync(row.id)}
              />
            </div>
          )}
        />
      )}

      <CreateCategoryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialParentId={createInitialParent}
        onCreate={(input) => createMutation.mutate(input)}
        pending={createMutation.isPending}
        error={createMutation.error?.message}
      />
    </>
  );
}

/** 新建分类 Dialog（F3 parent 选择器；F5 预填 parent） */
function CreateCategoryDialog({
  open,
  onOpenChange,
  initialParentId,
  onCreate,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialParentId: string | null;
  onCreate: (input: {
    name: I18nText;
    iconUrl: string;
    parentId?: string | null;
    sortOrder?: number;
  }) => void;
  pending: boolean;
  error?: string;
}) {
  const t = useTranslations('common');
  const [name, setName] = useState<I18nText>({});
  const [iconUrl, setIconUrl] = useState('');
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [sortOrder, setSortOrder] = useState('0');

  // initialParentId 变化时同步（F5 "添加子分类" 预填）
  useEffect(() => {
    setParentId(initialParentId);
  }, [initialParentId]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!iconUrl) return;
    onCreate({
      name,
      iconUrl,
      parentId,
      sortOrder: parseInt(sortOrder, 10) || 0,
    });
    setName({});
    setIconUrl('');
    setParentId(null);
    setSortOrder('0');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('w.categories.newCardTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <NameI18nInputs value={name} onChange={setName} requiredEn />
          <div className="space-y-1">
            <Label>{t('w.categories.formParentLabel')}</Label>
            <ParentCategorySelect value={parentId} onChange={setParentId} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>
                {t('w.categories.formIconUrl')} <span className="text-destructive">*</span>
              </Label>
              <CategoryIconUploader iconUrl={iconUrl} setIconUrl={setIconUrl} />
            </div>
            <div className="space-y-1">
              <Label>{t('w.categories.formSortOrder')}</Label>
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('w.categories.editCancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              <Plus className="mr-2 h-4 w-4" />
              {pending ? t('w.categories.creating') : t('w.categories.createSubmit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 编辑分类 Dialog（F4 parent 选择器 + status Switch） */
function EditCategoryDialog({
  category,
  onSave,
  pending,
}: {
  category: Category;
  onSave: (input: {
    name: I18nText;
    iconUrl?: string;
    parentId?: string | null;
    sortOrder?: number;
    status?: 'ACTIVE' | 'INACTIVE';
  }) => void;
  pending: boolean;
}) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<I18nText>(category.name ?? {});
  // W7-ext-A：存量 emoji iconUrl 初始化时清空，避免保存时被后端 z.url() 校验拒绝
  const [iconUrl, setIconUrl] = useState(
    category.iconUrl && isIconUrl(category.iconUrl) ? category.iconUrl : '',
  );
  const [parentId, setParentId] = useState<string | null>(category.parentId ?? null);
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder ?? 0));
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(category.status ?? 'ACTIVE');

  // 每次打开重置到最新 category（仅 open 切换时同步，编辑中不因 refetch 丢失）
  useEffect(() => {
    if (open) {
      setName(category.name ?? {});
      setIconUrl(category.iconUrl && isIconUrl(category.iconUrl) ? category.iconUrl : '');
      setParentId(category.parentId ?? null);
      setSortOrder(String(category.sortOrder ?? 0));
      setStatus(category.status ?? 'ACTIVE');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name,
      iconUrl: iconUrl || undefined,
      parentId,
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
          <DialogTitle>{t('w.categories.editDialogTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <NameI18nInputs value={name} onChange={setName} />
          <div className="space-y-1">
            <Label>{t('w.categories.formParentLabel')}</Label>
            <ParentCategorySelect value={parentId} onChange={setParentId} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('w.categories.formIconUrl')}</Label>
              <CategoryIconUploader iconUrl={iconUrl} setIconUrl={setIconUrl} />
            </div>
            <div className="space-y-1">
              <Label>{t('w.categories.formSortOrder')}</Label>
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={status === 'ACTIVE'}
              onCheckedChange={(c) => setStatus(c ? 'ACTIVE' : 'INACTIVE')}
              aria-label={t('w.categories.columnStatus')}
            />
            <Label>
              {status === 'ACTIVE'
                ? t('w.categories.statusActive')
                : t('w.categories.statusInactive')}
            </Label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('w.categories.editCancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('w.categories.editSave')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 删除分类 Dialog（F6 删除保护 + 修现存误报 bug）
 *
 * 有子分类时红字提示 + 禁用确认（不发请求）。
 * mutateAsync await：成功才 toast"已删除"，失败 toast 显示后端错误（E-CATALOG-014 等）。
 */
function DeleteCategoryDialog({
  category,
  childrenCount,
  productCount,
  pending,
  onConfirm,
}: {
  category: Category;
  childrenCount: number;
  productCount: number;
  pending: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const { toast } = useToast();
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  // F2：双重前置拦截——有子分类优先提示（删子分类后再提示商品数），否则有在售商品也拦
  const blockedByChildren = childrenCount > 0;
  const blockedByProducts = !blockedByChildren && productCount > 0;
  const blocked = blockedByChildren || blockedByProducts;

  const handleConfirm = async () => {
    if (blocked) return;
    try {
      await onConfirm();
      setOpen(false);
      toast({
        title: t('w.categories.deleted'),
        description: `"${category.name?.en ?? category.id}"`,
        variant: 'info',
      });
    } catch (err) {
      toast({
        title: t('w.categories.deleteTitle'),
        description: err instanceof ApiError ? err.message : String(err),
        variant: 'destructive',
      });
    }
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
          <AlertDialogTitle>{t('w.categories.deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription className={blocked ? 'text-destructive font-medium' : ''}>
            {blockedByChildren
              ? t('w.categories.deleteBlockedChildren', { count: childrenCount })
              : blockedByProducts
                ? t('w.categories.deleteBlockedProducts', { count: productCount })
                : t('w.categories.deleteDesc')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('w.categories.deleteCancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={pending || blocked}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? t('w.categories.deleting') : t('w.categories.deleteConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
