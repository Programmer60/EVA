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
  title: {
    default: 'EVA | Emotional Awareness AI Companion',
    template: '%s | EVA',
  },
  description: 'EVA is a next-generation AI companion designed with emotional intelligence, dynamic memory, and voice interaction. Experience a truly empathetic virtual assistant.',
  keywords: ['AI companion', 'emotional AI', 'virtual assistant', 'mental wellness AI', 'empathetic chatbot', 'voice AI', 'Next.js AI app'],
  authors: [{ name: 'EVA Developer' }],
  creator: 'EVA Developer',
  publisher: 'EVA',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://eva-ai.vercel.app', // Update this if you add a custom domain!
    siteName: 'EVA AI Companion',
    title: 'EVA | Emotionally Aware Virtual Assistant',
    description: 'Experience an AI companion that truly understands. EVA tracks conversational state, emotional undertones, and relationship growth over time.',
    images: [
      {
        url: '/eva_logo.png', // Fallback to logo if no specific OG image is made
        width: 1200,
        height: 630,
        alt: 'EVA AI Companion Logo',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'EVA | Emotional Awareness AI Companion',
    description: 'An AI companion that listens, remembers, and cares.',
    images: ['/eva_logo.png'],
  },
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
