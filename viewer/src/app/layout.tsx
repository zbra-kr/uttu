import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'UTTU · b.cave 패션 인텔리전스',
  description: 'b.cave 무신사 데이터 분석 도구',
  icons: {
    icon: [
      { url: '/images/uttu/png/icon/uttu-icon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/images/uttu/png/icon/uttu-icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/images/uttu/png/icon/uttu-icon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/images/uttu/png/icon/uttu-icon-64.png', sizes: '64x64', type: 'image/png' },
    ],
    apple: { url: '/images/uttu/png/icon/uttu-icon-512.png', type: 'image/png' },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
