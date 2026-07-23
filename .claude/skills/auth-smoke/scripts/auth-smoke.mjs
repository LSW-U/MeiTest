#!/usr/bin/env node
/**
 * MeiMart 认证链路冒烟（node 服务器侧快速验证）
 *
 * 验证范围（不改状态的诊断，跑完会 logout 清理）：
 *   F1  CORS 跨域预检：Allow-Headers 含 X-CSRF-Token + Allow-Credentials
 *   F3  CSRF Guard：header 缺失/不匹配 → 403 E-AUTH-011 + traceId + i18nKey
 *   cookie 链路：3 cookie 落地 + 属性（httpOnly/sameSite/path）
 *   认证链路：正常 mutate 到业务层（CORS+CSRF+认证 全通）
 *   logout 幂等：200 + 清 cookie
 *
 * 用法：node .claude/skills/auth-smoke/scripts/auth-smoke.mjs [API_BASE_URL]
 * 前置：API 已起（默认 http://localhost:3000），docker 全栈在跑。
 * 退出码：全绿 0，任一 ❌ 为 1（CI 友好）。
 *
 * 边界：本脚本验「服务器侧配置 + 业务链路」。浏览器对预检的放行决策是确定性的
 *      （服务器 Allow-Headers 含 X-CSRF-Token → 浏览器必放行），故服务器侧通过 = 浏览器侧通过。
 *      唯一测不出的是「真浏览器是否存了跨域 cookie」，需用浏览器版 checklist（见 SKILL.md）端到端验。
 */
const API = (process.argv[2] ?? 'http://localhost:3000') + '/api/v1';
const ORIGIN = 'http://localhost:3001'; // 模拟 admin-web 跨域 Origin

const results = [];
const expect = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

function parseSetCookies(setCookies) {
  const map = {};
  for (const c of setCookies) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    map[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return map;
}

try {
  // ① mock-login + cookie 落地
  console.log('\n[① mock-login + cookie]');
  const login = await fetch(`${API}/common/auth/mock-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ role: 'SUPER_ADMIN', deviceType: 'admin_web' }),
  });
  if (!login.ok) throw new Error(`mock-login 失败: ${login.status}`);
  const sc = login.headers.getSetCookie();
  const map = parseSetCookies(sc);
  const cookieHeader = `admin_access_token=${map.admin_access_token}; admin_refresh_token=${map.admin_refresh_token}; admin_csrf=${map.admin_csrf}`;
  const accessCookieStr = sc.find((c) => c.startsWith('admin_access_token')) ?? '';
  const csrfCookieStr = sc.find((c) => c.startsWith('admin_csrf')) ?? '';
  expect('3 cookie 全落地', Object.keys(map).length >= 3, `keys: ${Object.keys(map).join(',')}`);
  expect('admin_access_token HttpOnly', /HttpOnly/i.test(accessCookieStr));
  expect('admin_csrf 非 httpOnly（JS 可读）', !/HttpOnly/i.test(csrfCookieStr));
  expect('cookie SameSite=Lax', /SameSite=Lax/i.test(accessCookieStr));
  expect('cookie Path=/api/v1', /Path=\/api\/v1/i.test(accessCookieStr));

  // ② F1：OPTIONS 跨域预检
  console.log('\n[② F1 CORS 预检]');
  const pf = await fetch(`${API}/admin/inventory/stocks`, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'PATCH',
      'Access-Control-Request-Headers': 'x-csrf-token, content-type, x-perspective',
    },
  });
  const allowHeaders = pf.headers.get('access-control-allow-headers') ?? '';
  const allowCreds = pf.headers.get('access-control-allow-credentials');
  const allowOrigin = pf.headers.get('access-control-allow-origin');
  expect('F1 预检 Allow-Headers 含 X-CSRF-Token', /x-csrf-token/i.test(allowHeaders), allowHeaders);
  expect('F1 Allow-Credentials: true', allowCreds === 'true', String(allowCreds));
  expect('F1 Allow-Origin 非 *（配合 credentials）', !!allowOrigin && allowOrigin !== '*', String(allowOrigin));

  // ③ 正常 PATCH（CSRF + 认证链路）
  console.log('\n[③ 正常 mutate（CSRF+认证）]');
  const patch = await fetch(`${API}/admin/inventory/stocks?warehouseId=smoke`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': map.admin_csrf,
      'X-Perspective': 'platform',
      'Accept-Language': 'en',
      Cookie: cookieHeader,
      Origin: ORIGIN,
    },
    body: JSON.stringify({ skuId: '00000000-0000-0000-0000-000000000000', deltaQty: 0 }),
  });
  await patch.text();
  expect('正常 mutate 到业务层（非 403/401）', patch.status !== 403 && patch.status !== 401, `status=${patch.status}`);

  // ④ F3：CSRF 拦截（header 缺失 / 不匹配）→ 403 + traceId + i18nKey
  console.log('\n[④ F3 CSRF 拦截]');
  const noHeader = await fetch(`${API}/admin/inventory/stocks?warehouseId=smoke`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader, Origin: ORIGIN },
    body: JSON.stringify({ skuId: '00000000-0000-0000-0000-000000000000', deltaQty: 0 }),
  });
  const noHeaderBody = await noHeader.text();
  expect('F3 header 缺失 → 403 E-AUTH-011', noHeader.status === 403 && /E-AUTH-011/.test(noHeaderBody), `status=${noHeader.status}`);
  expect('F3 响应含 traceId', /traceId/.test(noHeaderBody));
  expect('F3 响应含 i18nKey', /i18nKey/.test(noHeaderBody));

  const mismatch = await fetch(`${API}/admin/inventory/stocks?warehouseId=smoke`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'wrong-value', Cookie: cookieHeader, Origin: ORIGIN },
    body: JSON.stringify({ skuId: '00000000-0000-0000-0000-000000000000', deltaQty: 0 }),
  });
  await mismatch.text();
  expect('F3 header 不匹配 → 403', mismatch.status === 403, `status=${mismatch.status}`);

  // ⑤ logout 幂等
  console.log('\n[⑤ logout]');
  const logout = await fetch(`${API}/common/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': map.admin_csrf, Cookie: cookieHeader, Origin: ORIGIN },
    body: '{}',
  });
  const logoutCookies = logout.headers.getSetCookie();
  expect('logout 200 + 清 3 cookie', logout.status === 200 && logoutCookies.length >= 3, `status=${logout.status}`);

  // 小结
  const failed = results.filter((r) => !r.ok);
  console.log(`\n========== 冒烟小结 ${failed.length === 0 ? '✅ 全绿' : '❌ ' + failed.length + ' 项失败'} ==========`);
  process.exit(failed.length === 0 ? 0 : 1);
} catch (e) {
  console.error('\n💥 冒烟异常（检查 API 是否在 ' + API + ' 跑）:', e.message);
  process.exit(1);
}
