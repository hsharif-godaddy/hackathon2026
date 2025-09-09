import type { Metadata } from "next";
import AuthProvider from "@/components/providers/AuthProvider";
import "./globals.scss";

export const metadata: Metadata = {
  title: "Airo App Builder",
  description: "Airo App Builder",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link href="//img6.wsimg.com/ux-assets/favicon/manifest.json" rel="manifest"/>
        <link rel="apple-touch-icon" sizes="57x57" href="//img6.wsimg.com/ux-assets/favicon/apple-icon-57x57.png"/>
        <link rel="apple-touch-icon" sizes="60x60" href="//img6.wsimg.com/ux-assets/favicon/apple-icon-60x60.png"/>
        <link rel="apple-touch-icon" sizes="72x72" href="//img6.wsimg.com/ux-assets/favicon/apple-icon-72x72.png"/>
        <link rel="apple-touch-icon" sizes="76x76" href="//img6.wsimg.com/ux-assets/favicon/apple-icon-76x76.png"/>
        <link rel="apple-touch-icon" sizes="114x114" href="//img6.wsimg.com/ux-assets/favicon/apple-icon-114x114.png"/>
        <link rel="apple-touch-icon" sizes="120x120" href="//img6.wsimg.com/ux-assets/favicon/apple-icon-120x120.png"/>
        <link rel="apple-touch-icon" sizes="144x144" href="//img6.wsimg.com/ux-assets/favicon/apple-icon-144x144.png"/>
        <link rel="apple-touch-icon" sizes="152x152" href="//img6.wsimg.com/ux-assets/favicon/apple-icon-152x152.png"/>
        <link rel="apple-touch-icon" sizes="180x180" href="//img6.wsimg.com/ux-assets/favicon/apple-icon-180x180.png"/>
        <link rel="icon" type="image/png" sizes="192x192" href="//img6.wsimg.com/ux-assets/favicon/android-icon-192x192.png"/>
        <link rel="icon" type="image/png" sizes="16x16" href="//img6.wsimg.com/ux-assets/favicon/favicon-16x16.png"/>
        <link rel="icon" type="image/png" sizes="32x32" href="//img6.wsimg.com/ux-assets/favicon/favicon-32x32.png"/>
        <link rel="icon" type="image/png" sizes="96x96" href="//img6.wsimg.com/ux-assets/favicon/favicon-96x96.png"/>
        <link rel="mask-icon" href="//img6.wsimg.com/ux-assets/favicon/safari-pinned-tab.svg" color="#52c4cb"/>
        <meta name="msapplication-TileColor" content="#111111"/>
        <meta name="msapplication-TileImage" content="//img6.wsimg.com/ux-assets/favicon/ms-icon-144x144.png"/>
        <meta name="msapplication-config" content="//img6.wsimg.com/ux-assets/favicon/browserconfig.xml"/>
        <meta name="theme-color" content="#111"/>
        <link rel="dns-prefetch" href="//img6.wsimg.com/"/>
        <link rel="preconnect" href="//img6.wsimg.com/"/>
      </head>
      <body className="antialiased">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
