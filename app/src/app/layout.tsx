import type { Metadata } from "next";
import AuthProvider from "@/components/providers/AuthProvider";
import FullStoryProvider from "@/components/providers/FullStoryProvider";
import "@/styles/globals.scss";

import { makeLayout } from '@godaddy/gasket-next/layout';
import gasket from '../../gasket';

export const metadata: Metadata = {
  title: "Airo App Builder",
  description: "Airo App Builder",
};

const PresentationLayout = makeLayout(gasket);

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <PresentationLayout>
      <FullStoryProvider>
        <AuthProvider>
          {children}
        </AuthProvider>
      </FullStoryProvider>
    </PresentationLayout>
  )
}
