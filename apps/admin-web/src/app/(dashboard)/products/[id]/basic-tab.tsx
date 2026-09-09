/**
 * 商品详情 · 基本信息 tab（批C 从 page.tsx 拆出）
 *
 * 逻辑与拆分前一致：4 语言 name/description + 主图上传 + 分类 + 保存
 */
'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useUpdateProduct,
  type I18nText,
  type Product,
} from '@/hooks/api/use-products';
import { uploadByScene, type UploadResultData } from '@/lib/upload-scenes';
import { CategorySelect } from '@/components/common/category-select';

type Locale = 'en' | 'zh' | 'id' | 'pt';

interface UploadResponse extends UploadResultData {}

export function BasicTab({ productId, product }: { productId: string; product: Product }) {
  const t = useTranslations('common');
  const router = useRouter();
  const updateMutation = useUpdateProduct();

  const [name, setName] = useState<I18nText>({});
  const [mainImage, setMainImage] = useState('');
  const [description, setDescription] = useState<I18nText>({});
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(product.name ?? {});
    setMainImage(product.mainImage ?? '');
    setDescription(product.description ?? {});
    setCategoryId(product.categoryId ?? null);
  }, [product]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      const res = await uploadByScene<UploadResponse>('product-main-edit', file);
      setMainImage(res.data.url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveBasic = async () => {
    await updateMutation.mutateAsync({
      id: productId,
      input: {
        name,
        mainImage: mainImage || undefined,
        description,
        categoryId: categoryId ?? null,
      },
    });
  };

  /** 多语言输入网格（en/zh/id/pt 4 语言，tet 由客户端 fallback en） */
  const i18nInputs = (
    label: string,
    value: I18nText,
    onChange: (v: I18nText) => void,
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
            />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('w.products.editProductTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {i18nInputs(t('w.form.name'), name, setName)}
        <div className="space-y-2">
          <Label>{t('w.form.mainImageUpload')}</Label>
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              disabled={uploading}
              className="text-sm"
            />
            {mainImage && (
              <img
                src={mainImage}
                alt=""
                className="h-20 w-20 rounded border object-cover"
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('w.form.mainImageHint')}</p>
          {uploading && (
            <p className="text-xs text-muted-foreground">{t('w.form.uploading')}</p>
          )}
          {uploadError && (
            <p className="text-xs text-destructive">
              {t('w.form.uploadFailed')}: {uploadError}
            </p>
          )}
          {mainImage && (
            <Input
              value={mainImage}
              onChange={(e) => setMainImage(e.target.value)}
              className="font-mono text-xs"
            />
          )}
        </div>
        {i18nInputs(t('w.form.description'), description, setDescription)}
        <div className="space-y-2">
          <Label>{t('w.form.category')}</Label>
          <CategorySelect value={categoryId} onChange={setCategoryId} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => router.push('/products')}>
            {t('w.form.back')}
          </Button>
          <Button
            type="button"
            onClick={handleSaveBasic}
            disabled={updateMutation.isPending || uploading}
          >
            {uploading
              ? t('w.form.uploading')
              : updateMutation.isPending
                ? t('w.form.saving')
                : t('w.form.save')}
          </Button>
        </div>
        {updateMutation.error && (
          <p className="text-sm text-destructive">
            {t('w.form.saveFailed', { message: updateMutation.error.message })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
