import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "../tokens.css";
import "./globals.css";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display-local", display: "swap", weight: ["500", "600"] });
const body = Inter({ subsets: ["latin"], variable: "--font-body-local", display: "swap", weight: ["400", "500"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-local", display: "swap", weight: ["400", "500"] });

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
      <body className={`${display.variable} ${body.variable} ${mono.variable}`}>
        {children}
      </body>
    </html>
  );
}
