/**
 * 订单详情页 — /orders/[id]
 *
 * 后端：GET /admin/orders/:id（W4 已实现）
 *   - 含 items + events（OrderEvent 时间线）
 */
'use client';

import { use, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/common/status-badge';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useOrderDetail, useCancelOrder } from '@/hooks/api/use-orders';
import { formatCurrency } from '@/lib/utils';
import type { I18nText } from '@/hooks/api/use-products';

/** 多语言字段取值（fallback 链） */
function displayName(value: I18nText | unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, string>;
    return record.zh ?? record.en ?? record.id ?? record.pt ?? Object.values(record)[0] ?? '';
  }
  return '';
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('platform');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const { data: order, isLoading, error, refetch } = useOrderDetail(id);
  const cancelMutation = useCancelOrder();

  function handleCancel() {
    cancelMutation.mutate(
      { id, reason: cancelReason },
      {
        onSuccess: () => {
          setCancelOpen(false);
          setCancelReason('');
          refetch();
        },
      },
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 text-center text-muted-foreground">加载中...</div>
    );
  }

  if (error || !order) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={`${t('menu.orders')} #${id.slice(0, 8)}`} />
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={`${order.orderNo}`}
        description={`下单时间：${new Date(order.createdAt).toLocaleString()}`}
        action={
          order.status !== 'CANCELLED' && order.status !== 'COMPLETED' ? (
            <Button variant="destructive" onClick={() => setCancelOpen(true)}>
              取消订单
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">状态</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge status={order.status} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">支付</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <StatusBadge status={order.paymentStatus} />
              <p className="text-xs text-muted-foreground">{order.paymentMethod}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">应付金额</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="font-mono text-lg font-bold">
              {formatCurrency(order.payableAmount)}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">支付时间</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-xs text-muted-foreground">
              {order.paidAt ? new Date(order.paidAt).toLocaleString() : '—'}
            </span>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>订单商品（{order.items.length}）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {order.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{displayName(item.productName)}</p>
                    <p className="text-xs text-muted-foreground">
                      {displayName(item.skuName)} × {item.quantity}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-xs text-muted-foreground">
                      {formatCurrency(item.unitPrice)} × {item.quantity}
                    </p>
                    <p className="font-mono text-sm font-bold">
                      {formatCurrency(item.subtotal)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>金额明细</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">商品总额</span>
                <span className="font-mono">{formatCurrency(order.totalAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">配送费</span>
                <span className="font-mono">{formatCurrency(order.deliveryFee)}</span>
              </div>
              {order.discountAmount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>优惠</span>
                  <span className="font-mono">-{formatCurrency(order.discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-2 font-bold">
                <span>应付</span>
                <span className="font-mono">{formatCurrency(order.payableAmount)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {order.cancelReason && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">取消原因</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{order.cancelReason}</p>
            {order.cancelledAt && (
              <p className="mt-2 text-xs text-muted-foreground">
                取消时间：{new Date(order.cancelledAt).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>取消订单 {order.orderNo}</DialogTitle>
            <DialogDescription>
              请填写取消原因（管理员取消，将通知客户）
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">取消原因</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="例：商品缺货，请联系客服"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              返回
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={!cancelReason.trim() || cancelMutation.isPending}
            >
              {cancelMutation.isPending ? '提交中...' : '确认取消'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
