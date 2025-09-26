import type { Metadata } from "next";
import { withGasketData } from '@gasket/nextjs/layout';
import { makeLayout } from '@godaddy/gasket-next/layout';
import AuthProvider from "@/components/providers/AuthProvider";
import FullStoryProvider from "@/components/providers/FullStoryProvider";

import "@/styles/globals.scss";

import gasket from '../../gasket';

export const metadata: Metadata = {
  title: "Airo App Builder",
  description: "Airo App Builder",
};

const PresentationLayout = withGasketData(gasket)(makeLayout(gasket));

async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <PresentationLayout>
      <FullStoryProvider>
        <AuthProvider>{children}</AuthProvider>
      </FullStoryProvider>
    </PresentationLayout>
  )
}

export default RootLayout;
