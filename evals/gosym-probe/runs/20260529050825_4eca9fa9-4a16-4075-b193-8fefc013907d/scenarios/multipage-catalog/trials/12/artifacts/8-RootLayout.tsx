src/layouts/RootLayout.tsx [39 lines]
     1|import { Helmet } from '@dr.pogodin/react-helmet';
     2|import { type ReactElement } from 'react';
     3|import { ScrollRestoration } from 'react-router-dom';
     4|
     5|import Footer from '@/layouts/parts/Footer';
     6|import Header from '@/layouts/parts/Header';
     7|import Website from '@/layouts/Website';
     8|
     9|/**
    10| * Root layout component that wraps all pages with consistent header and footer.
    11| *
    12| * To customize the header or footer, directly edit the Header.tsx and Footer.tsx
    13| * files in the layouts/parts directory.
    14| *
    15| * Site-wide <title> and <meta> live in the <Helmet> below. Individual pages can
    16| * override them by rendering their own <Helmet> — last-mounted wins.
    17| */
    18|interface RootLayoutProps {
    19|  children: ReactElement;
    20|}
    21|
    22|export default function RootLayout({ children }: RootLayoutProps) {
    23|  return (
    24|    <Website>
    25|      <Helmet>
    26|        <title>Artisan Goods Co. — Handcrafted with Care</title>
    27|        <meta
    28|          name="description"
    29|          content="Discover handmade pottery, textiles, woodwork, and jewelry from independent artisans. Each piece crafted with intention."
    30|        />
    31|      </Helmet>
    32|      <ScrollRestoration />
    33|      <Header />
    34|      {children}
    35|      <Footer />
    36|    </Website>
    37|  );
    38|}
    39|