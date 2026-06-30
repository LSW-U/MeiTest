/**
 * 退款管理页 — /refunds
 *
 * 后端：GET /admin/refunds + POST /admin/refunds/:id/review
 * 视角：platform（super_admin / warehouse_staff / customer_service）
 */
'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useRefunds,
  useReviewRefund,
  type Refund,
  type RefundStatus,
} from '@/hooks/api/use-refunds';
import { formatCurrency } from '@/lib/utils';

const STATUS_FILTERS: { value: RefundStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: '全部' },
  { value: 'PENDING', label: '待审核' },
  { value: 'COMPLETED', label: '已退款' },
  { value: 'REJECTED', label: '已驳回' },
  { value: 'CANCELLED', label: '已撤回' },
];

const REASON_LABELS: Record<string, string> = {
  OUT_OF_STOCK: '缺货',
  QUALITY_ISSUE: '质量问题',
  WRONG_ITEM: '发错货',
  DELIVERY_TOO_SLOW: '配送太慢',
  CUSTOMER_CHANGE_MIND: '客户改变主意',
  OTHER: '其他',
};

export default function RefundsListPage() {
  const [statusFilter, setStatusFilter] = useState<RefundStatus | 'ALL'>('PENDING');
  const [rejectTarget, setRejectTarget] = useState<Refund | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [approveTarget, setApproveTarget] = useState<Refund | null>(null);

  const { data, isLoading, error, refetch } = useRefunds(
    statusFilter === 'ALL' ? undefined : statusFilter,
  );
  const reviewMutation = useReviewRefund();

  const items: Refund[] = data ?? [];

  function handleApproveSubmit() {
    if (!approveTarget) return;
    reviewMutation.mutate(
      { id: approveTarget.id, input: { action: 'APPROVE' } },
      { onSuccess: () => setApproveTarget(null) },
    );
  }

  function handleRejectSubmit() {
    if (!rejectTarget) return;
    reviewMutation.mutate(
      { id: rejectTarget.id, input: { action: 'REJECT', reviewNote: rejectNote } },
      {
        onSuccess: () => {
          setRejectTarget(null);
          setRejectNote('');
        },
      },
    );
  }

  const columns: Column<Refund>[] = [
    {
      key: 'amount',
      header: '退款金额',
      render: (row) => (
        <span className="font-mono text-sm font-bold text-destructive">
          {formatCurrency(row.amount)}
        </span>
      ),
    },
    {
      key: 'reason',
      header: '原因',
      render: (row) => (
        <div className="space-y-0.5">
          <span className="text-sm font-medium">{REASON_LABELS[row.reason] ?? row.reason}</span>
          {row.reasonDetail && (
            <p className="text-xs text-muted-foreground">{row.reasonDetail}</p>
          )}
        </div>
      ),
    },
    {
      key: 'refundMethod',
      header: '退款方式',
      render: (row) => (
        <span className="text-muted-foreground">{row.refundMethod}</span>
      ),
    },
    {
      key: 'createdAt',
      header: '申请时间',
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      render: (row) => <StatusBadge status={row.status} label={row.status} />,
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        row.status === 'PENDING' ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => setApproveTarget(row)}
              disabled={reviewMutation.isPending}
            >
              通过
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setRejectTarget(row);
                setRejectNote('');
              }}
            >
              驳回
            </Button>
          </div>
        ) : row.transactionId ? (
          <span className="font-mono text-xs text-muted-foreground">
            {row.transactionId.slice(0, 20)}...
          </span>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="退款管理" description="客户退款申请审核 + 退款进度跟踪" />

      <Tabs
        value={statusFilter}
        onValueChange={(v) => setStatusFilter(v as RefundStatus | 'ALL')}
      >
        <TabsList>
          {STATUS_FILTERS.map((s) => (
            <TabsTrigger key={s.value} value={s.value}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">加载中...</div>
      ) : items.length === 0 ? (
        <EmptyState
          title={`无${statusFilter === 'ALL' ? '' : statusFilter === 'PENDING' ? '待审核' : statusFilter === 'COMPLETED' ? '已退款' : statusFilter === 'REJECTED' ? '已驳回' : '已撤回'}退款`}
          description="退款申请将在此显示"
        />
      ) : (
        <DataTable data={items} columns={columns} />
      )}

      {/* 通过确认 */}
      <Dialog open={!!approveTarget} onOpenChange={(open) => !open && setApproveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认退款通过</DialogTitle>
            <DialogDescription>
              退款金额 {approveTarget ? formatCurrency(approveTarget.amount) : ''}将通过
              {approveTarget?.refundMethod} 原路退回客户。通过后系统自动完成 mock 退款。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>
              取消
            </Button>
            <Button onClick={handleApproveSubmit} disabled={reviewMutation.isPending}>
              {reviewMutation.isPending ? '提交中...' : '确认退款'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 驳回 */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>驳回退款申请</DialogTitle>
            <DialogDescription>
              {rejectTarget ? formatCurrency(rejectTarget.amount) : ''} — 请填写驳回原因
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-note">驳回原因</Label>
            <Textarea
              id="reject-note"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="例：商品无质量问题，不符合退款条件"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectSubmit}
              disabled={!rejectNote.trim() || reviewMutation.isPending}
            >
              确认驳回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
