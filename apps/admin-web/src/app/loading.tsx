// 批3（20261012）最小补齐：App Router 根级 loading 态（segment 切换 Suspense fallback）
// server component，无需 'use client'

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
    </div>
  );
}
