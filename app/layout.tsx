import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import { Geist, Geist_Mono } from "next/font/google"

import { AppAmbientBackground } from "@/components/app-shell/app-ambient-background"
import { AppProviders } from "@/components/providers/app-providers"

import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const spaceGrotesk = localFont({
  src: "../public/fonts/space-grotesk/SpaceGrotesk-VariableFont_wght.ttf",
  variable: "--font-space-grotesk",
  display: "swap",
})

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#09090b",
}

export const metadata: Metadata = {
  title: "Arciin",
  description: "Your server, your control.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  formatDetection: {
    telephone: false,
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`dark ${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} h-full`}
    >
      <body className="relative min-h-full bg-[#09090b]">
        <AppAmbientBackground className="fixed inset-0 z-0" />
        <div className="relative z-10 min-h-full">
          <AppProviders>{children}</AppProviders>
        </div>
      </body>
    </html>
  )
}
