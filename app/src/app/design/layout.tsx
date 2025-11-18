import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Design - Airo App Builder",
  description: "Design system and components",
};

export default function DesignLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
