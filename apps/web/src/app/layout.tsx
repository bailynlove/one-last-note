import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'one last note — foundation status',
  description: 'Health of the one last note application foundation.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
