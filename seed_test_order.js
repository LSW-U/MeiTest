// 用 Prisma 直接更新订单状态 + 创建 DeliveryTask，造骑手测试数据
const { PrismaClient } = require('./apps/api/src/prisma/client');
const db = new PrismaClient();

const ORDER_ID = '1acda8d8-2cbe-47c5-bfa6-68fbd4faca6e';
const RIDER_USER_ID = '4f6cd0a2-afb7-46be-9606-18195165c8a1';

async function main() {
  // 1. 更新订单状态到 OUT_FOR_DELIVERY
  const order = await db.order.update({
    where: { id: ORDER_ID },
    data: {
      status: 'OUT_FOR_DELIVERY',
      confirmedAt: new Date(),
      pickedAt: new Date(),
      deliveringAt: new Date(),
    },
  });
  console.log('1. 订单状态:', order.status, order.orderNo);
  console.log('   warehouseId:', order.warehouseId);

  // 2. 查骑手 profile
  const riderProfile = await db.riderProfile.findUnique({ where: { userId: RIDER_USER_ID } });
  if (!riderProfile) {
    console.error('骑手 profile 不存在');
    process.exit(1);
  }
  console.log('2. 骑手:', riderProfile.id, riderProfile.applicationStatus);

  // 3. 查仓库地址（取货地址）
  const warehouse = await db.warehouse.findUnique({ where: { id: order.warehouseId } });
  console.log('3. 仓库:', warehouse.id, warehouse.name, warehouse.address);

  // 4. 创建 DeliveryTask（PENDING_ASSIGN 状态，骑手可抢）
  // 先删旧的（如果存在）
  await db.deliveryTask.deleteMany({ where: { orderId: ORDER_ID } });

  const task = await db.deliveryTask.create({
    data: {
      orderId: ORDER_ID,
      riderId: null,  // null = 待抢
      warehouseId: order.warehouseId,
      status: 'PENDING_ASSIGN',
      pickupAddress: warehouse.address || 'Warehouse pickup',
      pickupLat: warehouse.lat || -8.5569,
      pickupLng: warehouse.lng || 125.5603,
      dropoffAddress: 'Customer delivery address',
      dropoffLat: -8.5568,
      dropoffLng: 125.56,
      assignedAt: null,  // 未分配
    },
  });
  console.log('4. 创建任务:', task.id, task.status);

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
