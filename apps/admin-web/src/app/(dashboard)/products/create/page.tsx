/**
 * 新建商品表单页 — /products/create
 *
 * 后端：POST /admin/products
 *
 * 字段（按契约 packages/api-contract/src/schemas/catalog.ts CreateProductRequest）：
 *   - name（4 语言：en/zh/id/pt，必填 en）
 *   - mainImage（URL）
 *   - description（4 语言，可选）
 *   - categoryId（select，可选）
 *   - unit（4 语言，可选）
 *   - status（ACTIVE/INACTIVE，默认 ACTIVE）
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateProduct } from '@/hooks/api/use-products';
import { useCategories } from '@/hooks/api/use-categories';
import type { I18nText } from '@/hooks/api/use-products';

type Locale = 'en' | 'zh' | 'id' | 'pt';

export default function CreateProductPage() {
  const t = useTranslations('common');
  const router = useRouter();
  const createMutation = useCreateProduct();
  const categoriesQ = useCategories();
  const categories = categoriesQ.data?.data ?? [];

  const [name, setName] = useState<I18nText>({});
  const [mainImage, setMainImage] = useState('');
  const [description, setDescription] = useState<I18nText>({});
  const [unit, setUnit] = useState<I18nText>({});
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mainImage || !unit.en) return;
    try {
      const res = await createMutation.mutateAsync({
        name,
        mainImage,
        description: Object.keys(description).length ? description : undefined,
        unit,
        categoryId: categoryId || undefined,
        status,
      });
      router.push(`/products/${res.data.id}`);
    } catch {
      // mutation 内部已经 invalidate，错误展示由 message 处理
    }
  };

  const i18nField = (
    label: string,
    value: I18nText,
    onChange: (v: I18nText) => void,
    placeholder?: string,
    requiredLocale?: Locale,
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
              placeholder={placeholder ?? ''}
              required={requiredLocale === locale && !value[locale]}
            />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PageHeader
        title={t('w.products.create') as string}
        breadcrumb={[
          { label: t('w.products.title'), href: '/products' },
          { label: t('w.products.create') },
        ]}
        action={
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              {t('w.form.cancel')}
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? t('w.form.saving') : t('w.form.save')}
            </Button>
          </div>
        }
      />

      {createMutation.error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t('w.form.errorPrefix', { message: createMutation.error.message })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('w.form.basicInfo')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {i18nField(t('w.form.name'), name, setName, 'Product name', 'en')}
          <div className="space-y-2">
            <Label>
              {t('w.form.mainImageUrl')} <span className="text-destructive">*</span>
            </Label>
            <Input
              value={mainImage}
              onChange={(e) => setMainImage(e.target.value)}
              placeholder="https://..."
              required
            />
            {mainImage && (
              <img
                src={mainImage}
                alt=""
                className="h-20 w-20 rounded border object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.visibility = 'hidden';
                }}
              />
            )}
          </div>
          {i18nField(t('w.form.description'), description, setDescription, 'Optional description')}
          {i18nField(
            `${t('w.products.unit')} *`,
            unit,
            setUnit,
            t('w.products.unitPlaceholder'),
            'en',
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('w.form.category')}</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('w.form.selectCategoryOptional')} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name.en ?? c.name.zh ?? c.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('w.form.status')}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as 'ACTIVE' | 'INACTIVE')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">{t('w.status.active')}</SelectItem>
                  <SelectItem value="INACTIVE">{t('w.status.inactive')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
