import type { Metadata } from 'next';
import { Outfit } from 'next/font/google';

import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-outfit',
});

export const metadata: Metadata = {
  title: 'Debug Console',
  description: 'Internal tool for troubleshooting customer applications',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={outfit.variable}>
      <body className={outfit.className}>{children}</body>
    </html>
  );
}
