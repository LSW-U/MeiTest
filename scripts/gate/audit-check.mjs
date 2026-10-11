// P1-9：pnpm audit 结果 × allowlist 过滤门禁（复刻前端仓 MeiMart1.0 scripts/gate/audit-check.mjs，commit 974a157）。
// 用法：node scripts/gate/audit-check.mjs <audit.json> <audit-allowlist.json>
// 语义对齐前端仓（存量记账不拦截 / 新增拦截）：
//   - audit 中 advisory 不在 allowlist → exit 1（新增漏洞，必须处理或记账）
//   - allowlist 中 entry 未命中任何 advisory → 仅警告（上游已消减，应删 entry）
import fs from 'node:fs';

const [auditPath, allowlistPath] = process.argv.slice(2);
if (!auditPath || !allowlistPath) {
  console.error('usage: node scripts/gate/audit-check.mjs <audit.json> <audit-allowlist.json>');
  process.exit(2);
}

let audit;
try {
  const raw = fs.readFileSync(auditPath, 'utf8');
  audit = JSON.parse(raw);
} catch (err) {
  // 上游 `pnpm audit ... || true` 在网络故障/非 JSON 输出时可能产出空或坏文件，
  // 此处必须显式 fail 而非裸 crash（报错形态指向「audit 结果不可读」而非栈追踪）
  console.error(`audit json unreadable/empty: ${auditPath} (${err.message})`);
  process.exit(3);
}
const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));

// key 形态 = 包名@advisory-id::GHSA 编号（对齐 audit-allowlist.json 的 entries[].key）
const keyOf = (a) => `${a.module_name}@${a.id}::${(a.url || '').split('/').pop()}`;

const advisories = Object.values(audit.advisories || {});
const allowed = new Set((allowlist.entries || []).map((e) => e.key));

const violations = [];
const seen = new Set();
for (const a of advisories) {
  const k = keyOf(a);
  seen.add(k);
  if (!allowed.has(k)) {
    violations.push(`${k} [${a.severity}] ${a.title || ''}`);
  }
}

// 过期 entry（上游已消减）→ 提醒清理，不拦截
for (const k of allowed) {
  if (!seen.has(k)) {
    console.warn(`[stale] allowlist entry not in audit (consider removing): ${k}`);
  }
}

if (violations.length > 0) {
  console.error(`pnpm audit: ${violations.length} advisory(ies) not in allowlist:`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(`pnpm audit: ${advisories.length} advisory(ies), all covered by allowlist (${allowed.size} entries).`);
