import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Commander - Airo Builder",
  description: "Build and customize your app with AI assistance",
};

export default function CommanderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
