/**
 * EvidenceImageGroup — 取证图片组通用组件（批1 抽取自 refunds/[id] gallery，方案v2 §三-B）
 *
 * props:
 *   - urls: string[]      图片 URL 数组（空数组/非数组不渲染）
 *   - label?: string      区块标题（i18n 已翻译文本；缺省不渲染标题行）
 *   - sensitive?: boolean 敏感图（KYC 证件照）：缩略图默认模糊 + 点击解锁/再点复锁
 *
 * 行为：
 *   - 缩略图行（96×96 object-cover）+ 点击弹 Dialog lightbox 放大
 *   - lightbox 内多图切换（‹ › 按钮，多图时显示）
 *   - 加载失败占位（broken image 图标 + i18n 文案）
 *   - aria 带 {number} 序号语义（通用 key photoAction/photoUnlockAction，P3-1 批2 落地）
 *
 * 范本：refunds/[id]/page.tsx:188-266（P13 4bc1e09）；feedback/page.tsx 为辅助先例，勿动。
 */
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';

export interface EvidenceImageGroupProps {
  urls: string[] | null | undefined;
  label?: string;
  sensitive?: boolean;
}

/* ===== 可测纯逻辑（与组件渲染分支同源；node 环境单测入口，勿引 DOM） ===== */

/**
 * lightbox 大图 className（P2-1 ⑰ 锁底本等价）：
 * 与重构底本 refunds/[id] 旧 lightbox img 逐字一致；页面与测试共同引用本常量。
 */
export const LIGHTBOX_IMG_CLASSNAME = 'h-auto max-h-[80vh] w-full object-contain';

/** 空数组/非数组/字段缺失 → 不渲染（方案v2 决策表） */
export function shouldRenderUrls(urls: string[] | null | undefined): boolean {
  return Array.isArray(urls) && urls.length > 0;
}

/** lightbox 下一张（循环） */
export function nextLightboxIndex(idx: number, total: number): number {
  return (idx + 1) % total;
}

/** lightbox 上一张（循环） */
export function prevLightboxIndex(idx: number, total: number): number {
  return (idx - 1 + total) % total;
}

/** sensitive 缩略图是否模糊：sensitive 且未解锁 */
export function isThumbBlurred(sensitive: boolean, unlocked: boolean): boolean {
  return sensitive && !unlocked;
}

/** 缩略图点击意图：sensitive 未解锁 → 解锁；否则 → 开 lightbox */
export function onThumbClickIntent(o: {
  sensitive: boolean;
  unlocked: boolean;
}): { unlock: true } | { openIdx: true } {
  return o.sensitive && !o.unlocked ? { unlock: true } : { openIdx: true };
}

/**
 * urls 内容等价键（P2-2）：以 join 后字符串为重置依赖，父组件内联数组
 * identity 变化（重渲染）不再误触发交互态重置；仅内容真变（换资源）才重置。
 */
export function urlsContentKey(urls: string[]): string {
  return urls.join('\n');
}

/** 缩略图失败态判定（P2-1 提纯可测）：onError 触发后该图转失败占位 */
export function isThumbFailed(failedMap: Record<number, boolean>, idx: number): boolean {
  return failedMap[idx] === true;
}

