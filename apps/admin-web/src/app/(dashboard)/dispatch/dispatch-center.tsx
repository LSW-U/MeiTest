/**
 * 派单中心 — 按仓分组待派单 → 候选列表 → 确认指派（批 E，2026-09-03）
 *
 * 方案 Q13：系统排序推荐（后端批 D candidates，score 降序 + 平局保证金优先）+ admin 一键确认。
 * 后端：
 *   GET  /admin/dispatch/tasks?status=PENDING_ASSIGN     待派任务（复用 useDispatchTasks）
 *   GET  /admin/dispatch/tasks/:id/candidates?crossWarehouse=&includeIneligible=  候选（批 D）
 *   POST /admin/dispatch/tasks/:id/assign                确认指派（批 F P0-1：PENDING_ASSIGN
 *                                                        直指端点，资格校验保留；原 reassign
 *                                                        仅 ASSIGNED → 主路径 409 断链已修）
 *
 * 交互：
 *   - 左侧：按 warehouseCode 分组的待派单卡片（订单号/金额）
 *   - 展开单 → 右侧候选：姓名/评分/在途/保证金/资格标签（✅可接 / ⛔需保证金 $Y）+ 订单金额 vs 上限
 *   - 跨仓开关：crossWarehouse=true（需勾选确认，提示「放宽工作仓，金额资格仍校验」）
 *   - includeIneligible：附带不合格候选（灰显 + ⛔标签，供 admin 引导升级）
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, ChevronRight, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDispatchTasks, useAssignTask, type AdminDeliveryTask } from '@/hooks/api/use-dispatch';
import { useDispatchCandidates, type DispatchCandidate } from '@/hooks/api/use-deposit';
import { formatCurrency } from '@/lib/utils';
import { ApiError } from '@/lib/api';

/** 资格标签（✅可接 / ⛔需保证金 $Y） */
function EligibilityTag({ candidate, t }: { candidate: DispatchCandidate; t: (k: string, v?: Record<string, string>) => string }) {
  if (candidate.eligibility.eligible) {
    return (
      <Badge variant="default" className="gap-1">
        <ShieldCheck className="h-3 w-3" />
        {t('admin.dispatchCenter.eligible')}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <ShieldAlert className="h-3 w-3" />
      {t('admin.dispatchCenter.ineligible', {
        amount: formatCurrency(candidate.eligibility.requiredDeposit ?? 0),
      })}
    </Badge>
  );
}

/** 候选行（score 降序由后端排好，前端按序展示） */
function CandidateRow({
  candidate,
  orderAmount,
  t,
  onAssign,
  assigning,
}: {
  candidate: DispatchCandidate;
  orderAmount: number;
  t: (k: string, v?: Record<string, string>) => string;
  onAssign: (c: DispatchCandidate) => void;
  assigning: boolean;
}) {
  const ineligible = !candidate.eligibility.eligible;
  return (
    <div
      className={`flex items-center justify-between gap-3 border-b py-2 last:border-0 ${ineligible ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 text-center font-mono text-xs text-muted-foreground" title={t('admin.dispatchCenter.score')}>
          {candidate.score}
        </div>
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{candidate.riderName}</span>
            <EligibilityTag candidate={candidate} t={t} />
            {!candidate.warehouseMatched && (
              <Badge variant="outline">{t('admin.dispatchCenter.crossWarehouseBadge')}</Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {/* P2-1 修复（2026-09-03）：订单金额 vs 骑手上限对比（原 void 死参数改为实际渲染） */}
            {t('admin.dispatchCenter.orderAmount')}: {formatCurrency(orderAmount)}
            {candidate.maxOrderAmount !== null && (
              <>
                {' / '}
                {t('admin.dispatchCenter.limit')} {formatCurrency(candidate.maxOrderAmount)}
              </>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {t('admin.dispatchCenter.rating')}: {candidate.rating.toFixed(1)}
            {' · '}
            {t('admin.dispatchCenter.inTransit')}: {candidate.inTransitTasks}
            {' · '}
            {t('admin.dispatchCenter.deposit')}: {formatCurrency(candidate.depositAmount)}
          </div>
        </div>
      </div>
      <Button
        size="sm"
        variant={ineligible ? 'outline' : 'default'}
        disabled={ineligible || assigning}
        onClick={() => onAssign(candidate)}
      >
        {assigning && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        {t('admin.dispatchCenter.assign')}
      </Button>
    </div>
  );
}

export function DispatchCenter({
  /** 批E审查 P2-2（2026-09-03）：仓负载面板「跨仓支援」快捷入口——定位到该仓第一个待派任务并自动弹跨仓确认 */
  crossSupportTarget,
}: {
  crossSupportTarget?: { warehouseId: string; nonce: number } | null;
}) {
  const t = useTranslations('common');
  const { toast } = useToast();

  // 待派任务（PENDING_ASSIGN）
  const { data: tasksData, isPending: tasksLoading, isError: tasksError, refetch: refetchTasks } = useDispatchTasks({
    status: 'PENDING_ASSIGN',
  });

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [crossWarehouse, setCrossWarehouse] = useState(false);
  const [includeIneligible, setIncludeIneligible] = useState(false);

  const { data: candidates, isPending: candidatesLoading } = useDispatchCandidates(
    selectedTaskId ? { taskId: selectedTaskId, crossWarehouse, includeIneligible } : null,
  );
  const assignMutation = useAssignTask();

  // 跨仓确认 Dialog
  const [crossConfirmOpen, setCrossConfirmOpen] = useState(false);

  // 指派确认 Dialog
  const [assignTarget, setAssignTarget] = useState<DispatchCandidate | null>(null);

  const tasks = useMemo(
    () => tasksData?.pages.flatMap((p) => p.items) ?? [],
    [tasksData],
  );

  // P2-2 接线：仓负载预警卡「跨仓支援」→ 选中该仓第一个待派任务 + 自动弹跨仓确认
  useEffect(() => {
    if (!crossSupportTarget) return;
    const first = tasks.find((task) => task.warehouseId === crossSupportTarget.warehouseId);
    if (first) {
      setSelectedTaskId(first.id);
      setCrossConfirmOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nonce 驱动，tasks 变化不重触发
  }, [crossSupportTarget?.nonce]);

  // 按仓库分组
  const grouped = useMemo(() => {
    const map = new Map<string, AdminDeliveryTask[]>();
    for (const task of tasks) {
      const key = task.warehouseCode;
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tasks]);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  async function handleAssign() {
    if (!assignTarget || !selectedTaskId) return;
    try {
      await assignMutation.mutateAsync({
        taskId: selectedTaskId,
        riderId: assignTarget.riderProfileId,
        reason: t('admin.dispatchCenter.assignReason'),
      });
      toast({ description: t('admin.dispatchCenter.toastAssigned', { rider: assignTarget.riderName }) });
      setAssignTarget(null);
      setSelectedTaskId(null);
      // 批F收尾 P3-1（2026-09-03）：复位过滤开关，防下次选单带旧跨仓/不合格过滤态
      setCrossWarehouse(false);
      setIncludeIneligible(false);
      refetchTasks();
    } catch (e) {
      toast({
        variant: 'destructive',
        description: e instanceof ApiError ? e.message : t('common.error.generic'),
      });
    }
  }

  if (tasksLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (tasksError) {
    return (
      <div className="flex flex-col items-center gap-2 py-12">
        <p className="text-sm text-muted-foreground">{t('error.loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => refetchTasks()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
        {t('admin.dispatchCenter.emptyPending')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 候选开关 */}
      {selectedTaskId && (
        <div className="flex flex-wrap items-center gap-6 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <input
              id="cross-warehouse"
              type="checkbox"
              checked={crossWarehouse}
              onChange={(e) => {
                if (e.target.checked) setCrossConfirmOpen(true); // 需手动确认
                else setCrossWarehouse(false);
              }}
              className="h-4 w-4"
            />
            <Label htmlFor="cross-warehouse" className="text-sm">
              {t('admin.dispatchCenter.crossWarehouseToggle')}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="include-ineligible"
              type="checkbox"
              checked={includeIneligible}
              onChange={(e) => setIncludeIneligible(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="include-ineligible" className="text-sm">
              {t('admin.dispatchCenter.includeIneligibleToggle')}
            </Label>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* 左：按仓分组待派单 */}
        <div className="space-y-4">
          {grouped.map(([warehouseCode, groupTasks]) => (
            <Card key={warehouseCode}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Badge variant="outline" className="font-mono">
                    {warehouseCode}
                  </Badge>
                  {t('admin.dispatchCenter.pendingCount', { count: String(groupTasks.length) })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {groupTasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => setSelectedTaskId(task.id)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                      selectedTaskId === task.id ? 'border-primary bg-accent' : ''
                    }`}
                  >
                    <div className="space-y-0.5">
                      <span className="font-mono text-xs font-medium">{task.order.orderNo}</span>
                      <div className="text-xs text-muted-foreground">
                        {formatCurrency(task.order.payableAmount ?? 0)}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 右：候选列表 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {selectedTask
                ? t('admin.dispatchCenter.candidatesTitle', { orderNo: selectedTask.order.orderNo })
                : t('admin.dispatchCenter.candidatesTitleEmpty')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedTaskId ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t('admin.dispatchCenter.selectTaskHint')}
              </p>
            ) : candidatesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !candidates || candidates.items.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t('admin.dispatchCenter.noCandidates')}
              </p>
            ) : (
              <div>
                {candidates.items.map((candidate) => (
                  <CandidateRow
                    key={candidate.riderProfileId}
                    candidate={candidate}
                    orderAmount={candidates.orderAmount}
                    t={t}
                    onAssign={(c) => setAssignTarget(c)}
                    assigning={assignMutation.isPending}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 跨仓开启确认（任务书：需手动确认提示） */}
      <Dialog open={crossConfirmOpen} onOpenChange={setCrossConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.dispatchCenter.crossConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('admin.dispatchCenter.crossConfirmBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCrossConfirmOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => {
                setCrossWarehouse(true);
                setCrossConfirmOpen(false);
              }}
            >
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 指派确认 */}
      <Dialog open={assignTarget !== null} onOpenChange={(open) => !open && setAssignTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.dispatchCenter.assignConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {assignTarget &&
                selectedTask &&
                t('admin.dispatchCenter.assignConfirmBody', {
                  rider: assignTarget.riderName,
                  orderNo: selectedTask.order.orderNo,
                })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTarget(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleAssign} disabled={assignMutation.isPending}>
              {assignMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('admin.dispatchCenter.assign')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
