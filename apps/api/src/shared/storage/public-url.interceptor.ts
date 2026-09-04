/**
 * Public URL 重写拦截器（方案 B：后端响应时重写图片 URL，2026-08-29）
 *
 * 背景：DB 存的图片 URL 主机名是内部 OSS 地址（dev = http://localhost:9000），
 *   远程真机/外网用户解析不了 localhost。方案 B 在输出层统一重写：
 *   响应 JSON 里所有以 `${OSS_ENDPOINT}/${bucket}/` 开头的字符串
 *   → 替换为 `${OSS_PUBLIC_HOST}/${bucket}/`。
 *
 * 设计（方案 B 文档 §4.2）：
 *   - OSS_PUBLIC_HOST 未设置 / 等于 OSS_ENDPOINT → 直接放行（dev 零影响，开关即回滚）
 *   - 递归遍历对象/数组，只动字符串值；null / undefined / 循环引用原样保留
 *   - 端点去尾斜杠 + URL 解析拼前缀，防双斜杠
 *   - 与 storage.service 互不干扰：上传仍存内部地址，isOwnUrl 仍按内部地址校验
 *   （重写发生在响应序列化前，DB 数据零改动，可随时回滚）
 *
 * 方案：/DevAll/Obsidian/.../CI-CD/方案/图片URL与数据同步/方案B-后端响应时重写图片URL.md
 */
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';

/** 重写规则（构造时锁定）：内部前缀 → 公网前缀 */
interface RewriteRule {
  from: string;
  to: string;
}

/**
 * 从环境变量解析重写规则；返回 null 表示「关闭」（放行不重写）
 *
 * 读取：OSS_ENDPOINT（内部，默认 http://localhost:9000）、
 *       OSS_BUCKET（默认 meimart）、OSS_PUBLIC_HOST（公网）
 */
export function resolveRewriteRule(env: NodeJS.ProcessEnv = process.env): RewriteRule | null {
  const publicHost = env.OSS_PUBLIC_HOST?.trim();
  if (!publicHost) return null;

  const endpoint = stripTrailingSlash(env.OSS_ENDPOINT ?? 'http://localhost:9000');
  const target = stripTrailingSlash(publicHost);
  if (target === endpoint) return null; // 未设置语义：公网地址与内部相同 → 无需重写

  const bucket = env.OSS_BUCKET ?? 'meimart';
  return { from: `${endpoint}/${bucket}/`, to: `${target}/${bucket}/` };
}

/** 去尾斜杠（防前缀拼接出双斜杠） */
function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/** 递归重写字符串值；非容器类型直接返回，循环引用按已处理跳过 */
export function rewriteUrls(value: unknown, rule: RewriteRule, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return value.startsWith(rule.from) ? rule.to + value.slice(rule.from.length) : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    return value.map((item) => rewriteUrls(item, rule, seen));
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = rewriteUrls(v, rule, seen);
    }
    return out; // 返回浅拷贝，不动原对象（响应体可能是缓存/复用数据）
  }
  return value;
}

@Injectable()
export class PublicUrlInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PublicUrlInterceptor.name);
  private readonly rule: RewriteRule | null;

  constructor() {
    this.rule = resolveRewriteRule();
    if (this.rule) {
      this.logger.log(`图片 URL 重写已启用: ${this.rule.from} → ${this.rule.to}`);
    }
  }

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const rule = this.rule;
    if (!rule) return next.handle(); // 开关关闭：零开销放行
    return next.handle().pipe(map((data) => rewriteUrls(data, rule)));
  }
}
