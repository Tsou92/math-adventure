import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://jisuan.tsounas.cn'),
  title: '口算星球｜儿童数学练习',
  description: '专为小朋友设计的 30 道随机口算闯关练习，支持自动批改、评分和错题提示。',
  openGraph: {
    title: '口算星球｜儿童数学练习',
    description: '闯过 3 关，完成 30 道随机口算题，自动批改并收集智慧星。',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: '口算星球儿童数学练习' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '口算星球｜儿童数学练习',
    description: '闯过 3 关，完成 30 道随机口算题，自动批改并收集智慧星。',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
