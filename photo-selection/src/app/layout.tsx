import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Geist } from "next/font/google";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "Kalaatma Photo Selection",
    template: "%s · Kalaatma Photo Selection",
  },
  description: "Galeri online untuk memilih foto yang akan diedit oleh Kalaatma Pictures.",
};

export const viewport: Viewport = {
  themeColor: "#fafaf8",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className={`${geistSans.variable} ${cormorant.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
