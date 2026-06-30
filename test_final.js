// 联调最终验证：场景 5, 10-14
const http = require('http');
const { PrismaClient } = require('./apps/api/src/prisma/client');
const db = new PrismaClient();

const BASE = 'http://localhost:3000';
const RIDER_USER_ID = '4f6cd0a2-afb7-46be-9606-18195165c8a1';

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(BASE + path, { method, headers }, (res) => {
      let b = '';
      res.on('data', (chunk) => b += chunk);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // ========== 场景 5: 重登 role=rider ==========
  console.log('=== 场景 5: 重登 role=rider ===');
  let res = await request('POST', '/api/v1/common/auth/login-password', { phone: '+670****3456', password: 'Test1234' });
  const role5 = res.data?.role;
  console.log('  role:', role5, role5 === 'rider' ? '✅ PASS' : '❌ FAIL (还是 customer)');

  // 拿 rider token
  res = await request('POST', '/api/v1/common/auth/mock-login', { role: 'rider', deviceType: 'rider_app', userId: RIDER_USER_ID });
  const rt = res.data.accessToken;

  // 上班
  await request('PATCH', '/api/v1/rider/duty', { status: 'ONLINE', acceptMode: 'GRAB' }, rt);

  // 重置测试 task
  await db.deliveryTask.updateMany({
    where: { status: { in: ['ASSIGNED', 'PICKED_UP', 'DELIVERED', 'FAILED'] } },
    data: { status: 'PENDING_ASSIGN', riderId: null, assignedAt: null, pickedUpAt: null, deliveredAt: null },
  });
  await db.order.updateMany({
    where: { status: { in: ['PICKED', 'DELIVERED_PAID', 'DELIVERED_UNPAID', 'DELIVERED'] } },
    data: { status: 'OUT_FOR_DELIVERY', riderId: null },
  });

  // ========== 场景 9: 抢单大厅 ==========
  res = await request('GET', '/api/v1/rider/dispatch/tasks', null, rt);
  const tasks = res.data?.items || [];
  console.log('\n=== 场景 9: 抢单大厅 ===');
  console.log('  任务数:', tasks.length, tasks.length > 0 ? '✅' : '⚠️');

  if (tasks.length > 0) {
    const tid = tasks[0].id;

    // ========== 场景 10: 接单 ==========
    res = await request('POST', '/api/v1/rider/dispatch/tasks/' + tid + '/accept', null, rt);
    console.log('\n=== 场景 10: 接单 ===');
    console.log('  ', res.success ? '✅ ' + res.data.status : '❌ ' + (res.error?.message || JSON.stringify(res)));

    // ========== 场景 11: 取货 ==========
    res = await request('POST', '/api/v1/rider/dispatch/tasks/' + tid + '/pickup', { taskId: tid, note: 'picked up' }, rt);
    console.log('\n=== 场景 11: 取货 ===');
    console.log('  ', res.success ? '✅ ' + res.data.status : '❌ ' + (res.error?.message || JSON.stringify(res)));

    // ========== 场景 12: 送达 ==========
    res = await request('POST', '/api/v1/rider/dispatch/tasks/' + tid + '/deliver', { taskId: tid, collectedAmount: 1600, note: 'delivered' }, rt);
    console.log('\n=== 场景 12: 送达 ===');
    console.log('  ', res.success ? '✅ ' + res.data.status : '❌ ' + (res.error?.message || JSON.stringify(res)));

    // ========== 场景 13: 报异常（需新任务）==========
    res = await request('GET', '/api/v1/rider/dispatch/tasks', null, rt);
    const remaining = res.data?.items || [];
    if (remaining.length > 0) {
      const tid2 = remaining[0].id;
      await request('POST', '/api/v1/rider/dispatch/tasks/' + tid2 + '/accept', null, rt);
      res = await request('POST', '/api/v1/rider/dispatch/tasks/' + tid2 + '/report-issue', { reason: 'CUSTOMER_UNREACHABLE', note: 'no answer' }, rt);
      console.log('\n=== 场景 13: 报异常 ===');
      console.log('  ', res.success ? '✅ ' + res.data.status : '❌ ' + (res.error?.message || JSON.stringify(res)));
    } else {
      console.log('\n=== 场景 13: 报异常 ===');
      console.log('  ⏭️ 无剩余任务，跳过');
    }
  }

  // ========== 场景 14: 下班 ==========
  res = await request('PATCH', '/api/v1/rider/duty', { status: 'OFFLINE' }, rt);
  console.log('\n=== 场景 14: 下班 ===');
  console.log('  ', res.success ? '✅ ' + res.data.status : '❌ ' + (res.error?.message || JSON.stringify(res)));

  console.log('\n场景 15-17 (WS): 需骑手 App 启动');
  await db.$disconnect();
}

main().catch(e => console.error(e));
