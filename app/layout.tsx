import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://jisuan.tsounas.cn'),
  title: '数学星球',
  description:
    '为孩子提供加减法、乘法与珠心算练习，支持轻松练习、计时挑战、错题复习和家长学习报告。',
  openGraph: {
    title: '数学星球',
    description:
      '每天一点，慢慢变厉害。自主选题、分步提示、错题巩固，陪孩子积累数学能力。',
    images: [
      { url: '/og.png', width: 1200, height: 630, alt: '数学星球儿童数学练习' },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '数学星球',
    description:
      '每天一点，慢慢变厉害。自主选题、分步提示、错题巩固，陪孩子积累数学能力。',
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
