/**
 * 商品详情 · 图片墙 tab（批C 新增）
 *
 * 后端：
 *   - POST /admin/uploads/product-image（复用现有上传：服务端鉴权/大小/类型校验）
 *   - PATCH /admin/products/:id（契约已含 mainImage + images[]，无需后端改动）
 *
 * 交互：
 *   - 多图上传（multiple，逐张走现有上传端点，落库为 images[] 有序数组）
 *   - 拖拽排序（原生 HTML5 draggable，零新依赖）
 *   - 删除：兜底至少保留一张（mainImage 必填，墙删光则保存按钮禁用）
 *   - 设主图：mainImage 独立字段；初始化时若主图不在墙内自动并入首位
 *
 * 落库语义：images[] 为展示有序数组，mainImage 与数组首位无强制绑定（契约独立字段）
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { GripVertical, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useUpdateProduct, type Product } from '@/hooks/api/use-products';
import { uploadByScene, type UploadResultData } from '@/lib/upload-scenes';
import { localizeUploadError, phaseToProgress, toUploadError, type UploadPhase } from '@/lib/upload-errors';
import { UploadProgressBar } from '@/components/upload/upload-progress-bar';

interface UploadResponse extends UploadResultData {}

/** 批B（改动4）：单张上传明细——失败项保留文件可重试，不再单张失败中断整批 */
interface ImageUploadItem {
  id: string;
  file: File;
  phase: 'uploading' | 'done' | 'error';
  /** 失败时本地化后的错误文案 */
  error?: string;
  /** 网络类失败可手动重试（业务类 4xx 校验失败重试无意义） */
  retryable?: boolean;
  /** 本地预览 object URL（失败项保留缩略图，done 后仍挂 URL 供展示） */
  previewUrl: string;
}

/**
 * product 落库值 → 图片墙初始化形态（主图不在墙内并入首位）。
 * 初始化与 dirty 基准共用同一归一化，保证「规范化本身」不算用户改动（审查 P3-1）
 */
function normalizeWall(product: Product): { images: string[]; mainImage: string } {
  const wall = [...(product.images ?? [])];
  const main = product.mainImage ?? '';
  // 主图不在墙内（basic tab 单独上传的旧数据）→ 并入首位，保证墙内总有主图可指
  if (main && !wall.includes(main)) wall.unshift(main);
  return { images: wall, mainImage: main || wall[0] || '' };
}

