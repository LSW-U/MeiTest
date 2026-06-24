/**
 * 商品视角首页 — 商品列表（含上下架按钮）
 *
 * W2-W 流程 2026-06-24：MVP 不分页，列表 + 状态切换
 * 后端：GET /api/v1/admin/products, PATCH /api/v1/admin/products/:id/status
 */
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, ApiError, type ApiSuccess } from '@/lib/api';

interface Product {
  id: string;
  name: Record<string, string>;
  mainImage: string;
  status: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK';
  priceMin: number;
  salesCount: number;
}

export default function ProductsListPage() {
  const t = useTranslations();
  const [items, setItems] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    apiFetch<ApiSuccess<Product[]>>('/admin/products')
      .then((res) => setItems(res.data))
      .catch((err: ApiError) => setError(`${err.code}: ${err.message}`))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  async function toggleStatus(p: Product) {
    const next = p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await apiFetch<ApiSuccess<Product>>(`/admin/products/${p.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      load();
    } catch (err) {
      const e = err as ApiError;
      setError(`${e.code}: ${e.message}`);
    }
  }

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
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <h1 style={{ marginBottom: 24 }}>{t('catalog.admin.productsTitle') ?? 'Products'}</h1>
      <table
        style={{
          width: '100%',
          background: 'white',
          borderCollapse: 'collapse',
          border: '1px solid #e0e0e0',
        }}
      >
        <thead>
          <tr style={{ background: '#f5f5f5', textAlign: 'left', fontSize: 14 }}>
            <th style={{ padding: 12 }}>Image</th>
            <th style={{ padding: 12 }}>Name (EN)</th>
            <th style={{ padding: 12 }}>Name (ZH)</th>
            <th style={{ padding: 12 }}>Min Price (cents)</th>
            <th style={{ padding: 12 }}>Sales</th>
            <th style={{ padding: 12 }}>Status</th>
            <th style={{ padding: 12 }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} style={{ borderTop: '1px solid #eee', fontSize: 14 }}>
              <td style={{ padding: 12 }}>
                <img
                  src={p.mainImage}
                  alt=""
                  style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </td>
              <td style={{ padding: 12 }}>{p.name?.en ?? '—'}</td>
              <td style={{ padding: 12 }}>{p.name?.zh ?? '—'}</td>
              <td style={{ padding: 12 }}>{p.priceMin}</td>
              <td style={{ padding: 12 }}>{p.salesCount}</td>
              <td style={{ padding: 12 }}>{p.status}</td>
              <td style={{ padding: 12 }}>
                <button
                  onClick={() => toggleStatus(p)}
                  disabled={p.status === 'OUT_OF_STOCK'}
                  style={{
                    padding: '4px 8px',
                    background:
                      p.status === 'ACTIVE' ? '#ff9800' : '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  {p.status === 'ACTIVE' ? '下架' : '上架'}
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#999' }}>
                No products.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
