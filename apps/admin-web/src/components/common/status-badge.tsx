/**
 * StatusBadge — 状态色卡（订单/商品/仓库/支付状态）
 *
 * 用法：
 *   <StatusBadge status="ACTIVE" />
 *   <StatusBadge status="PENDING_CONFIRM" />
 *
 * 内置常见状态色映射；未匹配的 fallback 到 secondary。
 */
import { Badge } from '@/components/ui/badge';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'info' | 'outline'> = {
  // 商品
  ACTIVE: 'success',
  INACTIVE: 'secondary',
  OUT_OF_STOCK: 'destructive',
  // 用户状态（W7-feature 客户管理）
  SUSPENDED: 'warning',
  DELETED: 'destructive',
  // 订单
  PENDING_CONFIRM: 'warning',
  PENDING_PAYMENT: 'warning',
  CONFIRMED: 'info',
  PREPARING: 'info',
  DELIVERING: 'info',
  DELIVERED: 'success',
  DELIVERED_PAID: 'success',
  DELIVERED_UNPAID: 'destructive',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
  REFUNDED: 'secondary',
  // 仓库/通用启停
  ENABLED: 'success',
  DISABLED: 'secondary',
  // 支付
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'destructive',
  REFUND_PENDING: 'warning',
  // 骑手入驻
  APPROVED: 'success',
  REJECTED: 'destructive',
};

interface StatusBadgeProps {
  status: string | undefined | null;
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const variant = STATUS_VARIANT[status] ?? 'outline';
  return <Badge variant={variant}>{label ?? status}</Badge>;
}
