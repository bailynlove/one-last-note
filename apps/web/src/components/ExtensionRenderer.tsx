'use client';

import type { AppExtensionInstallation, RendererContribution } from '@oln/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './extension-renderer.module.css';

interface ExtensionRendererProps {
  installation: AppExtensionInstallation;
  renderer: RendererContribution;
  bytes: Uint8Array;
  filename: string;
  mediaType: string;
  downloadHref: string;
  builtinHref: string;
}

function sandboxHtml(
  installation: AppExtensionInstallation,
  renderer: RendererContribution,
): string {
  const files = JSON.stringify(installation.files).replaceAll('<', '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:;"><style>html,body{margin:0;padding:0;font:16px/1.6 system-ui,sans-serif;color:#1d1d1b;background:#fff}*{max-width:100%}</style></head><body><div id="root"></div><script>
const files = ${files};
const entry = ${JSON.stringify(renderer.entry)};
const root = document.getElementById('root');
const send = (message) => parent.postMessage(message, '*');
const api = {
  revision: null,
  root,
  emitAnchor: (candidate) => send({ type: 'oln:anchor', candidate }),
  report: (message) => send({ type: 'oln:diagnostic', message: String(message).slice(0, 500) }),
  setHeight: (height) => send({ type: 'oln:height', height: Number(height) }),
  fail: (message) => send({ type: 'oln:error', message: String(message).slice(0, 500) }),
};
window.addEventListener('error', (event) => send({ type: 'oln:error', message: String(event.message).slice(0, 500) }));
window.addEventListener('unhandledrejection', (event) => send({ type: 'oln:error', message: String(event.reason).slice(0, 500) }));
window.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'oln:init') return;
  api.revision = {
    filename: String(event.data.filename || ''),
    mediaType: String(event.data.mediaType || ''),
    bytes: new Uint8Array(event.data.bytes || []),
  };
  try {
    const factory = new Function('oln', files[entry]);
    factory(api);
    send({ type: 'oln:mounted' });
  } catch (error) {
    send({ type: 'oln:error', message: String(error).slice(0, 500) });
  }
});
send({ type: 'oln:ready' });
</script></body></html>`;
}

export function ExtensionRenderer({
  installation,
  renderer,
  bytes,
  filename,
  mediaType,
  downloadHref,
  builtinHref,
}: ExtensionRendererProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [height, setHeight] = useState(520);
  const [message, setMessage] = useState('');
  const srcDoc = useMemo(() => sandboxHtml(installation, renderer), [installation, renderer]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setStatus((current) => (current === 'loading' ? 'failed' : current));
      setMessage('The App Extension did not initialize in time.');
    }, 15_000);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: string; message?: string; height?: number };
      if (data.type === 'oln:ready') {
        frame.current?.contentWindow?.postMessage(
          {
            type: 'oln:init',
            filename,
            mediaType,
            bytes: bytes.buffer,
          },
          '*',
          [bytes.buffer],
        );
      } else if (data.type === 'oln:mounted' || data.type === 'oln:height') {
        setStatus('ready');
        if (typeof data.height === 'number') {
          setHeight(Math.min(2000, Math.max(240, data.height)));
        }
      } else if (data.type === 'oln:anchor') {
        window.dispatchEvent(new CustomEvent('oln-extension-anchor', { detail: event.data }));
      } else if (data.type === 'oln:diagnostic') {
        setMessage(data.message ?? '');
      } else if (data.type === 'oln:error') {
        setStatus('failed');
        setMessage(data.message ?? 'The App Extension failed.');
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
    };
  }, [bytes, filename, mediaType]);

  if (status === 'failed') {
    return (
      <div className={styles.fallback} role="alert">
        <p>
          <strong>{installation.name}</strong> could not render this Revision.
        </p>
        {message ? <p className={styles.detail}>{message}</p> : null}
        <div className={styles.actions}>
          <a href={downloadHref}>Download original</a>
          <a href={builtinHref}>Use built-in reader</a>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.frame}>
      {status === 'loading' ? (
        <p className={styles.loading}>Starting {installation.name}…</p>
      ) : null}
      <iframe
        ref={frame}
        title={`${installation.name} renderer`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        height={height}
      />
      {message ? <p className={styles.detail}>{message}</p> : null}
    </div>
  );
}
