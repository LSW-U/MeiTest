'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * 仓库视角订单/拣货列表
 *
 * W2 阶段：骨架（mock 数据）
 * W3 联调：
 *   - 显示已 CONFIRMED 订单的拣货任务（待拣货 → 已拣货）
 *   - 拣货完成后调 /api/v1/admin/orders/:id/pick（W3 流程 C 实现）
 *   - 与 dispatch 模块衔接（拣货完成 → 进待派送池）
 */
interface PickTask {
  id: string;
  orderNo: string;
  warehouseCode: string;
  itemCount: number;
  status: 'PENDING_PICK' | 'PICKED';
  createdAt: string;
}

const MOCK_TASKS: PickTask[] = [
  {
    id: 'task-1',
    orderNo: 'MM2026062401000001',
    warehouseCode: 'W01',
    itemCount: 3,
    status: 'PENDING_PICK',
    createdAt: new Date().toISOString(),
  },
];

export default function WarehouseOrdersPage() {
  const t = useTranslations('order');
  const [tasks, setTasks] = useState<PickTask[]>(MOCK_TASKS);

  function onPick(id: string) {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === id ? { ...task, status: 'PICKED' as const } : task,
      ),
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginTop: 0, marginBottom: 16, fontSize: 24 }}>
        Warehouse Picking
      </h1>

      {tasks.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>
          {t('list.empty')}
        </div>
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
              <th style={thStyle}>Order No</th>
              <th style={thStyle}>Warehouse</th>
              <th style={thStyle}>Items</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Action</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={tdStyle}>{task.orderNo}</td>
                <td style={tdStyle}>{task.warehouseCode}</td>
                <td style={tdStyle}>{task.itemCount}</td>
                <td style={tdStyle}>{task.status}</td>
                <td style={tdStyle}>
                  {task.status === 'PENDING_PICK' && (
                    <button
                      onClick={() => onPick(task.id)}
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
                      Mark Picked
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: 24, fontSize: 12, color: '#888' }}>
        W3 联调时接 /api/v1/admin/orders/:id/pick
      </p>
    </div>
  );
}

const thStyle = { padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600 };
const tdStyle = { padding: '8px 12px' };
