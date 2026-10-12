import Link from 'next/link';

// 批3（20261012）最小补齐：App Router 404 页（未匹配路由兜底）
// server component + 纯链接（next/link），不需要 i18n hook

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h2 className="text-lg font-semibold">404</h2>
      <Link href="/" className="text-sm text-primary underline underline-offset-4">
        Go home
      </Link>
    </div>
  );
}
