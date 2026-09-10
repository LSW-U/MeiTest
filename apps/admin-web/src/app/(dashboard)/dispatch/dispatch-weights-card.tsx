/**
 * 派单排序权重配置卡（保证金拦截链批C C1，2026-09-11）
 *
 * 方案：方案v2-保证金拦截链与可配化-20260910 §0 T2 + §3 批C C1
 *
 * 后端：SystemConfig 单键 `dispatch.score_weights`（批A A5/A6）
 *   GET  /admin/platform/system-configs              列表（含该 key，seed 预置）
 *   PUT  /admin/platform/system-configs/:key         保存（后端 DEL 派生缓存 + INCR
 *                                                    config:dispatch:weights:ver bump）
 * 校验：shared-utils validateScoreWeights（对齐后端 zod refine 和=1，容差 1e-9），
 *       每项 ∈ [0,1]；预设：默认 0.5/0.3/0.2、距离优先 0.2/0.6/0.2、自定义。
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useSystemConfigs, useUpdateSystemConfig } from '@/hooks/api/use-settings';
import { ApiError } from '@/lib/api';
import {
  validateScoreWeights,
  stringifyScoreWeights,
  parseScoreWeightsOrNull,
  SCORE_WEIGHTS_PRESET_DEFAULT,
  SCORE_WEIGHTS_PRESET_DISTANCE_FIRST,
  type DispatchScoreWeights,
} from '@meimart/shared-utils';

/** SystemConfig 单键（后端 dispatch-scores.config.ts CONFIG_KEY 同值） */
const SCORE_WEIGHTS_CONFIG_KEY = 'dispatch.score_weights';

/** 三字段展示顺序（i18n key 后缀与字段名一致，禁动态拼 key——字面量逐个写） */
const WEIGHT_FIELDS = ['rating', 'distance', 'inTransit'] as const;
type WeightField = (typeof WEIGHT_FIELDS)[number];

type PresetChoice = 'default' | 'distanceFirst' | 'custom';

const FIELD_LABEL_KEYS: Record<WeightField, 'admin.dispatchCenter.weightRating' | 'admin.dispatchCenter.weightDistance' | 'admin.dispatchCenter.weightInTransit'> = {
  rating: 'admin.dispatchCenter.weightRating',
  distance: 'admin.dispatchCenter.weightDistance',
  inTransit: 'admin.dispatchCenter.weightInTransit',
};

