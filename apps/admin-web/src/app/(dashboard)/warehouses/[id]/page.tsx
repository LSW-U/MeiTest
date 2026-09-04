/**
 * 仓库详情页 — /warehouses/[id]
 *
 * 后端：
 *   - GET/PATCH /admin/warehouses/:id（UpdateWarehouseRequest 全可选 partial，批 B P2-1）
 *   - PATCH /admin/warehouses/:id/coverage（配送范围）
 *   - GET/PATCH /admin/inventory/stocks、GET /admin/inventory/logs
 *
 * 批 C1（Codex设计 §3）：页面级 Tabs 改为多卡分区 7 卡：
 *   基本信息 / 营业时间 / 配送费 / 覆盖区地图 / 库存 / 在编人员 / 负载占位。
 * 各编辑卡独立 dirty/save；库存为独立 query，失败不影响整页（§3.9）。
 * 启停随基本信息一起保存（拍板 4-A），页头只读 StatusBadge。
 */
'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/common/status-badge';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { WarehouseBasicCard, type WarehouseBasicSaveInput } from '@/components/warehouse/warehouse-basic-card';
import { WarehouseOperatingHoursCard } from '@/components/warehouse/warehouse-operating-hours-card';
import { WarehouseFeeCard, type WarehouseFeeSaveInput } from '@/components/warehouse/warehouse-fee-card';
import { WarehouseCoverageCard } from '@/components/warehouse/warehouse-coverage-card';
import { WarehouseInventoryCard } from '@/components/warehouse/warehouse-inventory-card';
import { WarehouseStaffCard } from '@/components/warehouse/warehouse-staff-card';
import { WarehouseLoadPlaceholderCard } from '@/components/warehouse/warehouse-load-placeholder-card';
import {
  useWarehouse,
  useUpdateWarehouse,
  useUpdateWarehouseCoverage,
  type OperatingHours,
  type UpdateCoverageInput,
} from '@/hooks/api/use-warehouses';
import { useToast } from '@/hooks/use-toast';

export default function WarehouseDetailPage() {
  const t = useTranslations('common');
  const params = useParams<{ id: string }>();
  const id = params.id;

  const warehouseQ = useWarehouse(id);
  const updateMutation = useUpdateWarehouse();
  const coverageMutation = useUpdateWarehouseCoverage();
  const { toast } = useToast();

  if (warehouseQ.isLoading) return <LoadingSkeleton lines={8} />;
  if (warehouseQ.error)
    return <ErrorState message={warehouseQ.error.message} onRetry={() => warehouseQ.refetch()} />;
  if (!warehouseQ.data?.data) return null;

  const warehouse = warehouseQ.data.data;

  // 审查 P2-1：save* 失败路径必须 rethrow——单侧吞错会让子卡误判成功而 setTouched(false)，
  // 触发表单重置回服务端值，用户编辑全部丢失（feedback-delete-dialog-mutate-async 同族）
  const saveBasic = async (input: WarehouseBasicSaveInput) => {
    try {
      await updateMutation.mutateAsync({ id, input });
      toast({ title: t('w.form.saved'), variant: 'success' });
    } catch (e) {
      toast({
        title: t('w.form.saveFailed', { message: (e as Error).message }),
        variant: 'destructive',
      });
      throw e;
    }
  };

  const saveHours = async (input: { operatingHours: OperatingHours }) => {
    try {
      await updateMutation.mutateAsync({ id, input });
      toast({ title: t('w.form.saved'), variant: 'success' });
    } catch (e) {
      toast({
        title: t('w.form.saveFailed', { message: (e as Error).message }),
        variant: 'destructive',
      });
      throw e;
    }
  };

  const saveFees = async (input: WarehouseFeeSaveInput) => {
    try {
      await updateMutation.mutateAsync({ id, input });
      toast({ title: t('w.form.saved'), variant: 'success' });
    } catch (e) {
      toast({
        title: t('w.form.saveFailed', { message: (e as Error).message }),
        variant: 'destructive',
      });
      throw e;
    }
  };

  const saveCoverage = async (input: UpdateCoverageInput) => {
    try {
      await coverageMutation.mutateAsync({ id, input });
      toast({ title: t('w.warehouses.coverageSaved'), variant: 'success' });
    } catch (e) {
      toast({
        title: t('w.form.saveFailed', { message: (e as Error).message }),
        variant: 'destructive',
      });
      throw e;
    }
  };

  return (
    <>
      <PageHeader
        title={`${warehouse.code} · ${warehouse.name?.en ?? warehouse.name?.zh ?? warehouse.id}`}
        breadcrumb={[
          { label: t('w.warehouses.title'), href: '/warehouses' },
          { label: warehouse.code },
        ]}
        action={
          <StatusBadge
            status={warehouse.isActive ? 'ACTIVE' : 'INACTIVE'}
            label={
              warehouse.isActive
                ? t('w.warehouses.filterStatusActive')
                : t('w.warehouses.filterStatusInactive')
            }
          />
        }
      />

      {/* 多卡分区（§3.1）：xl 两栏，地图/库存 full */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="xl:col-span-2">
          <WarehouseBasicCard
            warehouse={warehouse}
            saving={updateMutation.isPending}
            error={updateMutation.error?.message ?? null}
            onSave={saveBasic}
          />
        </div>

        <WarehouseOperatingHoursCard
          warehouse={warehouse}
          saving={updateMutation.isPending}
          error={updateMutation.error?.message ?? null}
          onSave={saveHours}
        />

        <WarehouseFeeCard
          warehouse={warehouse}
          saving={updateMutation.isPending}
          error={updateMutation.error?.message ?? null}
          onSave={saveFees}
        />

        <div className="xl:col-span-2">
          <WarehouseCoverageCard
            warehouseId={id}
            center={{ lat: warehouse.centerLat, lng: warehouse.centerLng }}
            coverageArea={warehouse.coverageArea ?? null}
            saving={coverageMutation.isPending}
            error={coverageMutation.error?.message ?? null}
            onSave={saveCoverage}
          />
        </div>

        <div className="xl:col-span-2">
          <WarehouseInventoryCard warehouseId={id} />
        </div>

        <WarehouseStaffCard staffList={warehouse.staffList} />

        <WarehouseLoadPlaceholderCard warehouseId={id} />
      </div>
    </>
  );
}
