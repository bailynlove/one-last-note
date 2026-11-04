import { describe, expect, it } from 'vitest';
import { renderRevision } from './renderers';

const bytes = (value: string) => new TextEncoder().encode(value);

describe('built-in renderers', () => {
  it('renders GFM Markdown and strips raw HTML and scripts', () => {
    const result = renderRevision({
      filename: 'note.md',
      mediaType: 'text/markdown',
      bytes: bytes(
        '# Title\n\n- [x] done\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))',
      ),
    });

    expect(result.kind).toBe('markdown');
    expect(result.html).toContain('<table>');
    expect(result.html).toContain('type="checkbox"');
    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('href="javascript:');
  });

  it('sanitizes HTML and blocks external assets until opted in', () => {
    const source = bytes(
      '<h1 style="color:red">Safe</h1><script>alert(1)</script><form><input></form><iframe src="https://x"></iframe><img src="https://tracker.example/x.png" onerror="alert(1)"><a href="javascript:alert(1)">x</a>',
    );
    const blocked = renderRevision({
      filename: 'note.html',
      mediaType: 'text/html',
      bytes: source,
    });
    const allowed = renderRevision({
      filename: 'note.html',
      mediaType: 'text/html',
      bytes: source,
      assetsAllowed: true,
    });

    expect(blocked.kind).toBe('html');
    expect(blocked.html).toContain('<h1>Safe</h1>');
    expect(blocked.html).not.toContain('<script');
    expect(blocked.html).not.toContain('<input');
    expect(blocked.html).not.toContain('<form');
    expect(blocked.html).not.toContain('<iframe');
    expect(blocked.html).not.toContain('onerror');
    expect(blocked.html).not.toContain('javascript:');
    expect(blocked.html).not.toContain('tracker.example');
    expect(allowed.html).toContain('tracker.example');
    expect(blocked.contentSecurityPolicy).toContain("img-src 'self' data:;");
    expect(allowed.contentSecurityPolicy).toContain('https:');
  });

  it('describes PDF and image revisions without inlining bytes', () => {
    expect(
      renderRevision({ filename: 'note.pdf', mediaType: 'application/pdf', bytes: bytes('%PDF') }),
    ).toMatchObject({ kind: 'pdf', selectable: true });
    expect(
      renderRevision({ filename: 'photo.png', mediaType: 'image/png', bytes: bytes('png') }),
    ).toMatchObject({ kind: 'image', selectable: false });
  });

  it('returns a safe diagnostic for unsupported types', () => {
    const result = renderRevision({
      filename: 'data.bin',
      mediaType: 'application/zip',
      bytes: bytes('zip'),
    });
    expect(result.kind).toBe('unsupported');
    expect(result.diagnostics[0]?.code).toBe('unsupported_renderer');
  });
});
