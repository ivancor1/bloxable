import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { APP_NAME } from "@/lib/config";
import "./globals.css";

// DESIGN.md — the light system is set in Inter (+ JetBrains Mono for code),
// matching the reference UI's verified font stack.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jbmono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: APP_NAME,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="h-full">{children}</body>
    </html>
  );
}
