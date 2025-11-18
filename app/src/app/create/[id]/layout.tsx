import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Creating App - Airo App Builder",
  description: "Setting up your app environment",
};

export default function CreateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
