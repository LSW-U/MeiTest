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
import { localizeUploadError, phaseToProgress, precheckUploadFile, PrecheckError, toUploadError, type UploadPhase } from '@/lib/upload-errors';
import { UploadProgressBar } from '@/components/upload/upload-progress-bar';
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
  // 批B（改动4）：手动重试兜底状态
  const [canRetry, setCanRetry] = useState(false);
  const lastFileRef = useRef<File | null>(null);
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
    if (fileInputRef.current) fileInputRef.current.value = '';
    await handleUpload(file);
  };

  // 批B（改动4）：同构 create 页——错误码本地化 + 网络类耗尽自动重试后手动兜底
  // 批C（批B P3-1）：上传前本地预校验（mime/size/尺寸对齐后端规则），PrecheckError
  // 直接本地化展示、不进重试链（4xx 类校验失败重试无意义）
  const handleUpload = async (file: File) => {
    setUploadError('');
    setCanRetry(false);
    try {
      await precheckUploadFile('product-main-edit', file);
    } catch (err) {
      if (err instanceof PrecheckError) {
        setUploadError(t.has(`errors.${err.code}`) ? t(`errors.${err.code}`) : err.message);
        return;
      }
      throw err;
    }
    setUploading(true);
    try {
      const res = await uploadByScene<UploadResponse>('product-main-edit', file, 'file', {
        onPhase: (phase: UploadPhase) => {
          if (phase === 'done') setUploading(false);
        },
      });
      setMainImage(res.data.url);
    } catch (err) {
      const uploadErr = toUploadError(err);
      setUploadError(localizeUploadError(uploadErr, t, t.has.bind(t)));
      setCanRetry(uploadErr.kind === 'network');
      lastFileRef.current = file;
    } finally {
      setUploading(false);
    }
  };

  /** 手动重试兜底：重发同一文件（网络类耗尽自动重试后开放） */
  const handleRetry = async () => {
    if (lastFileRef.current) await handleUpload(lastFileRef.current);
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
            <>
              <UploadProgressBar progress={phaseToProgress('uploading')} />
              <p className="text-xs text-muted-foreground">{t('w.form.uploading')}</p>
            </>
          )}
          {uploadError && (
            <p className="text-xs text-destructive">
              {t('w.form.uploadFailed')}: {uploadError}
            </p>
          )}
          {canRetry && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={uploading}
              onClick={() => void handleRetry()}
            >
              {t('retry')}
            </Button>
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
