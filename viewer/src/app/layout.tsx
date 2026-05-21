import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'UTTU · b.cave 패션 인텔리전스',
  description: 'b.cave 무신사 데이터 분석 도구',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
