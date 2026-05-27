import type { Metadata, Viewport } from 'next'
import { Inter, Crimson_Pro } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { ClerkProvider } from '@clerk/nextjs'
import { ThemeProvider } from '@/components/theme-provider'
import './globals.css'

const inter = Inter({ 
  subsets: ["latin"],
  variable: "--font-inter"
});

const crimsonPro = Crimson_Pro({ 
  subsets: ["latin"],
  variable: "--font-crimson"
});

export const metadata: Metadata = {
  title: 'EVA - Emotional Awareness Companion',
  description: 'Your calm, understanding companion for emotional wellness and mindful conversations',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/favicon.ico',
        type: 'image/x-icon',
      },
      {
        url: '/eva_logo.svg',
        type: 'image/svg+xml',
      },
      {
        url: '/eva_logo.png',
        type: 'image/png',
      },
    ],
    apple: '/eva_logo.png',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f3f7' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1a2e' }
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${inter.variable} ${crimsonPro.variable} bg-background`} suppressHydrationWarning>
        <body className="font-sans antialiased">
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
            {process.env.NODE_ENV === 'production' && <Analytics />}
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
