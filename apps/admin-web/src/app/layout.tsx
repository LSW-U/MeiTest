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
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 16,
              padding: '12px 24px',
              background: 'white',
              borderBottom: '1px solid #e5e5e5',
            }}
          >
            <PerspectiveSwitcher />
            <LanguageSwitcher />
          </header>
          <main>{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
