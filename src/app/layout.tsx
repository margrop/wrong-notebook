import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/providers";
import { getAppTimeZone } from "@/lib/config";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

export const dynamic = 'force-dynamic';

const geistSans = localFont({
  src: './fonts/Geist-Variable.woff2',
  variable: "--font-geist-sans",
  weight: '100 900',
  display: 'swap',
});

const geistMono = localFont({
  src: './fonts/GeistMono-Variable.woff2',
  variable: "--font-geist-mono",
  weight: '100 900',
  display: 'swap',
});

export const viewport: Viewport = {
  themeColor: '#4f46e5',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

// 浏览器标题由各页面通过 usePageTitle 设置，这里的 <title> 只作首屏默认值；
// 不放进 metadata，避免 Next 流式输出的 metadata 覆盖页面设置的标题
export const metadata: Metadata = {
  description: "基于AI的智能错题管理系统，帮助学生高效整理、分析和复习错题",
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '智能错题本',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: '/icons/icon.png',
    apple: '/icons/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>AI智能错题本</title>
        {/* 首屏绘制前按本地缓存的主题偏好设置 dark 类，避免深色模式下先闪现浅色页面 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning={true}
      >
        <Providers timeZone={getAppTimeZone()}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
