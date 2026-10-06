import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Geo-RAG Earth Dashboard",
  description:
    "Natural-language search over Sentinel-2 satellite imagery of the Red Sea coast.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
