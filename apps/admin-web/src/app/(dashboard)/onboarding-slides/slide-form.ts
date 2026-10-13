/**
 * 引导页表单纯函数（引导页内容可配置 · 批2）
 *
 * 从 page.tsx 抽出（node 环境单测可导入，不引 JSX/next-intl）：
 * 表单校验 + form state → create input 的清洗转换。
 */
import type { I18nText, CreateOnboardingSlideInput } from '@/hooks/api/use-onboarding-slides';

/** 表单内部状态（新建/编辑共用） */
export interface SlideFormState {
  icon: string;
  imageUrl: string;
  title: I18nText;
  description: I18nText;
  sortOrder: string;
  enabled: boolean;
}

/** 表单校验：en title 必填；非法 sortOrder 拒。返回错误 key 或 null */
export function validateForm(
  form: SlideFormState,
): 'titleEnRequired' | 'sortOrderInvalid' | null {
  if (!form.title.en?.trim()) return 'titleEnRequired';
  const n = parseInt(form.sortOrder, 10);
  if (Number.isNaN(n) || n < 0) return 'sortOrderInvalid';
  return null;
}

/** form state → create input（空字符串不提交，tet 空 = 前端回退） */
export function toCreateInput(form: SlideFormState): CreateOnboardingSlideInput {
  const clean = (v: I18nText): I18nText =>
    Object.fromEntries(
      Object.entries(v).filter(([, s]) => typeof s === 'string' && s.trim() !== ''),
    );
  return {
    icon: form.icon.trim() || null,
    imageUrl: form.imageUrl.trim() || null,
    title: clean(form.title) as I18nText,
    description: clean(form.description),
    sortOrder: parseInt(form.sortOrder, 10) || 0,
    enabled: form.enabled,
  };
}
