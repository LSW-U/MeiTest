---
name: auth-smoke
description: >
  MUST USE 改完 MeiMart 认证相关代码后（apps/api/src/main.ts 的 CORS allowedHeaders /
  cookie-helper / csrf.guard / jwt.strategy / auth.controller / auth.module /
  audit.interceptor，或 admin-web/src/lib/api.ts 的 CSRF 注入）。

  也 MUST USE 当用户报：admin-web 写操作浏览器 console 报 "blocked by CORS policy" /
  写操作 403 E-AUTH-011 / 登录后 cookie 没落地 / 登录后立刻被踢 / 审计记录缺 deviceType。

  验证 5 条链路：F1 CORS 跨域预检 / F3 CSRF Guard 响应形状（traceId+i18nKey）/
  cookie 落地属性 / 认证业务链路 / logout 幂等。

  本 skill 是 MeiMart 项目专属（NestJS + httpOnly cookie + CSRF 双重提交）。
  提供两种用法：① node 服务器侧快速验证（5s，CI 友好）② 浏览器端到端 checklist。
---

# 认证链路冒烟（auth-smoke）

改完认证相关代码后，跑冒烟确认 5 条链路没断。W7-ext-H 系列修过 F1-F5，这套冒烟就是它们的验收基线。

## 快速用法：node 服务器侧（推荐，5 秒）

服务在跑时，直接跑固化脚本（验服务器侧配置 + 业务链路 + 退出码）：

```bash
node .claude/skills/auth-smoke/scripts/auth-smoke.mjs
# 或指定 API 地址：node .claude/skills/auth-smoke/scripts/auth-smoke.mjs http://staging-api:3000
```

**它验什么**（全绿退出码 0）：
- F1：OPTIONS 预检响应 `Allow-Headers` 含 `X-CSRF-Token` + `Allow-Credentials: true` + `Allow-Origin` 非 `*`
- F3：CSRF header 缺失 / 不匹配 → `403 E-AUTH-011` + 响应体含 `traceId` + `i18nKey`
- cookie：3 个 cookie 落地 + `admin_access_token` HttpOnly + `admin_csrf` 非 HttpOnly + SameSite=Lax + Path=/api/v1
- 认证链路：正常 mutate 到业务层（非 403/401）
- logout：200 + 清 3 cookie

**边界**：服务器侧通过 = 浏览器侧通过（预检放行决策是确定性的）。唯一测不出的是「真浏览器是否存了跨域 cookie」，需用下面的浏览器 checklist 端到端验。

## 完整用法：浏览器端到端 checklist

node 脚本测不出真实浏览器行为时（如 cookie 存储决策、UI 流），用浏览器跑：

### 准备
- API 跑 **localhost:3000**，admin-web 跑 **localhost:3001**（next dev 在 3000 被占时自动 +1）
- **确认跨域**（同域测不出 CORS）

### ① 登录 + cookie 落地
浏览器开 `localhost:3001/login`，DevTools Console：
```js
const res = await fetch('http://localhost:3000/api/v1/common/auth/mock-login', {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ role: 'SUPER_ADMIN', deviceType: 'admin_web' }),
});
console.log('login:', res.status);
```
DevTools → Application → Cookies → `localhost:3000`，确认 3 个 cookie：`admin_access_token`(HttpOnly✓) / `admin_refresh_token`(HttpOnly✓) / `admin_csrf`(HttpOnly✗)。

### ② F1 核心：跨域 mutate 预检
```js
const csrf = document.cookie.match(/admin_csrf=([^;]+)/)?.[1];
const res = await fetch('http://localhost:3000/api/v1/admin/inventory/stocks?warehouseId=smoke', {
  method: 'PATCH', credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'X-Perspective': 'platform', 'Accept-Language': 'en' },
  body: JSON.stringify({ skuId: '00000000-0000-0000-0000-000000000000', deltaQty: 0 }),
});
console.log('PATCH:', res.status, await res.text());
```
DevTools → Network → 找 PATCH，前面应有 **OPTIONS**，响应头 `Access-Control-Allow-Headers` **含 X-CSRF-Token**。返回 400/422 = F1 通过（到业务层）；浏览器 console 报 CORS blocked = F1 没生效。

