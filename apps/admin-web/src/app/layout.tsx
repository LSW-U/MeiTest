import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { PerspectiveSwitcher } from '@/components/PerspectiveSwitcher';

export const metadata: Metadata = {
  title: 'MeiMart Admin',
  description: 'MeiMart 后台管理控制台',
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const messages = await getMessages();

  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          margin: 0,
          padding: 0,
          background: '#f5f5f5',
          color: '#222',
        }}
      >
        <NextIntlClientProvider messages={messages}>
          <header
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 24px',
                background: 'white',
                borderBottom: '1px solid #e5e5e5',
                gap: 16,
              }}
            >
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <strong>MeiMart</strong>
                <nav style={{ display: 'flex', gap: 12, fontSize: 14 }}>
                  <a href="/shop" style={{ color: '#1976d2', textDecoration: 'none' }}>
                    Shop
                  </a>
                  <a href="/warehouse" style={{ color: '#1976d2', textDecoration: 'none' }}>
                    Warehouse
                  </a>
                  <a
                    href="/catalog/products"
                    style={{ color: '#1976d2', textDecoration: 'none' }}
                  >
                    Products
                  </a>
                </nav>
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <PerspectiveSwitcher />
                <LanguageSwitcher />
              </div>
            </header>
            <main style={{ padding: 24 }}>{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
