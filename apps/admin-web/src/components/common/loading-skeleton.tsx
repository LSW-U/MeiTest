/**
 * LoadingSkeleton — 加载骨架屏
 *
 * 用法：
 *   <LoadingSkeleton lines={8} />
 */
import { Skeleton } from '@/components/ui/skeleton';

interface LoadingSkeletonProps {
  lines?: number;
}

export function LoadingSkeleton({ lines = 5 }: LoadingSkeletonProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