### ③ F3：CSRF 拦截 + traceId（⚠️ 关键坑见下）
```js
// cookie 在，但 header 缺失 → 应 403
const res = await fetch('http://localhost:3000/api/v1/admin/inventory/stocks?warehouseId=smoke', {
  method: 'PATCH', credentials: 'include',
  headers: { 'Content-Type': 'application/json' },  // 不带 X-CSRF-Token
  body: JSON.stringify({ skuId: '00000000-0000-0000-0000-000000000000', deltaQty: 0 }),
});
console.log('CSRF 拦截:', res.status, await res.text());  // 403 + traceId + i18nKey
```

### ④ 审计记录
```bash
docker compose exec postgres psql -U meimart -d meimart \
  -c 'SELECT action, "deviceType", perspective, "userId" FROM "AuditLog" ORDER BY "createdAt" DESC LIMIT 3;'
```
确认 `deviceType=ADMIN_WEB` + `perspective=platform`。

### ⑤ logout
admin-web 点 logout 按钮，确认 3 cookie 清空 + 跳 /login。

## ⚠️ 双重提交 CSRF 测试陷阱（必读）

CSRF 双重提交只校验 **header === cookie**。**测拦截时只能改一个，不能两个都改**：

```js
// ❌ 错：cookie 和 header 都设 tampered → 相等 → 校验通过 → 测不出拦截
document.cookie = 'admin_csrf=tampered; path=/api/v1';
fetch(..., { headers: { 'X-CSRF-Token': 'tampered' } })  // 400 不是 403

// ✅ 对：cookie 在，header 缺失（模拟攻击者读不到 cookie 构造不出 header）
fetch(..., { headers: { 'Content-Type': 'application/json' } })  // 不带 X-CSRF-Token → 403

// ✅ 对：header 用与 cookie 不同的值
fetch(..., { headers: { 'X-CSRF-Token': 'wrong-value' } })  // 403
```

## 闭环判据

| 链路 | 通过标志 | 失败 → 查 |
|---|---|---|
| F1 CORS | OPTIONS 响应 Allow-Headers 含 X-CSRF-Token | main.ts allowedHeaders + **API 是否重启** |
| F3 CSRF | header 缺失/不匹配 → 403 + traceId + i18nKey | csrf.guard 是否 APP_GUARD + AllExceptionsFilter |
| cookie | 3 cookie 落地 + 属性正确 | setAuthCookiesForDevice + CORS Allow-Credentials |
| 认证 | 正常 mutate 到业务层 | jwt.strategy 双通道 + cookie-parser |
| logout | 200 + 清 cookie + family 撤销 | auth.controller logout + revokeFamily |

## 常见症状 → 根因

| 症状 | 根因 |
|---|---|
| 浏览器报 `blocked by CORS policy` | F1：allowedHeaders 漏 X-CSRF-Token，**或 API 改了 main.ts 没重启** |
| 写操作 403 但无 traceId | F3：CSRF 异常没走 AllExceptionsFilter（middleware 而非 guard） |
| 登录成功但下个请求 401 | cookie 没跨域 set：Allow-Credentials 缺失，或 secure/sameSite 在跨域下不对 |
| 审计缺 deviceType | jwt.strategy 没注入 request.user（双通道 extractor 坏） |
| curl 测都正常，浏览器写操作挂 | CORS 预检是浏览器行为，curl 直接发不预检 → 必须用浏览器或 node OPTIONS 预检 |

## 触发时机

1. 改 `main.ts` 的 CORS 配置后
2. 改 `csrf.guard` / `cookie-helper` / `jwt.strategy` / `auth.controller` 后
3. 改 `admin-web/src/lib/api.ts` 的 CSRF 注入后
4. 用户报 admin-web 写操作失败 / 登录后异常时
5. 认证相关 commit 上线前

## 参考历史

- W7-ext-H 审查（2026-07-23）发现 F1-F5，commit `bc22997` 修复
- F1 教训：CORS allowedHeaders 漏配只在浏览器跨域写操作才暴露，curl/单测都测不出
- F3 教训：CSRF 用 middleware 实现时异常绕过 AllExceptionsFilter 缺 traceId，改 Guard 才闭环
