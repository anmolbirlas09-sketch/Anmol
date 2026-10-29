import type { Metadata, Viewport } from 'next';
import { L } from '@/lib/labels';
import './globals.css';

export const metadata: Metadata = {
  title: { default: L.app.name, template: `%s · ${L.app.name}` },
  description: 'Yarn, beam, loom and grey fabric stock',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#181b21' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
