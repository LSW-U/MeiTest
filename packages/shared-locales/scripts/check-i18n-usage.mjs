#!/usr/bin/env node
/**
 * i18n 静态校验 — 防「key 放错文件/namespace」复发（批E 教训：菜单 key 写进
 * common.json 顶层 menu，typecheck/单测全绿，靠浏览器 console 60 条
 * MISSING_MESSAGE 才暴露；i18n 修正审查报告 💭1，2026-09-05）
 *
 * 原理：扫描目标 app src 下的翻译 key 字面量，对照 shared-locales messages
 * bundle（文件名 = namespace，见 index.ts）静态解析，key 不存在即报错——
 * 把 next-intl 运行时才报的 MISSING_MESSAGE 提前到命令行。
 *
 * 扫描模式：
 *   1. const t = useTranslations('ns') / getTranslations('ns') 绑定 +
 *      t('key') 字面量调用 → 按 ns 解析
 *   2. labelKey: 'key'（sidebar 等菜单配置字段）→ 对本文件出现的任一 ns
 *      解析，任一命中即通过
 *
 * 不做静态解析的调用（t(var) / 模板串）计 skipped，不判失败——避免误报。
 *
 * 用法：node scripts/check-i18n-usage.mjs [target-src-dir]
 *   默认 target = ../../apps/admin-web/src（相对本包）
 * 退出码：0 = 全部可解析；1 = 存在 MISSING key
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['en', 'zh', 'id', 'pt', 'tet'];
const MODULES = fs
  .readdirSync(path.join(PKG_ROOT, 'en'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

/** 构建某语言的 bundle：{ common: {...}, platform: {...}, ... }（与 index.ts 同构） */
function buildBundle(locale) {
  const bundle = {};
  for (const m of MODULES) {
    bundle[m] = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, locale, `${m}.json`), 'utf8'));
  }
  return bundle;
}

const bundles = Object.fromEntries(LOCALES.map((l) => [l, buildBundle(l)]));

/** key 按 a.b.c 逐层下钻；返回是否全部 5 语言可解析到非 undefined 值 */
function resolves(keyPath) {
  return LOCALES.every((l) => {
    let cur = bundles[l];
    for (const seg of keyPath.split('.')) {
      if (cur === null || typeof cur !== 'object' || !(seg in cur)) return false;
      cur = cur[seg];
    }
    return cur !== undefined;
  });
}

/** 收集文件内容中的翻译 key 候选，返回 { checked: [{key,line}], skipped: number } */
function scanFile(content, relPath) {
  const lines = content.split('\n');

  // 1) ns 绑定：const t = useTranslations('ns')（getTranslations 同型）
  const nsBindings = []; // { varName, ns }
  const reBind =
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const line of lines) {
    let m;
    while ((m = reBind.exec(line)) !== null) nsBindings.push({ varName: m[1], ns: m[2] });
  }

  const checked = [];
  let skipped = 0;

  // 2) 已知 t 变量的字面量调用：t('key')
  if (nsBindings.length > 0) {
    const varNames = [...new Set(nsBindings.map((b) => b.varName))];
    const reCall = new RegExp(`\\b(${varNames.join('|')})\\(\\s*['"]([^'"]+)['"]`, 'g');
    const reNonLiteral = new RegExp(`\\b(${varNames.join('|')})\\(\\s*[^'"\`]`, 'g');
    lines.forEach((line, i) => {
      let m;
      while ((m = reCall.exec(line)) !== null) {
        const { ns } = nsBindings.find((b) => b.varName === m[1]);
        checked.push({ key: `${ns}.${m[2]}`, line: i + 1 });
      }
      // 非字面量/模板串调用计 skipped
      let s;
      while ((s = reNonLiteral.exec(line)) !== null) skipped += 1;
    });
  }

  // 3) labelKey: 'key'（菜单/路由配置字段）：对本文件任一 ns 解析
  const fileNses = [...new Set(nsBindings.map((b) => b.ns))];
  const reLabel = /\blabelKey\s*:\s*['"]([^'"]+)['"]/g;
  lines.forEach((line, i) => {
    let m;
    while ((m = reLabel.exec(line)) !== null) {
      checked.push({ key: m[1], line: i + 1, labelKeyAnyNs: fileNses });
    }
  });

  return { checked, skipped };
}

// ---- main ----
const target = path.resolve(
  process.argv[2] ?? path.join(PKG_ROOT, '..', '..', 'apps', 'admin-web', 'src'),
);

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(target);
const missing = [];
let skippedTotal = 0;
let checkedTotal = 0;

for (const f of files) {
  const rel = path.relative(target, f);
  const { checked, skipped } = scanFile(fs.readFileSync(f, 'utf8'), rel);
  skippedTotal += skipped;
  for (const c of checked) {
    checkedTotal += 1;
    const ok = c.labelKeyAnyNs
      ? c.labelKeyAnyNs.some((ns) => resolves(`${ns}.${c.key}`))
      : resolves(c.key);
    if (!ok) missing.push(`${rel}:${c.line}  key="${c.key}"`);
  }
}

console.log(`扫描 ${files.length} 个 ts/tsx 文件（${target}）`);
console.log(`  已解析 key 调用: ${checkedTotal}`);
console.log(`  跳过（非字面量）: ${skippedTotal}`);
if (missing.length === 0) {
  console.log('✅ 全部翻译 key 在 5 语言 bundle 中可解析');
  process.exit(0);
}
console.log(`❌ ${missing.length} 个 key 无法解析（放错文件/namespace 或缺失）:`);
missing.forEach((m) => console.log('   ' + m));
process.exit(1);
