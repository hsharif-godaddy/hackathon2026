import type { Metadata } from 'next';

import './globals.css';

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
