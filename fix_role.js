// 修复历史数据：把已审核通过的骑手 user.role 更新为 RIDER
const { PrismaClient } = require('./apps/api/src/prisma/client');
const db = new PrismaClient();

async function main() {
  // 查所有 applicationStatus=APPROVED 但 user.role != RIDER 的
  const approved = await db.riderProfile.findMany({
    where: { applicationStatus: 'APPROVED' },
    include: { user: { select: { id: true, phone: true, role: true, name: true } } },
  });

  console.log('已审核通过的骑手：');
  for (const rp of approved) {
    console.log(`  ${rp.user.phone} | user.role=${rp.user.role} | riderProfile.applicationStatus=${rp.applicationStatus}`);
    if (rp.user.role !== 'RIDER') {
      await db.user.update({
        where: { id: rp.userId },
        data: { role: 'RIDER' },
      });
      console.log(`  ✅ 已修复：${rp.user.phone} role → RIDER`);
    }
  }

  // 验证重登
  console.log('\n验证重登...');
  const http = require('http');
  const res = await new Promise((resolve) => {
    const data = JSON.stringify({ phone: '+670****3456', password: 'Test1234' });
    const req = http.request('http://localhost:3000/api/v1/common/auth/login-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let b = '';
      res.on('data', (c) => b += c);
      res.on('end', () => resolve(JSON.parse(b)));
    });
    req.write(data);
    req.end();
  });
  console.log('重登 role:', res.data?.role, res.data?.role === 'rider' ? '✅ PASS' : '❌ FAIL');

  await db.$disconnect();
}

main().catch(e => console.error(e));
