/**
 * Dev 一次性脚本：给 seed admin 创建/重置一条 APPROVED 的 RiderProfile
 *
 * 背景：骑手端 app login 页的 mock-login 按钮（POST /common/auth/mock-login）
 *   默认用 seed admin(+670999999999) 签 rider token，但 DB 里该 user 没有
 *   RiderProfile 记录 → /rider/profile 报 E-RIDER-001「骑手资料不存在」。
 *   本脚本补一条 APPROVED 记录，让 mock-login 后骑手端全功能可用
 *   （getProfile / updateDuty 上线 / heartbeat / 任务可见都通）。
 *
 * 用法：pnpm --filter @meimart/api exec tsx prisma/seed-rider.dev.ts
 *
 * 幂等：已存在则强制 applicationStatus=APPROVED（re-seed reset 后 rider 表空，
 *   可重跑创建；re-seed 不 reset 时 update 分支强制复位为 APPROVED）。
 *
 * ⚠️ DEV/STAGING ONLY — prod 慎用（会创建测试骑手账号）。
 */
import { PrismaClient } from '../src/prisma/client';

const prisma = new PrismaClient();

/** 与 seed.ts 保持一致 */
const SEED_ADMIN_PHONE = '+670999999999';

async function main(): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { phone: SEED_ADMIN_PHONE } });
  if (!admin) {
    throw new Error(
      `Seed admin not found (phone=${SEED_ADMIN_PHONE}). 请先运行 \`pnpm --filter @meimart/api db:seed\`。`,
    );
  }

  // upsert：无则创建 APPROVED rider；有则强制 APPROVED（幂等，re-seed 后可重跑）
  const profile = await prisma.riderProfile.upsert({
    where: { userId: admin.id },
    create: {
      userId: admin.id,
      riderName: 'Test Rider',
      phone: admin.phone,
      vehicleType: 'MOTORCYCLE',
      vehiclePlate: 'BI-TEST001',
      idCardNumber: '0000000000',
      applicationStatus: 'APPROVED',
      // Why: 自审自（mock 测试，绕过 admin-web 审批 UI）；APPROVED 配 reviewedBy 更真实
      reviewedById: admin.id,
      reviewedAt: new Date(),
      preferredWarehouseIds: [],
    },
    update: {
      applicationStatus: 'APPROVED',
      reviewedById: admin.id,
      reviewedAt: new Date(),
    },
  });

  console.log('✅ APPROVED rider profile ready for mock-login:');
  console.log(`   userId            ${admin.id}`);
  console.log(`   riderProfileId    ${profile.id}`);
  console.log(`   phone             ${admin.phone}`);
  console.log(`   riderName         ${profile.riderName}`);
  console.log(`   applicationStatus ${profile.applicationStatus}`);
  console.log('');
  console.log('   → 骑手端 login 页点 mock-login 按钮，全功能可用');
}

main()
  .catch((e) => {
    console.error('❌ seed-rider.dev failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
