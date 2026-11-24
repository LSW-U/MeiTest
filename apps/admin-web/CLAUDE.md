# admin-web（Next.js 后台）

> 视角切换器宿主：super_admin 同一 JWT，前端切 5 视角（platform/merchant/warehouse/support/rider-mgmt），后端不感知，仅 `X-Perspective` header 审计。

## 写接口 CSRF 双提交（硬约束）

**所有 admin 写接口（POST/PATCH/PUT/DELETE）必须带 `X-CSRF-Token` header**，值取自非 httpOnly cookie `admin_csrf`，与 cookie 双提交（后端 CsrfGuard 校验 header === cookie，缺失/不匹配 → 403 E-AUTH-011）。

- 现成封装：`src/lib/api.ts` 的 mutate 方法已自动注入（读 cookie → `X-CSRF-Token`），**新代码一律走该封装，不要裸 fetch/axios**。
- GET/HEAD/OPTIONS 与登录/注册/刷新等会话前端点豁免（后端 CSRF_EXEMPT_PATHS）。
- cookie 链路：登录成功后端 set `admin_access_token`（httpOnly）+ `admin_csrf`（非 httpOnly，供 JS 读）。
