/**
 * 仓库视角首页 — 仓库列表
 *
 * W2-W 流程 2026-06-24：列出所有仓库（不含 coverageArea GeoJSON，列表只看基本信息）
 * 后端：GET /api/v1/admin/warehouses
 */
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, ApiError, type ApiSuccess } from '@/lib/api';

interface Warehouse {
  id: string;
  code: string;
  name: Record<string, string>;
  address: string;
  centerLat: number;
  centerLng: number;
  deliveryFee: number;
  status: 'ACTIVE' | 'INACTIVE';
}

export default function WarehouseListPage() {
  const t = useTranslations();
  const [items, setItems] = useState<Warehouse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<ApiSuccess<Warehouse[]>>('/admin/warehouses')
      .then((res) => setItems(res.data))
      .catch((err: ApiError) => setError(`${err.code}: ${err.message}`))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) {
    return (
      <div
        style={{
          padding: 16,
          background: '#ffebee',
          border: '1px solid #ef9a9a',
          borderRadius: 4,
        }}
      >
        {error}
        <p style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
          Need backend running on {process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1'}{' '}
          + valid admin token in localStorage.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <div
        style={{
          marginBottom: 16,
          padding: '12px 16px',
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: 6,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ color: '#1e3a8a', fontSize: 14 }}>
          W3-W 流程已上线新 UI：仓库列表 + 新建 + 详情（含配送范围 + 库存 + 启停）。
        </span>
        <a
          href="/warehouses"
          style={{
            color: '#1d4ed8',
            fontWeight: 600,
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          前往新 UI →
        </a>
      </div>
      <h1 style={{ marginBottom: 24 }}>
        {t('warehouse.admin.listTitle') ?? 'Warehouses'}{' '}
        <span style={{ fontSize: 12, color: '#999', fontWeight: 400 }}>(legacy)</span>
      </h1>
      <table
        style={{
          width: '100%',
          background: 'white',
          borderCollapse: 'collapse',
          border: '1px solid #e0e0e0',
          borderRadius: 8,
        }}
      >
        <thead>
          <tr style={{ background: '#f5f5f5', textAlign: 'left', fontSize: 14 }}>
            <th style={{ padding: 12 }}>Code</th>
            <th style={{ padding: 12 }}>Name (EN)</th>
            <th style={{ padding: 12 }}>Address</th>
            <th style={{ padding: 12 }}>Center (lat, lng)</th>
            <th style={{ padding: 12 }}>Delivery Fee (cents)</th>
            <th style={{ padding: 12 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((w) => (
            <tr key={w.id} style={{ borderTop: '1px solid #eee', fontSize: 14 }}>
              <td style={{ padding: 12 }}>
                <code>{w.code}</code>
              </td>
              <td style={{ padding: 12 }}>{w.name?.en ?? w.name?.zh ?? '—'}</td>
              <td style={{ padding: 12 }}>{w.address}</td>
              <td style={{ padding: 12 }}>
                {w.centerLat.toFixed(4)}, {w.centerLng.toFixed(4)}
              </td>
              <td style={{ padding: 12 }}>{w.deliveryFee}</td>
              <td style={{ padding: 12 }}>
                {w.status === 'ACTIVE' ? '🟢' : '🔴'} {w.status}
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#999' }}>
                No warehouses. Run `pnpm db:seed` to populate.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
