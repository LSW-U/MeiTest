---
name: admin-web-preflight
description: >
  MUST USE 写完或改完 MeiMart admin-web 页面后（apps/admin-web/src/app/**）。
  也 MUST USE 当用户报 admin-web 页面崩溃/白屏/IntlError MISSING_MESSAGE/
  "unsupported type passed to use" 等运行时错误时。

  跑 3 类高频 bug 检查（都踩过坑）：
  1. t('common.xxx') 双重 namespace（useTranslations('common') 后不能再带 'common.' 前缀）
  2. use(params) 在 Next.js 14.2 不兼容（params 运行时是同步对象，React 18.3 use() 报错）
  3. 动态拼接 i18n key 和 i18n 文件实际 key 不匹配（camelCase vs 全大写）

  本 skill 是 MeiMart 项目专属（next-intl + Next.js 14.2 + React 18.3）。
---

# admin-web Preflight 检查清单

写完/改完 `apps/admin-web/src/app/**` 下任何页面后，跑这 3 个检查。每个都踩过坑导致页面崩溃。

## 检查 1：i18n 双重 namespace（最高频，5 个页面踩过）

**症状**：`IntlError: MISSING_MESSAGE: Could not resolve 'common.common.save'`

**根因**：`useTranslations('common')` 已在 common namespace 下，再调 `t('common.cancel')` 会找 `common.common.cancel`（双重）。

**检查命令**：
```bash
grep -rn "t('common\.\(cancel\|save\|status\|actions\|loading\|delete\|edit\)')" apps/admin-web/src/app/
```
命中即 bug。

**修复**：去掉 `common.` 前缀：
```tsx
// ❌ 错
const t = useTranslations('common');
t('common.cancel')  // 找 common.common.cancel

// ✅ 对
t('cancel')         // 找 common.cancel
```

**注意**：`t('admin.xxx')` / `t('w.xxx')` 是**对的**（子 namespace），不要改。只有 `t('common.xxx')` 这种顶层 key 才错。

## 检查 2：use(params) Next.js 14 兼容性

**症状**：`Error: An unsupported type was passed to use(): [object Object]`

**根因**：Next.js 14.2 + React 18.3，params 运行时是**同步对象** `{ id: 'xxx' }`，不是 Promise。`use()` 期望 Promise，收到普通对象报错。

**检查命令**：
```bash
grep -rn "use(params)\|params: Promise" apps/admin-web/src/app/
```
命中且 Next.js < 15 即 bug。

**修复**：动态路由 `[id]` 页面改同步解构：
```tsx
// ❌ 错（Next.js 15 写法，14.2 崩）
import { use } from 'react';
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
}

// ✅ 对（Next.js 14.2 兼容）
export default function Page({ params }: { params: { id: string } }) {
  const { id } = params;
}
```

**注意**：Next.js 升级到 15 后要改回 Promise 写法。升级时 grep `params: {` 翻成 `Promise<{`。

## 检查 3：动态拼接 i18n key 和文件 key 不匹配

**症状**：`IntlError: MISSING_MESSAGE: Could not resolve 'admin.riders.userStatusActive'`（实际 key 是 `userStatusACTIVE`）

**根因**：代码动态拼接 key（如 `t(\`userStatus${enum.charAt(0) + enum.slice(1).toLowerCase()}\`)` 拼出 camelCase），但 i18n 文件 key 是全大写（`userStatusACTIVE`）。

**检查命令**：
```bash
grep -rn "t(\`.*\${.*\.charAt\|t(\`.*\${.*\.toLowerCase\|t(\`.*\${.*\.toUpperCase" apps/admin-web/src/app/
```
命中即要核对：拼接结果和 i18n 文件实际 key 是否一致。

**核对方法**：用 node 查 i18n 文件实际 key：
```bash
node -e "
const k=require('./packages/shared-locales/zh/common.json');
console.log('userStatusACTIVE:', k.admin?.riders?.userStatusACTIVE === undefined ? '❌' : '✅');
console.log('userStatusActive:', k.admin?.riders?.userStatusActive === undefined ? '❌' : '✅');
"
```

**修复**：统一命名风格。推荐**直接用原 enum 值**（全大写，和 Prisma enum 一致），i18n key 也用全大写：
```tsx
// ❌ 错（camelCase 拼接，和 i18n 全大写 key 不匹配）
t(`admin.riders.userStatus${rider.userStatus.charAt(0) + rider.userStatus.slice(1).toLowerCase()}`)
// 拼出 'userStatusActive'，i18n 是 'userStatusACTIVE'

// ✅ 对（直接用原值）
t(`admin.riders.userStatus${rider.userStatus}`)
// 拼出 'userStatusACTIVE'，匹配
```

**注意**：i18n key 命名风格要统一。MeiMart 现状：
- `admin.riders.statusOffline`（camelCase）- status 用
- `admin.riders.userStatusACTIVE`（全大写）- userStatus 用

两种风格并存，拼接时要分清。新加 key 时，enum 值映射的 key **推荐全大写**（和 enum 一致，不易错）。

## 检查 4（可选）：i18n key 存在性全量校验

跑这个脚本，校验页面所有 t() key 在 i18n 文件存在：
```bash
node -e "
const fs=require('fs');
const k=require('./packages/shared-locales/zh/common.json');
// 读取页面源码，提取所有 t('...') 和 t(\`...\`) 调用
const files=['apps/admin-web/src/app/(dashboard)/riders/[id]/page.tsx'];
files.forEach(f=>{
  const src=fs.readFileSync(f,'utf8');
  const keys=[...src.matchAll(/t\(['\"\`]([^'\"\`]+)['\"\`]/g)].map(m=>m[1]);
  // 简化校验：只查静态 key，动态拼接的跳过
  keys.filter(k=>!k.includes('\${')).forEach(key=>{
    const parts=key.split('.');
    let cur=k;
    for(const p of parts){cur=cur?.[p];if(cur===undefined)break;}
    if(cur===undefined) console.log(f, '❌', key);
  });
});
"
```

## 修复后验证

```bash
pnpm --filter @meimart/admin-web typecheck  # 类型
pnpm --filter @meimart/admin-web lint        # lint
```

## 触发时机

1. 写完新 admin-web 页面后（commit 前）
2. 改完 admin-web 页面后（commit 前）
3. 用户报 admin-web 页面崩溃/白屏/IntlError/use() 报错时

## 参考历史 bug

- `[W7-ext-H-fix]` commit `10134ed`：3 个 bug 全修（5 个页面 + 5 语言 i18n）
