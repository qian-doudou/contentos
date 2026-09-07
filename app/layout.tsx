import type { Metadata } from 'next';
import { AppShell } from '@/components/contentos/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'ContentOS · AI 短视频内容运营平台',
  description: '面向本地生活短视频团队的内容运营与项目管理平台。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
