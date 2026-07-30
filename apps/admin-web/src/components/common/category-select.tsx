/**
 * CategorySelect — 商品分类选择器（两级树形，引导挂叶子）
 *
 * 供商品新建/编辑页复用。按大类 SelectGroup 分组，子分类缩进展示；
 * 大类无子分类时允许直接选大类。含"无分类"选项（映射 categoryId=null）。
 *
 * 后端：GET /admin/categories（平铺带 parentId）→ buildCategoryTree 组装两层。
 */
'use client';

import { useTranslations } from 'next-intl';
import { useCategories, buildCategoryTree } from '@/hooks/api/use-categories';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** "无分类"哨兵值（Radix Select 不允许空字符串 value，用哨兵映射 null） */
const NONE = '__none__';

export function CategorySelect({
  value,
  onChange,
  placeholder,
}: {
  value?: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
}) {
  const t = useTranslations('common');
  const categoriesQ = useCategories();
  const flat = categoriesQ.data?.data ?? [];
  const tree = buildCategoryTree(flat);
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder ?? t('w.form.selectCategoryOptional')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t('w.categories.noCategory')}</SelectItem>
        {tree.map((root) => (
          <SelectGroup key={root.id}>
            <SelectLabel className="font-medium">{root.name?.en ?? root.name?.zh ?? root.id}</SelectLabel>
            {root.children.length > 0 ? (
              root.children.map((child) => (
                <SelectItem key={child.id} value={child.id}>
                  <span className="mr-1 text-muted-foreground">└</span>
                  {child.name?.en ?? child.name?.zh ?? child.id}
                </SelectItem>
              ))
            ) : (
              <SelectItem value={root.id}>{root.name?.en ?? root.name?.zh ?? root.id}</SelectItem>
            )}
          </SelectGroup>
        ))}
        {tree.length === 0 && categoriesQ.isLoading && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {t('w.categories.uploading')}
          </div>
        )}
      </SelectContent>
    </Select>
  );
}
