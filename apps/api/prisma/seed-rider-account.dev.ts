/**
 * Dev 一次性脚本：创建「纯 RIDER 角色」测试账号（密码登录用，避开 mock-login/SUPER_ADMIN）
 *
 * 背景：骑手端 App 密码登录 +67099999999（SUPER_ADMIN 种子账号）时，
 *   后端按 role 推断 deviceType=admin_web → 种 admin cookie → 后续请求触发 CSRF 403
 *   （App 显示「网络异常」）。本脚本创建 role=RIDER 的独立账号：
 *   - 密码登录 → deviceType 推断为 rider_app → 不种 admin cookie → 无 CSRF 问题
 *   - 手机号独立于 seed.ts 全部账号（admin +67099999999 / customer +67088888888），
 *     避免 upsert 误改 seed 账号角色（批B e2e 污染教训）
 *
 * 用法：pnpm --filter @meimart/api exec tsx prisma/seed-rider-account.dev.ts
 *
 * 幂等：同手机号已存在则重置密码为 RIDER_PASSWORD 并强制 ACTIVE/APPROVED。
 *
 * ⚠️ DEV/STAGING ONLY — prod 慎用（会创建测试骑手账号）。
 */
import { PrismaClient } from '../src/prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** 纯骑手测试账号（与 seed.ts 的 customer 账号 +67088888888 区分，密码强度符合 OWASP ≥8 位）
 *  ⚠️ 2026-09-02 批B修复：原用 +67088888888（= seed customer 手机号），脚本 upsert 会把
 *     seed customer 的 role 改成 RIDER，污染 e2e-admin-notification 的 ALL_CUSTOMERS
 *     群发验证（customer2 拉不到通知）。改用独立号码 +67077777777，不再触碰 seed 账号。 */
const RIDER_PHONE = '+67077777777';
const RIDER_PASSWORD = 'rider12345';

async function main(): Promise<void> {
  const passwordHash = bcrypt.hashSync(RIDER_PASSWORD, 12);

  // upsert 用户：role=RIDER、status=ACTIVE
  const user = await prisma.user.upsert({
    where: { phone: RIDER_PHONE },
    create: {
      phone: RIDER_PHONE,
      password: passwordHash,
      name: 'Test Rider',
      role: 'RIDER',
      status: 'ACTIVE',
      phoneVerified: true,
    },
    update: {
      password: passwordHash,
      role: 'RIDER',
      status: 'ACTIVE',
    },
  });

  // upsert 骑手资料：APPROVED
  await prisma.riderProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      riderName: 'Test Rider',
      phone: user.phone,
      vehicleType: 'MOTORCYCLE',
      vehiclePlate: 'BI-TEST002',
      idCardNumber: '0000000000',
      applicationStatus: 'APPROVED',
      reviewedById: user.id,
      reviewedAt: new Date(),
      preferredWarehouseIds: [],
    },
    update: {
      applicationStatus: 'APPROVED',
      reviewedById: user.id,
      reviewedAt: new Date(),
    },
  });

  console.log('✅ 纯 RIDER 测试账号就绪:');
  console.log('   userId   ' + user.id);
  console.log('   phone    ' + RIDER_PHONE);
  console.log('   password ' + RIDER_PASSWORD);
  console.log('   role     ' + user.role + ' (status=' + user.status + ')');
  console.log('');
  console.log('   → 骑手 App 用该账号密码登录，不踩 CSRF（rider_app 不种 admin cookie）');
}

main()
  .catch((e) => {
    console.error('❌ seed-rider-account failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
