import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AppAnnouncementModal from "./components/AppAnnouncementModal";
import LanguageProvider from "./components/LanguageProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OnePiece Vault",
  description: "OnePiece Vault - Gestisci la tua collezione di carte",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "OnePiece Vault",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="it"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {process.env.R2_PUBLIC_BASE_URL ? <link rel="preconnect" href={process.env.R2_PUBLIC_BASE_URL} /> : null}
      </head>
<body className="min-h-dvh onepiece-bg onepiece-vibrant">
  <LanguageProvider>
    {children}
    <AppAnnouncementModal />
  </LanguageProvider>
</body>
    </html>
  );
}
