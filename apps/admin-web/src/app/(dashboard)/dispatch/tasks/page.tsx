/**
 * 任务监控独立页 — /dispatch/tasks（任务监控独立页批1 20261019）
 *
 * 方案：方案v2-任务监控独立页-20261019.md（方案 A-1：从 /dispatch 抽独立页 + 操作全部随迁）
 * 抽离范围：任务监控区 + 详情/改派/取消三 Dialog（tasks-monitor.tsx）
 *           + 补建任务按钮/Dialog（v2 拍板随迁，触发源原为调度页 PageHeader）
 * RBAC：5 个写端点（reassign/assign/cancel/candidates/recreate）方法级仅 SUPER_ADMIN
 *       → 页面维持 platform-only 视角（sidebar perspectives ['platform']），零后端改动
 *
 * C2 直达（v2 拍板）：客服工作台「待派送」卡 → /dispatch/tasks?status=PENDING_ASSIGN&from=support
 *   pickStatusParam 解析 ?status= 作初始筛选；SupportReturnBar 渲染返回条；
 *   useSearchParams 必须包 Suspense（Next 14.2 build 要求，同 /dispatch page 先例）
 */
'use client';

import { Suspense, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { SupportReturnBar } from '@/components/common/support-return-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TasksMonitor } from '../tasks-monitor';
import { useRecreateTask, type DeliveryTaskStatus } from '@/hooks/api/use-dispatch';
import { ApiError } from '@/lib/api';
import { pickStatusParam } from '@/lib/support-return';
import { useToast } from '@/hooks/use-toast';

function TaskMonitorPageContent() {
  const t = useTranslations('common');
  const { toast } = useToast();
  const searchParams = useSearchParams();
  // C2 直达 ?status=PENDING_ASSIGN 初始化筛选（仅首挂载默认值，用户手改不锁死）
  const fromQueryStatus = pickStatusParam(searchParams.get('status'), [
    'PENDING_ASSIGN',
    'ASSIGNED',
    'PICKED_UP',
    'DELIVERING',
    'DELIVERED',
    'FAILED',
  ] as const satisfies readonly DeliveryTaskStatus[]);
  const [recreateOpen, setRecreateOpen] = useState(false);
  const [recreateOrderId, setRecreateOrderId] = useState('');
  const recreateMutation = useRecreateTask();

  async function handleRecreateSubmit() {
    if (!recreateOrderId.trim()) return;
    try {
      await recreateMutation.mutateAsync(recreateOrderId.trim());
      toast({ title: t('admin.dispatch.toastRecreateSuccess') });
      setRecreateOpen(false);
      setRecreateOrderId('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.dispatch.toastFailed');
      toast({
        title: t('admin.dispatch.toastFailed'),
        description: message,
        variant: 'destructive',
      });
    }
  }

  return (
    <div className="space-y-6 p-6">
      <SupportReturnBar />
      <PageHeader
        title={t('admin.dispatchTasks.title')}
        description={t('admin.dispatchTasks.description')}
        action={
          <Button variant="outline" onClick={() => setRecreateOpen(true)}>
            {t('admin.dispatch.recreateButton')}
          </Button>
        }
      />

      <TasksMonitor initialStatus={fromQueryStatus ?? 'ALL'} />

      {/* 补建任务 Dialog（v2 拍板随迁新页） */}
      <Dialog open={recreateOpen} onOpenChange={(open) => !open && setRecreateOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.dispatch.recreateDialogTitle')}</DialogTitle>
            <DialogDescription>{t('admin.dispatch.recreateDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="recreate-order-id">
              {t('admin.dispatch.recreateDialogOrderLabel')}
            </Label>
            <Input
              id="recreate-order-id"
              value={recreateOrderId}
              onChange={(e) => setRecreateOrderId(e.target.value)}
              placeholder={t('admin.dispatch.recreateDialogOrderPlaceholder')}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecreateOpen(false)}>
              {t('admin.dispatch.commonCancel')}
            </Button>
            <Button
              onClick={handleRecreateSubmit}
              disabled={!recreateOrderId.trim() || recreateMutation.isPending}
            >
              {recreateMutation.isPending
                ? t('loading')
                : t('admin.dispatch.recreateDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// useSearchParams 必须包 Suspense（Next 14.2 build 要求，同 /dispatch page 先例）
export default function DispatchTaskMonitorPage() {
  const t = useTranslations('common');
  return (
    <Suspense
      fallback={
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          {t('loading')}
        </div>
      }
    >
      <TaskMonitorPageContent />
    </Suspense>
  );
}
