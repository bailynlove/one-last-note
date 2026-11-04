import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import sanitizeHtml from 'sanitize-html';

export interface ExtractedPage {
  title: string;
  siteName: string | null;
  canonicalUrl: string | null;
  contentHtml: string;
  imageUrls: string[];
}

export interface CaptureMedia {
  url: string;
  path: string;
  bytes: Uint8Array;
  contentType: string;
}

const HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'article',
    'section',
    'div',
    'span',
    'p',
    'br',
    'hr',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'pre',
    'code',
    'ul',
    'ol',
    'li',
    'dl',
    'dt',
    'dd',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'caption',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'sub',
    'sup',
    'mark',
    'small',
    'figure',
    'figcaption',
    'img',
    'a',
    'article',
    'header',
    'footer',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding', 'referrerpolicy'],
    article: ['data-capture-source'],
    '*': ['id'],
  },
  allowedSchemes: ['http', 'https'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        ...(attribs.href ? { rel: 'noopener noreferrer', target: '_blank' } : {}),
      },
    }),
    img: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, loading: 'lazy', decoding: 'async' },
    }),
  },
};

function absoluteUrl(value: string | null | undefined, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const { document } = parseHTML(html);
  const canonical = absoluteUrl(
    document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    pageUrl,
  );
  const siteName =
    document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() ||
    new URL(pageUrl).hostname;
  let title =
    document.querySelector('h1')?.textContent?.trim() ||
    document.title?.trim() ||
    new URL(pageUrl).hostname;
  let contentHtml = '';
  try {
    const article = new Readability(document).parse();
    if (article?.title && !document.querySelector('h1')?.textContent?.trim()) title = article.title;
    if (article?.content) contentHtml = article.content;
  } catch {
    contentHtml = '';
  }
  if (!contentHtml) contentHtml = document.body?.innerHTML ?? '';

  const imageUrls = new Set<string>();
  const imageDocument = parseHTML(`<div id="capture-root">${contentHtml}</div>`).document;
  for (const image of imageDocument.querySelectorAll('img[src]')) {
    const source = absoluteUrl(image.getAttribute('src'), pageUrl);
    if (source) {
      imageUrls.add(source);
      image.setAttribute('src', source);
    } else image.remove();
  }
  for (const link of imageDocument.querySelectorAll('a[href]')) {
    const href = absoluteUrl(link.getAttribute('href'), pageUrl);
    if (href) link.setAttribute('href', href);
    else link.removeAttribute('href');
  }
  contentHtml = imageDocument.querySelector('#capture-root')?.innerHTML ?? '';

  return {
    title: title.slice(0, 200),
    siteName: siteName.slice(0, 200),
    canonicalUrl: canonical,
    contentHtml,
    imageUrls: [...imageUrls],
  };
}

export function selectionHtml(
  html: string | null | undefined,
  text: string | null | undefined,
): string {
  if (html?.trim()) return sanitizeHtml(html, HTML_OPTIONS);
  if (text?.trim()) {
    return `<pre>${sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} })}</pre>`;
  }
  return '';
}

export function rewriteMedia(contentHtml: string, pageUrl: string, media: CaptureMedia[]): string {
  const byUrl = new Map(media.map((item) => [item.url, item.path]));
  const { document } = parseHTML(`<div id="capture-root">${contentHtml}</div>`);
  for (const image of document.querySelectorAll('img[src]')) {
    const source = absoluteUrl(image.getAttribute('src'), pageUrl);
    const path = source ? byUrl.get(source) : null;
    if (path) image.setAttribute('src', path);
    else image.remove();
  }
  return document.querySelector('#capture-root')?.innerHTML ?? '';
}

export function sanitizeCaptureHtml(html: string): string {
  return sanitizeHtml(html, HTML_OPTIONS);
}

export function provenanceHtml(
  title: string,
  sourceUrl: string,
  canonicalUrl: string,
  siteName: string | null,
  capturedAt: string,
  html: string,
): string {
  return `<article data-capture-source="true"><header><p>Captured from <a href="${sanitizeHtml(canonicalUrl, { allowedTags: [], allowedAttributes: {} })}" rel="noopener noreferrer" target="_blank">${sanitizeHtml(title, { allowedTags: [], allowedAttributes: {} })}</a>${siteName ? ` on ${sanitizeHtml(siteName, { allowedTags: [], allowedAttributes: {} })}` : ''} on ${capturedAt.slice(0, 10)}. <a href="${sanitizeHtml(sourceUrl, { allowedTags: [], allowedAttributes: {} })}" rel="noopener noreferrer" target="_blank">Original URL</a></p></header>${html}</article>`;
}