/** 单图加载态（失败占位） */
function Thumb({
  url,
  idx,
  blurred,
  onClick,
  failedAlt,
  ariaLabel,
}: {
  url: string;
  idx: number;
  blurred: boolean;
  onClick: () => void;
  failedAlt: string;
  ariaLabel: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground"
        data-testid={`evidence-thumb-failed-${idx}`}
      >
        <ImageOff className="h-5 w-5" />
        <span className="px-1 text-center text-[10px] leading-tight">{failedAlt}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative h-24 w-24 overflow-hidden rounded-md border hover:opacity-80"
      aria-label={ariaLabel}
      data-testid={`evidence-thumb-${idx}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`evidence-${idx + 1}`}
        onError={() => setFailed(true)}
        className={`h-full w-full object-cover transition ${blurred ? 'blur-md' : ''}`}
      />
    </button>
  );
}

export function EvidenceImageGroup({
  urls,
  label,
  sensitive,
}: EvidenceImageGroupProps) {
  // 空数组/非数组不渲染（方案决策表：dispatch/riders 空态不渲染）
  if (!shouldRenderUrls(urls)) return null;

  return <EvidenceImageGroupInner urls={urls as string[]} label={label} sensitive={sensitive} />;
}

/** 内层组件：确认有图后才挂载，hooks 安全 */
function EvidenceImageGroupInner({
  urls,
  label,
  sensitive,
}: {
  urls: string[];
  label?: string;
  sensitive?: boolean;
}) {
  const t = useTranslations('common');
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [lightboxesFailed, setLightboxesFailed] = useState<Record<number, boolean>>({});

  // urls 内容等价键（P2-2）：内联数组 identity 变化不重置，仅内容真变才重置交互态
  const contentKey = urlsContentKey(urls);
  useEffect(() => {
    setLightboxIdx(null);
    setUnlocked(false);
    setLightboxesFailed({});
  }, [contentKey]);

  const open = lightboxIdx !== null;

  return (
    <div className="space-y-3" data-testid="evidence-image-group">
      {label && <h3 className="text-sm font-semibold">{label}</h3>}
      <div className="flex flex-wrap gap-3">
        {urls.map((url, idx) => (
          <div key={url + idx} onClick={sensitive && !unlocked ? () => setUnlocked(true) : undefined}>
            <Thumb
              url={url}
              idx={idx}
              blurred={isThumbBlurred(!!sensitive, unlocked)}
              onClick={() => {
                const intent = onThumbClickIntent({
                  sensitive: !!sensitive,
                  unlocked,
                });
                if ('unlock' in intent) setUnlocked(true);
                else setLightboxIdx(idx);
              }}
              failedAlt={t('admin.evidence.loadFailed')}
              ariaLabel={
                sensitive && !unlocked
                  ? t('admin.evidence.photoUnlockAction', { number: idx + 1 })
                  : t('admin.evidence.photoAction', { number: idx + 1 })
              }
            />
          </div>
        ))}
      </div>
      {sensitive && !unlocked && (
        <p className="text-xs text-muted-foreground">{t('admin.evidence.sensitiveHint')}</p>
      )}

      {/* lightbox Dialog（点击缩略图放大；sensitive 未解锁时打不开） */}
      <Dialog open={open} onOpenChange={(o) => !o && setLightboxIdx(null)}>
        <DialogContent className="max-w-3xl">
          <DialogTitle className="sr-only">{t('admin.refunds.photoLightboxTitle')}</DialogTitle>
          {lightboxIdx !== null && urls[lightboxIdx] && (
            <div className="relative">
              {isThumbFailed(lightboxesFailed, lightboxIdx) ? (
                <div
                  className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground"
                  data-testid="evidence-lightbox-failed"
                >
                  <ImageOff className="h-8 w-8" />
                  <span className="text-sm">{t('admin.evidence.loadFailed')}</span>
                </div>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={urls[lightboxIdx]}
                  alt={`evidence-large-${lightboxIdx + 1}`}
                  onError={() =>
                    setLightboxesFailed((m) => ({ ...m, [lightboxIdx]: true }))
                  }
                  className={LIGHTBOX_IMG_CLASSNAME}
                />
              )}
              {urls.length > 1 && (
                <div className="mt-2 flex items-center justify-center gap-4">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      setLightboxIdx((i) => prevLightboxIndex(i ?? 0, urls.length))
                    }
                    aria-label={t('admin.evidence.prevImage')}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {lightboxIdx + 1} / {urls.length}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      setLightboxIdx((i) => nextLightboxIndex(i ?? 0, urls.length))
                    }
                    aria-label={t('admin.evidence.nextImage')}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
