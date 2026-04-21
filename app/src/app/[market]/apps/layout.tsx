import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Apps - Airo Builder",
  description: "Manage your apps",
};

export default function AppsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
