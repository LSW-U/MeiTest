/**
 * PageHeader — 页面标题区（标题 + 面包屑 + 操作按钮）
 *
 * 参考 medusa dashboard layout，所有 (dashboard)/ 下页面顶部统一用这个。
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumb?: BreadcrumbItem[];
  action?: ReactNode;
}

export function PageHeader({ title, description, breadcrumb, action }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="flex items-center gap-1 text-xs text-muted-foreground">
            {breadcrumb.map((item, idx) => (
              <span key={idx} className="flex items-center gap-1">
                {idx > 0 && <ChevronRight className="h-3 w-3" />}
                {item.href ? (
                  <Link href={item.href} className="hover:text-foreground">
                    {item.label}
                  </Link>
                ) : (
                  <span>{item.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}
