import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Develop - Airo App Builder",
  description: "Build and customize your app with AI assistance",
};

export default function DevelopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
