'use client';

import dynamic from 'next/dynamic';

const PdfViewer = dynamic(() => import('./PdfViewer').then((module) => module.PdfViewer), {
  ssr: false,
  loading: () => <p>Loading PDF…</p>,
});

export function PdfViewerClient({ url, title }: { url: string; title: string }) {
  return <PdfViewer url={url} title={title} />;
}
