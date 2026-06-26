/**
 * Platform Dashboard 页面（视角 platform 默认首页）
 *
 * 决策依据：W-M-C-T 流程 3 W2 — platform M1 C1
 *   - 消费 GET /api/v1/admin/platform/dashboard/summary
 *   - 展示 GMV / 订单数 / 在线骑手 / 异常订单 + 仓库钻取
 *
 * MVP：
 *   - 时间范围切换 today/week/month
 *   - 简易 CSS（W4 接入 shadcn/ui Card 组件后再美化）
 *   - 后端无 token 时显示提示，不抛错（dev 体验）
 */
'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { PerspectiveGuard } from '@/components/PerspectiveGuard';
import { apiFetch as apiJson, ApiError } from '@/lib/api';
import type { components } from '@meimart/shared-types';

type DashboardSummary = components['schemas']['DashboardSummary'];
type TimeRange = 'today' | 'week' | 'month';

const RANGES: TimeRange[] = ['today', 'week', 'month'];

/** 金额格式化（USD cents → $X.XX） */
function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

/**
 * 多语言字段取值（fallback 链：当前 locale → en → 第一项 → 原值）
 *
 * shared-types 把 I18nText 推为 string（zod-to-openapi 限制），实际后端返回 JSON 对象。
 * 这里用 unknown 兜底解析。
 */
function displayName(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, string>;
    return record.en ?? record.zh ?? record.id ?? record.pt ?? Object.values(record)[0] ?? '';
  }
  return '';
}

/** 增长百分比格式化（+ / − / —） */
function formatGrowth(pct: number): string {
  if (pct === 0) return '—';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export default function PlatformDashboardPage() {
  return (
    <PerspectiveGuard require="platform">
      <DashboardInner />
    </PerspectiveGuard>
  );
}

function DashboardInner() {
  const t = useTranslations('platform');
  const [range, setRange] = useState<TimeRange>('today');
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiJson<{ success: true; data: DashboardSummary }>(
      `/admin/platform/dashboard/summary?range=${range}`,
    )
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError) {
          setError(`${e.code}: ${e.message}`);
        } else {
          setError('Network error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
          {t('dashboard.title')}
        </h1>
        <div style={{ display: 'inline-flex', gap: 4, background: 'white', padding: 4, borderRadius: 4 }}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              style={{
                padding: '6px 12px',
                border: 'none',
                background: range === r ? '#1a5dc2' : 'transparent',
                color: range === r ? 'white' : '#333',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {t(`dashboard.range.${r}`)}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            padding: 12,
            background: '#fff4f4',
            border: '1px solid #ffb4b4',
            borderRadius: 4,
            color: '#a02020',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <KpiCard label={t('dashboard.gmv')} value={data ? formatMoney(data.gmv) : '—'} growth={data?.gmvGrowthPct} />
        <KpiCard label={t('dashboard.orderCount')} value={data ? data.orderCount.toLocaleString() : '—'} growth={data?.orderCountGrowthPct} />
        <KpiCard label={t('dashboard.onlineRiders')} value={data ? data.onlineRiderCount.toString() : '—'} />
        <KpiCard label={t('dashboard.abnormalOrders')} value={data ? data.abnormalOrderCount.toString() : '—'} />
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: 16,
        }}
      >
        <Card title={t('dashboard.trendTitle')}>
          {data && data.trend.length > 0 ? (
            <TrendBars points={data.trend} />
          ) : (
            <Empty />
          )}
        </Card>
        <Card title={t('dashboard.warehouseBreakdownTitle')}>
          {data && data.warehouseBreakdown.length > 0 ? (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#888', borderBottom: '1px solid #eee' }}>
                  <th style={{ padding: '6px 4px' }}>{t('dashboard.warehouseName')}</th>
                  <th style={{ padding: '6px 4px' }}>{t('dashboard.gmv')}</th>
                  <th style={{ padding: '6px 4px' }}>{t('dashboard.abnormalCount')}</th>
                </tr>
              </thead>
              <tbody>
                {data.warehouseBreakdown.map((w) => (
                  <tr key={w.warehouseId} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '6px 4px' }}>{displayName(w.warehouseName)}</td>
                    <td style={{ padding: '6px 4px' }}>{formatMoney(w.gmv)}</td>
                    <td style={{ padding: '6px 4px' }}>{w.abnormalCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty />
          )}
        </Card>
      </section>
    </div>
  );
}

function KpiCard({ label, value, growth }: { label: string; value: string; growth?: number }) {
  const t = useTranslations('platform');
  return (
    <div
      style={{
        background: 'white',
        padding: 16,
        borderRadius: 6,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>{value}</div>
      {growth !== undefined && (
        <div
          style={{
            fontSize: 11,
            color: growth >= 0 ? '#1a7a3a' : '#a02020',
          }}
        >
          {formatGrowth(growth)} · {t('dashboard.growth')}
        </div>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        background: 'white',
        padding: 16,
        borderRadius: 6,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>{title}</h3>
      {children}
    </div>
  );
}

function TrendBars({ points }: { points: Array<{ bucket: string; gmv: number; orderCount: number }> }) {
  const maxGmv = Math.max(...points.map((p) => p.gmv), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 160 }}>
      {points.map((p) => (
        <div
          key={p.bucket}
          title={`${p.bucket}: ${formatMoney(p.gmv)} (${p.orderCount} orders)`}
          style={{
            flex: 1,
            minWidth: 2,
            height: `${(p.gmv / maxGmv) * 100}%`,
            minHeight: 2,
            background: p.gmv > 0 ? '#1a5dc2' : '#e5e5e5',
            borderRadius: '2px 2px 0 0',
          }}
        />
      ))}
    </div>
  );
}

function Empty() {
  const t = useTranslations('common');
  return <div style={{ fontSize: 13, color: '#888', padding: 12 }}>{t('noData')}</div>;
}
