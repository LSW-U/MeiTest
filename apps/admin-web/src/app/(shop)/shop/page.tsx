/**
 * 商家视角首页 — 店铺信息编辑
 *
 * W2-W 流程 2026-06-24：MVP 单一商家，1 条 shop 预置，编辑 name/announcement/logo/phone/status
 *
 * 后端：GET /api/v1/admin/shop, PATCH /api/v1/admin/shop
 */
'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, ApiError, type ApiSuccess } from '@/lib/api';

interface Shop {
  id: string;
  name: Record<string, string>;
  announcement: Record<string, string> | null;
  logoUrl: string | null;
  phone: string;
  address: string;
  status: 'ACTIVE' | 'INACTIVE';
  lat: number;
  lng: number;
  businessHours: unknown;
}

export default function ShopPage() {
  const t = useTranslations('shop');
  const [shop, setShop] = useState<Shop | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 表单状态（编辑模式）
  const [nameEn, setNameEn] = useState('');
  const [nameZh, setNameZh] = useState('');
  const [phone, setPhone] = useState('');
  const [announcementEn, setAnnouncementEn] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  useEffect(() => {
    apiFetch<ApiSuccess<Shop>>('/admin/shop')
      .then((res) => {
        setShop(res.data);
        setNameEn(res.data.name?.en ?? '');
        setNameZh(res.data.name?.zh ?? '');
        setPhone(res.data.phone ?? '');
        setAnnouncementEn(res.data.announcement?.en ?? '');
        setStatus(res.data.status);
      })
      .catch((err: ApiError) => setError(`${err.code}: ${err.message}`));
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<ApiSuccess<Shop>>('/admin/shop', {
        method: 'PATCH',
        body: JSON.stringify({
          name: { ...shop?.name, en: nameEn, zh: nameZh },
          announcement: announcementEn
            ? { ...shop?.announcement, en: announcementEn }
            : null,
          phone,
          status,
        }),
      });
      setShop(res.data);
      setEditing(false);
    } catch (err) {
      const e = err as ApiError;
      setError(`${e.code}: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <div style={{ padding: 16, background: '#ffebee', border: '1px solid #ef9a9a', borderRadius: 4 }}>
        {error}
      </div>
    );
  }

  if (!shop) {
    return <div>{t('common.loading') !== 'common.loading' ? t('common.loading') : 'Loading...'}</div>;
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ marginBottom: 24 }}>{t('admin.shopTitle')}</h1>

      {!editing ? (
        <div
          style={{
            background: 'white',
            padding: 24,
            borderRadius: 8,
            border: '1px solid #e0e0e0',
          }}
        >
          <Field label="Name (EN)" value={shop.name?.en ?? ''} />
          <Field label="Name (ZH)" value={shop.name?.zh ?? ''} />
          <Field label="Phone" value={shop.phone} />
          <Field label="Address" value={shop.address} />
          <Field
            label="Status"
            value={shop.status === 'ACTIVE' ? '🟢 Active' : '🔴 Inactive'}
          />
          <Field label="Logo" value={shop.logoUrl ?? '—'} />
          <button
            onClick={() => setEditing(true)}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              background: '#1976d2',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Edit
          </button>
        </div>
      ) : (
        <form
          onSubmit={onSave}
          style={{
            background: 'white',
            padding: 24,
            borderRadius: 8,
            border: '1px solid #e0e0e0',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <InputField label="Name (EN)" value={nameEn} onChange={setNameEn} />
          <InputField label="Name (ZH)" value={nameZh} onChange={setNameZh} />
          <InputField label="Phone" value={phone} onChange={setPhone} />
          <InputField
            label="Announcement (EN)"
            value={announcementEn}
            onChange={setAnnouncementEn}
          />
          <label style={{ fontSize: 14 }}>
            Status:
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
              style={{ marginLeft: 8, padding: 4 }}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: '8px 16px',
                background: '#4caf50',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              style={{
                padding: '8px 16px',
                background: '#f5f5f5',
                border: '1px solid #ccc',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 12, fontSize: 14 }}>
      <div style={{ color: '#666', marginBottom: 4 }}>{label}</div>
      <div>{value}</div>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ fontSize: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
      />
    </label>
  );
}
