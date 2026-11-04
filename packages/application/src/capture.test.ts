import { describe, expect, it } from 'vitest';
import { extractPage, sanitizeCaptureHtml, selectionHtml } from './capture-html';
import { canonicalizeUrl, isPrivateAddress, isPublicHttpUrl } from './capture-url';

describe('capture URL safety', () => {
  it('rejects private and non-http targets', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.1.1',
      '::1',
      'fd00::1',
      'fe80::1',
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPublicHttpUrl('https://example.com/article')).toBe(true);
    expect(isPublicHttpUrl('http://127.0.0.1/')).toBe(false);
    expect(isPublicHttpUrl('http://[::1]/')).toBe(false);
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpUrl('https://user:pass@example.com/')).toBe(false);
  });

  it('normalizes canonical URLs', () => {
    expect(canonicalizeUrl('https://Example.com:443/a?b=1#frag')).toBe('https://example.com/a?b=1');
  });
});

describe('capture extraction', () => {
  it('extracts readable content, metadata, canonical URL, and absolute images', () => {
    const page = extractPage(
      `<!doctype html><html><head><title>Fallback</title>
       <link rel="canonical" href="/canonical">
       <meta property="og:site_name" content="Example Site"></head>
       <body><nav>Navigation</nav><article><h1>Readable title</h1>
       <p>This is the article body with enough text to be considered readable by the parser. It keeps going for a while so the extraction is useful.</p>
       <img src="/photo.png" onerror="alert(1)"><script>alert(1)</script></article></body></html>`,
      'https://example.com/story',
    );
    expect(page.title).toContain('Readable');
    expect(page.siteName).toBe('Example Site');
    expect(page.canonicalUrl).toBe('https://example.com/canonical');
    expect(page.contentHtml).toContain('https://example.com/photo.png');
    expect(page.contentHtml).not.toContain('<script');
    expect(page.imageUrls).toContain('https://example.com/photo.png');
  });

  it('sanitizes scripts and keeps selected text only', () => {
    const selected = selectionHtml(
      '<p>Selected <script>alert(1)</script><strong>text</strong></p>',
      'fallback',
    );
    expect(selected).toContain('<strong>text</strong>');
    expect(selected).not.toContain('script');
    const clean = sanitizeCaptureHtml(
      '<p onclick="x()">Hello</p><iframe src="https://evil.test"></iframe>',
    );
    expect(clean).toBe('<p>Hello</p>');
  });
});
