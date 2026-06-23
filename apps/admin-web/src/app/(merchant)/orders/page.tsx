'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, type Perspective } from '@/lib/api';
import type { components } from '@meimart/shared-types';

type Order = components['schemas']['Order'];

/**
 * 商家视角订单列表
 *
 * W2 阶段：
 *   - 按状态分组（待接单 / 进行中 / 已完成 / 退款）
 *   - 接单按钮（W3 联调时调 admin/orders/:id/accept）
 *   - W2 暂用 mock 数据展示骨架
 *
 * W3+ 联调：
 *   - 接真 /api/v1/admin/orders（W3 流程 C 实现商家端订单流转接口）
 *   - 接单 → CONFIRMED / 拒单 → CANCELLED
 *   - 退款审核入口（W5）
 */
const MOCK_ORDERS: Order[] = [
  {
    id: 'mock-1',
    orderNo: 'MM2026062401000001',
    userId: 'mock-user',
    warehouseId: 'mock-wh',
    status: 'PENDING_CONFIRM',
    items: [],
    totalAmount: 5800,
    deliveryFee: 500,
    discountAmount: 0,
    payableAmount: 5800,
    deliveryAddress: { name: 'Mock', phone: '+67099999999', detail: 'Dili', lat: null, lng: null },
    remark: null,
    riderId: null,
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    paidAt: null,
    createdAt: new Date().toISOString(),
    confirmedAt: null,
    pickedAt: null,
    deliveringAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
  },
];

export default function MerchantOrdersPage() {
  const t = useTranslations('order');
  const [filter, setFilter] = useState<string>('PENDING_CONFIRM');
  const [orders, setOrders] = useState<Order[]>(MOCK_ORDERS);

  // W3+：接入真 API
  // useEffect(() => {
  //   apiFetch<{ success: true; data: Order[] }>(`/admin/orders?status=${filter}`)
  //     .then((r) => setOrders(r.data));
  // }, [filter]);

  useEffect(() => {
    void apiFetch;
    void setOrders;
    void filter;
  }, [filter]);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginTop: 0, marginBottom: 16, fontSize: 24 }}>{t('list.title')}</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          'PENDING_CONFIRM',
          'CONFIRMED',
          'OUT_FOR_DELIVERY',
          'COMPLETED',
          'CANCELLED',
        ].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              padding: '6px 12px',
              background: filter === s ? '#1a5dc2' : 'white',
              color: filter === s ? 'white' : '#222',
              border: '1px solid #d5d5d5',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t(`status.${s.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.charAt(0).toUpperCase() + c.slice(1))}` as never)}
          </button>
        ))}
      </div>

      {orders.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>{t('list.empty')}</div>
      ) : (
        <table
          style={{
            width: '100%',
            background: 'white',
            borderCollapse: 'collapse',
            fontSize: 14,
          }}
        >
          <thead>
            <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5' }}>
              <Th>{t('number')}</Th>
              <Th>{t('createdAt')}</Th>
              <Th>{t('warehouse')}</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <Td>{o.orderNo}</Td>
                <Td>{new Date(o.createdAt).toLocaleString()}</Td>
                <Td>{o.warehouseId.slice(0, 8)}</Td>
                <Td>${(o.payableAmount / 100).toFixed(2)}</Td>
                <Td>{o.status}</Td>
                <Td>
                  {o.status === 'PENDING_CONFIRM' && (
                    <button
                      style={{
                        padding: '4px 10px',
                        background: '#1a5dc2',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      Accept
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: 24, fontSize: 12, color: '#888' }}>
        Perspective: <strong>{getPerspectiveLabel('merchant')}</strong>（W3 联调时接真 API）
      </p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '8px 12px' }}>{children}</td>;
}

function getPerspectiveLabel(p: Perspective): string {
  return p;
}
