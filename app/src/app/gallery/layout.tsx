import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gallery - Airo App Builder",
  description: "Explore app templates and examples",
};

export default function GalleryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
