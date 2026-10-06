import type { Metadata } from "next"

import "./globals.css"

export const metadata: Metadata = {
  title: {
    default: "Arciin Account (demo)",
    template: "%s · Arciin Account (demo)",
  },
  description: "Vendor demo of the licence server. Customer accounts live at arciin.com/account.",
  robots: { index: false, follow: false },
  icons: {
    icon: "/favicon.svg",
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- this is the
            root layout, so the stylesheet is loaded once for the whole app, which is
            exactly what the rule asks for. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  )
}
