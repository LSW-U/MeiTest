import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * 批3（20261012）安全头最小补齐（dashboard 已验证不依赖 iframe 嵌入/外链 referrer）：
 * - X-Frame-Options DENY + frame-ancestors：防点击劫持（admin 后台标准做法）
 * - HSTS：生产 HTTPS 下强制 1 年（includeSubDomains 不加——同域可能有非 HTTPS 子域服务，拿不准不收紧）
 * - X-Content-Type-Options：禁 MIME sniffing
 * - Referrer-Policy：同源保留、跨域降级为 origin
 * - CSP 完整策略不加：dashboard 含内联样式与脚本依赖，收紧必破；仅加无破坏面的
 *   frame-ancestors 'none'（与 X-Frame-Options 等效的现代替代，老浏览器走 XFO 兜底）
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