export function ImagesTab({ productId, product }: { productId: string; product: Product }) {
  const t = useTranslations('common');
  const { toast } = useToast();
  const updateMutation = useUpdateProduct();

  const [images, setImages] = useState<string[]>([]);
  const [mainImage, setMainImage] = useState('');
  const [uploading, setUploading] = useState(false);
  // 批B（改动4）：逐张上传明细（失败项可重试，不再单张失败中断整批）
  const [pendingUploads, setPendingUploads] = useState<ImageUploadItem[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 初始化基准（审查 P3-1）：dirty 与「归一化后的墙」对比而非原始落库值——
  // 否则主图并入首位的旧数据一打开就误报 dirty 并可保存（数据无害，纯提示噪声）
  const baseline = useMemo(() => normalizeWall(product), [product]);

  useEffect(() => {
    setImages(baseline.images);
    setMainImage(baseline.mainImage);
  }, [baseline]);

  /** 有未保存变更（与初始化基准对比），提示用户别忘保存 */
  const dirty = JSON.stringify({ images, mainImage }) !== JSON.stringify(baseline);

  /**
   * 批B（改动4）：多图上传改为逐张明细——每张独立 phase/error/retryable，
   * 失败不再中断整批；成功的图追加进墙，失败项留在「失败明细」区可重试。
   */
  const runOne = async (item: ImageUploadItem) => {
    setPendingUploads((prev) =>
      prev.map((p) => (p.id === item.id ? { ...p, phase: 'uploading', error: undefined } : p)),
    );
    try {
      const res = await uploadByScene<UploadResponse>('product-image-wall', item.file, 'file', {
        onPhase: (phase: UploadPhase) => {
          if (phase === 'done') setPendingUploads((prev) => prev.map((p) => (p.id === item.id ? { ...p, phase: 'done' } : p)));
        },
      });
      setImages((prev) => [...prev, res.data.url]);
      // 墙原本为空 → 首张成功图自动成为主图（baseline 保证墙非空时 mainImage 必非空，
      // 故 mainImage 为空即「原本无主图」；updater 纯函数，StrictMode 下并发成功仅首个空值生效）
      setMainImage((current) => current || res.data.url);
      // 成功 → 明细项移除（回收 object URL；成功图由墙的 <img> 直接展示远程 URL）
      URL.revokeObjectURL(item.previewUrl);
      setPendingUploads((prev) => prev.filter((p) => p.id !== item.id));
    } catch (err) {
      const uploadErr = toUploadError(err);
      setPendingUploads((prev) =>
        prev.map((p) =>
          p.id === item.id
            ? {
                ...p,
                phase: 'error',
                error: localizeUploadError(uploadErr, t, t.has.bind(t)),
                retryable: uploadErr.kind === 'network',
              }
            : p,
        ),
      );
    }
  };

  const handleFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    if (fileInputRef.current) fileInputRef.current.value = '';
    const items: ImageUploadItem[] = files.map((file, i) => ({
      id: `${Date.now()}-${i}-${file.name}`,
      file,
      phase: 'uploading',
      previewUrl: URL.createObjectURL(file),
    }));
    setPendingUploads((prev) => [...prev, ...items]);
    setUploading(true);
    // 并发逐张：一张失败不影响其余（改动4 核心——替换原 for-await「单张失败即中断批次」）
    await Promise.allSettled(items.map((item) => runOne(item)));
    setUploading(false);
  };

  /** 批B（改动4）：重试失败项（网络类） */
  const handleRetryItem = async (item: ImageUploadItem) => {
    setUploading(true);
    await runOne(item);
    setUploading(false);
  };

  /** 批B（改动4）：移除失败明细项（放弃该张），回收 object URL */
  const handleDismissItem = (id: string) => {
    setPendingUploads((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  // 批B 修复 P3-5：组件卸载（切 tab）时回收仍挂着的失败项 object URL。
  // ref 镜像避免 effect 依赖 pendingUploads 导致每次增删都重建 cleanup；
  // StrictMode 双挂载下 cleanup 会 revoke 后重新 createObjectURL（handleFilesChange 里新建），
  // 但首次挂载时 pendingUploadsRef 恒为空数组，无副作用。
  const pendingUploadsRef = useRef<ImageUploadItem[]>([]);
  pendingUploadsRef.current = pendingUploads;
  useEffect(() => {
    return () => {
      for (const p of pendingUploadsRef.current) URL.revokeObjectURL(p.previewUrl);
    };
  }, []);

  /** 拖拽排序：把 from 位置的图移动到 to 位置 */
  const handleDrop = (to: number) => {
    if (dragIndex === null || dragIndex === to) return;
    setImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(to, 0, moved!);
      return next;
    });
    setDragIndex(null);
  };

  /** 删除单图：删的是主图时兜底设剩余第一张；最后一张禁止删（mainImage 必填） */
  const handleDelete = (index: number) => {
    if (images.length <= 1) return;
    const next = images.filter((_, i) => i !== index);
    setImages(next);
    if (mainImage === images[index]) setMainImage(next[0] ?? '');
  };

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        id: productId,
        input: { images, mainImage },
      });
      toast({ title: t('w.products.imagesSaved') });
    } catch (err) {
      toast({
        title: t('w.products.imagesSaveFailed'),
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  // 墙非空 + 主图在 + 有未保存变更才可保存（clean 状态禁用防无意义写库）
  const canSave = images.length > 0 && !!mainImage && dirty;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('w.products.imageWallTitle')}</CardTitle>
        <div className="flex items-center gap-2">
          {dirty && (
            <Badge variant="secondary">{t('w.products.dirtyHint')}</Badge>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFilesChange}
            disabled={uploading}
            className="hidden"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? t('w.form.uploading') : t('w.products.uploadImages')}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave || updateMutation.isPending}>
            {updateMutation.isPending ? t('w.form.saving') : t('w.products.saveImages')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t('w.products.imageWallHint')}</p>
        {/* 批B（改动4）：失败/进行中明细区——失败项显示错误文案 + 重试/放弃，不进墙 */}
        {pendingUploads.length > 0 && (
          <div className="space-y-1 rounded border border-dashed p-2">
            {pendingUploads.map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-xs">
                <img
                  src={item.previewUrl}
                  alt=""
                  className="h-8 w-8 rounded border object-cover"
                />
                {item.phase === 'uploading' ? (
                  <>
                    <UploadProgressBar progress={phaseToProgress('uploading')} />
                    <span className="text-muted-foreground">{t('w.form.uploading')}</span>
                  </>
                ) : (
                  <>
                    <span className="flex-1 truncate text-destructive">{item.error}</span>
                    {item.retryable && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2"
                        disabled={uploading}
                        onClick={() => void handleRetryItem(item)}
                      >
                        {t('retry')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2"
                      onClick={() => handleDismissItem(item.id)}
                    >
                      {t('w.form.cancel')}
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        {images.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('w.products.imageWallEmpty')}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {images.map((url, index) => {
              const isMain = url === mainImage;
              return (
                <div
                  key={`${url}-${index}`}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(index)}
                  className={`space-y-1 rounded border p-2 ${
                    dragIndex === index ? 'opacity-50' : ''
                  }`}
                >
                  <div className="relative">
                    <img src={url} alt="" className="aspect-square w-full rounded object-cover" />
                    {isMain && (
                      <Badge className="absolute left-1 top-1">{t('w.products.mainImageBadge')}</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" />
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={isMain}
                        title={isMain ? undefined : t('w.products.setMainImage')}
                        onClick={() => setMainImage(url)}
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        disabled={images.length <= 1}
                        title={
                          images.length <= 1
                            ? t('w.products.deleteLastWarn')
                            : t('w.products.deleteImage')
                        }
                        onClick={() => handleDelete(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {updateMutation.error && (
          <p className="text-sm text-destructive">
            {t('w.form.saveFailed', { message: updateMutation.error.message })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
