import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "MaxiMail",
  description: "Maximum clarity, productivity, and speed for your inbox."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#ffffff" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="MaxiMail" />
      </head>
      <body>{children}</body>
    </html>
  );
}
