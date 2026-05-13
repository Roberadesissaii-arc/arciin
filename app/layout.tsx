import type { Metadata } from "next"
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

export const metadata: Metadata = {
  title: "Arciin",
  description: "Your server, your control.",
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
      <body className="relative min-h-full bg-[#08080d]">
        <AppAmbientBackground className="fixed inset-0 z-0" />
        <div className="relative z-10 min-h-full">
          <AppProviders>{children}</AppProviders>
        </div>
      </body>
    </html>
  )
}
