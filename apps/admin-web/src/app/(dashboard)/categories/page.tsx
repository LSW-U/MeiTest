/**
 * 分类管理页 — /categories
 *
 * 后端：
 *   - GET    /admin/products/categories
 *   - POST   /admin/products/categories
 *   - PATCH  /admin/categories/:id
 *   - DELETE /admin/categories/:id
 *
 * MVP 简化：平铺列表（不展开树形）+ 新建 Dialog + 编辑/删除按钮
 */
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  type Category,
  type I18nText,
} from '@/hooks/api/use-categories';

type Locale = 'en' | 'zh' | 'id' | 'pt';

export default function CategoriesPage() {
  const t = useTranslations();
  const categoriesQ = useCategories();
  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();
  const deleteMutation = useDeleteCategory();

  const columns: Column<Category>[] = [
    {
      key: 'icon',
      header: 'Icon',
      render: (row) =>
        row.iconUrl ? (
          <img src={row.iconUrl} alt="" className="h-8 w-8 rounded object-cover" />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded bg-muted text-xs">
            🗂
          </div>
        ),
    },
    {
      key: 'name',
      header: 'Name (EN)',
      render: (row) => <span className="font-medium">{row.name?.en ?? '—'}</span>,
    },
    {
      key: 'nameZh',
      header: 'Name (ZH)',
      render: (row) => <span className="text-muted-foreground">{row.name?.zh ?? '—'}</span>,
    },
    {
      key: 'parentId',
      header: 'Parent',
      render: (row) =>
        row.parentId ? (
          <code className="text-xs">{row.parentId.slice(0, 8)}...</code>
        ) : (
          <span className="text-muted-foreground">—（top）</span>
        ),
    },
    {
      key: 'sortOrder',
      header: 'Sort',
      render: (row) => <span className="text-muted-foreground">{row.sortOrder ?? 0}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('w.categories.title') as string}
        description="Manage product categories (MVP: flat list, no tree)."
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
          data={categoriesQ.data?.data ?? []}
          columns={columns}
          emptyState={
            <EmptyState
              title="No categories"
              description="Use 'New Category' to create the first one."
            />
          }
          rowActions={(row) => (
            <div className="flex justify-end gap-1">
              <EditCategoryDialog
                category={row}
                onSave={(input) => updateMutation.mutate({ id: row.id, input })}
                pending={updateMutation.isPending}
              />
              <DeleteCategoryDialog
                category={row}
                pending={deleteMutation.isPending}
                onConfirm={() => deleteMutation.mutate(row.id)}
              />
            </div>
          )}
        />
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>New Category</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateCategoryForm
            onCreate={(input) => createMutation.mutate(input)}
            pending={createMutation.isPending}
            error={createMutation.error?.message}
          />
        </CardContent>
      </Card>
    </>
  );
}

function CreateCategoryForm({
  onCreate,
  pending,
  error,
}: {
  onCreate: (input: { name: I18nText; iconUrl: string; sortOrder?: number }) => void;
  pending: boolean;
  error?: string;
}) {
  const [name, setName] = useState<I18nText>({});
  const [iconUrl, setIconUrl] = useState('');
  const [sortOrder, setSortOrder] = useState('0');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!iconUrl) return;
    onCreate({
      name,
      iconUrl,
      sortOrder: parseInt(sortOrder, 10) || 0,
    });
    setName({});
    setIconUrl('');
    setSortOrder('0');
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {(['en', 'zh', 'id', 'pt'] as Locale[]).map((locale) => (
          <div key={locale} className="space-y-1">
            <Label className="text-xs uppercase text-muted-foreground">
              Name ({locale})
            </Label>
            <Input
              value={name[locale] ?? ''}
              onChange={(e) => setName({ ...name, [locale]: e.target.value })}
              required={locale === 'en'}
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Icon URL *</Label>
          <Input
            value={iconUrl}
            onChange={(e) => setIconUrl(e.target.value)}
            placeholder="https://..."
            required
          />
        </div>
        <div className="space-y-1">
          <Label>Sort Order</Label>
          <Input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>
        <Plus className="mr-2 h-4 w-4" />
        {pending ? 'Creating...' : 'Create Category'}
      </Button>
    </form>
  );
}

function EditCategoryDialog({
  category,
  onSave,
  pending,
}: {
  category: Category;
  onSave: (input: { name: I18nText; iconUrl?: string; sortOrder?: number }) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<I18nText>(category.name ?? {});
  const [iconUrl, setIconUrl] = useState(category.iconUrl ?? '');
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder ?? 0));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name,
      iconUrl: iconUrl || undefined,
      sortOrder: parseInt(sortOrder, 10) || 0,
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
          <DialogTitle>Edit Category</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {(['en', 'zh', 'id', 'pt'] as Locale[]).map((locale) => (
              <div key={locale} className="space-y-1">
                <Label className="text-xs uppercase text-muted-foreground">
                  Name ({locale})
                </Label>
                <Input
                  value={name[locale] ?? ''}
                  onChange={(e) => setName({ ...name, [locale]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Icon URL</Label>
              <Input value={iconUrl} onChange={(e) => setIconUrl(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Sort Order</Label>
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteCategoryDialog({
  category,
  pending,
  onConfirm,
}: {
  category: Category;
  pending: boolean;
  onConfirm: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const handleConfirm = () => {
    onConfirm();
    setOpen(false);
    toast({
      title: 'Category deleted',
      description: `"${category.name?.en ?? category.id}" has been removed.`,
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
          <AlertDialogTitle>Delete category?</AlertDialogTitle>
          <AlertDialogDescription>
            This will deactivate &ldquo;{category.name?.en ?? category.id}&rdquo;. Products in this
            category will keep their categoryId but won&rsquo;t show under any active category.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