export function DispatchWeightsCard() {
  const t = useTranslations('common');
  const { toast } = useToast();
  const { data: configs, isLoading, error } = useSystemConfigs();
  const updateMutation = useUpdateSystemConfig();

  const [weights, setWeights] = useState<DispatchScoreWeights>(SCORE_WEIGHTS_PRESET_DEFAULT);
  const [preset, setPreset] = useState<PresetChoice>('default');
  const [loaded, setLoaded] = useState(false);

  // 回显：SystemConfig 列表里找 dispatch.score_weights；未配置/非法 → 默认预设 + 提示
  useEffect(() => {
    if (!configs || loaded) return;
    const row = configs.find((c) => c.key === SCORE_WEIGHTS_CONFIG_KEY);
    const parsed = parseScoreWeightsOrNull(row?.value);
    if (parsed) {
      setWeights(parsed);
      setPreset(matchPreset(parsed));
    } else {
      // 未配置（key 缺失/空值）或值非法（parse 失败/和≠1/越界）→ 都回退默认预设 + 提示。
      // 和≠1 回退对齐后端语义（批C 审查 P3-3）：后端对非法存量值回退代码常量参与
      // 排序，前端展示同样回退，避免「展示 A、系统跑 B」分叉。
      toast({ description: t('admin.dispatchCenter.weightsLoadFailed') });
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅首次加载回显一次
  }, [configs]);

  /** 当前值匹配哪个预设（浮点和容差比较，0.1+0.2+0.7≠精确 1） */
  function matchPreset(w: DispatchScoreWeights): PresetChoice {
    const eq = (a: DispatchScoreWeights, b: DispatchScoreWeights) =>
      a.rating === b.rating && a.distance === b.distance && a.inTransit === b.inTransit;
    if (eq(w, SCORE_WEIGHTS_PRESET_DEFAULT)) return 'default';
    if (eq(w, SCORE_WEIGHTS_PRESET_DISTANCE_FIRST)) return 'distanceFirst';
    return 'custom';
  }

  /** 单滑杆变更：同步数字输入；预设态变自定义（不重算其余两项——和校验交保存时拦） */
  function setField(field: WeightField, value: number) {
    const next = { ...weights, [field]: value };
    setWeights(next);
    setPreset(matchPreset(next));
  }

  /** 预设切换：整组覆写 */
  function applyPreset(choice: PresetChoice) {
    setPreset(choice);
    if (choice === 'default') setWeights(SCORE_WEIGHTS_PRESET_DEFAULT);
    if (choice === 'distanceFirst') setWeights(SCORE_WEIGHTS_PRESET_DISTANCE_FIRST);
  }

  /** 校验 + 保存 → PUT SystemConfig（后端 bump weights:ver，派单进程自动回源） */
  async function handleSave() {
    const v = validateScoreWeights(weights);
    if (!v.valid) {
      toast({
        variant: 'destructive',
        description:
          v.reason === 'sum'
            ? t('admin.dispatchCenter.weightSumError', { sum: String(v.sum) })
            : t('admin.dispatchCenter.weightRangeError'),
      });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        key: SCORE_WEIGHTS_CONFIG_KEY,
        value: stringifyScoreWeights(weights),
      });
      toast({ title: t('admin.dispatchCenter.weightsSaved') });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error.generic');
      toast({ variant: 'destructive', description: message });
    }
  }

  const validation = useMemo(() => validateScoreWeights(weights), [weights]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t('error.loadFailed')}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <SlidersHorizontal className="h-4 w-4" />
          {t('admin.dispatchCenter.weightsTitle')}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t('admin.dispatchCenter.weightsDescription')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 预设下拉 */}
        <div className="space-y-1.5">
          <Label htmlFor="weights-preset">{t('admin.dispatchCenter.weightPreset')}</Label>
          <Select value={preset} onValueChange={(v) => applyPreset(v as PresetChoice)}>
            <SelectTrigger id="weights-preset" className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">{t('admin.dispatchCenter.weightPresetDefault')}</SelectItem>
              <SelectItem value="distanceFirst">{t('admin.dispatchCenter.weightPresetDistanceFirst')}</SelectItem>
              <SelectItem value="custom">{t('admin.dispatchCenter.weightPresetCustom')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 三滑杆 + 数字输入（字面量逐字段，无动态拼 key） */}
        <div className="space-y-3">
          {WEIGHT_FIELDS.map((field) => (
            <div key={field} className="space-y-1.5">
              <Label htmlFor={`weights-${field}`}>{t(FIELD_LABEL_KEYS[field])}</Label>
              <div className="flex items-center gap-3">
                <input
                  id={`weights-${field}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={weights[field]}
                  onChange={(e) => setField(field, Number(e.target.value))}
                  className="h-1.5 w-full max-w-xs cursor-pointer appearance-none rounded bg-muted accent-primary"
                />
                <Input
                  aria-label={t(FIELD_LABEL_KEYS[field])}
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={weights[field]}
                  onChange={(e) => setField(field, Number(e.target.value))}
                  className="w-24"
                />
              </div>
            </div>
          ))}
        </div>

        {/* 和=1 实时校验 */}
        <div className="flex items-center justify-between border-t pt-3">
          <p
            className={`text-xs ${validation.valid ? 'text-muted-foreground' : 'font-medium text-destructive'}`}
          >
            {t('admin.dispatchCenter.weightSumLabel')}: {validation.sum ?? '—'} / 1
            {!validation.valid && validation.reason === 'sum' && (
              <>
                {' · '}
                {t('admin.dispatchCenter.weightSumError', { sum: String(validation.sum) })}
              </>
            )}
            {!validation.valid && validation.reason !== 'sum' && (
              <>
                {' · '}
                {t('admin.dispatchCenter.weightRangeError')}
              </>
            )}
          </p>
          <Button onClick={handleSave} disabled={updateMutation.isPending || !validation.valid}>
            {updateMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {t('save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
