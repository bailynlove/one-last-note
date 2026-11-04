import type { Renderer, RendererInput, RendererResult } from '@oln/domain';
import MarkdownIt from 'markdown-it';
// @ts-expect-error the package does not publish type declarations.
import taskLists from 'markdown-it-task-lists';
import sanitizeHtml from 'sanitize-html';

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
}).use(taskLists, { enabled: true, label: true });

function isExternal(url: string | undefined): boolean {
  return Boolean(url && /^(?:https?:)?\/\//i.test(url));
}

function sanitizeOptions(assetsAllowed: boolean, taskLists: boolean): sanitizeHtml.IOptions {
  return {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags.filter(
        (tag) =>
          !['iframe', 'form', 'button', 'select', 'textarea', 'option', 'style'].includes(tag),
      ),
      'img',
      ...(taskLists ? ['input'] : []),
    ],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['class', 'title'],
      a: ['href', 'name', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      ...(taskLists ? { input: ['type', 'checked', 'disabled'] } : {}),
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_top' }),
      img: (tagName, attribs) => {
        const next: Record<string, string> = {
          ...attribs,
          loading: 'lazy',
          referrerpolicy: 'no-referrer',
        };
        if (!assetsAllowed && isExternal(next.src)) {
          delete next.src;
        }
        return { tagName, attribs: next };
      },
    },
  };
}

function contentSecurityPolicy(allowed: boolean): string {
  const remote = allowed ? ' https: http:' : '';
  return [
    "default-src 'none'",
    `img-src 'self' data:${remote}`,
    `media-src 'self' data:${remote}`,
    `font-src 'self' data:${remote}`,
    `style-src 'unsafe-inline'${remote}`,
    "script-src 'none'",
    "frame-src 'none'",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

function mediaTypeOf(input: RendererInput): string {
  return input.mediaType.split(';')[0]?.trim().toLowerCase() ?? '';
}

function assetPolicy(input: RendererInput): RendererResult['assetPolicy'] {
  return input.assetsAllowed ? 'allowed' : 'blocked';
}

function renderMarkdown(input: RendererInput): RendererResult {
  const html = sanitizeHtml(
    markdown.render(new TextDecoder('utf-8').decode(input.bytes)),
    sanitizeOptions(Boolean(input.assetsAllowed), true),
  );
  return {
    kind: 'markdown',
    html,
    contentSecurityPolicy: contentSecurityPolicy(Boolean(input.assetsAllowed)),
    assetPolicy: assetPolicy(input),
    diagnostics: [],
    selectable: true,
  };
}

function renderHtml(input: RendererInput): RendererResult {
  return {
    kind: 'html',
    html: sanitizeHtml(
      new TextDecoder('utf-8').decode(input.bytes),
      sanitizeOptions(Boolean(input.assetsAllowed), false),
    ),
    contentSecurityPolicy: contentSecurityPolicy(Boolean(input.assetsAllowed)),
    assetPolicy: assetPolicy(input),
    diagnostics: [],
    selectable: true,
  };
}

function renderText(input: RendererInput): RendererResult {
  return {
    kind: 'text',
    text: new TextDecoder('utf-8').decode(input.bytes),
    assetPolicy: assetPolicy(input),
    diagnostics: [],
    selectable: true,
  };
}

function renderPdf(input: RendererInput): RendererResult {
  return { kind: 'pdf', assetPolicy: assetPolicy(input), diagnostics: [], selectable: true };
}

function renderImage(input: RendererInput): RendererResult {
  return { kind: 'image', assetPolicy: assetPolicy(input), diagnostics: [], selectable: false };
}

function renderUnsupported(input: RendererInput): RendererResult {
  return {
    kind: 'unsupported',
    assetPolicy: assetPolicy(input),
    diagnostics: [
      {
        code: 'unsupported_renderer',
        message: 'No built-in Renderer supports this Revision type. Download the original instead.',
      },
    ],
    selectable: false,
  };
}

const builtInRenderers: Renderer[] = [
  {
    kind: 'markdown',
    supports: (mediaType) => mediaType === 'text/markdown',
    render: renderMarkdown,
  },
  { kind: 'html', supports: (mediaType) => mediaType === 'text/html', render: renderHtml },
  { kind: 'pdf', supports: (mediaType) => mediaType === 'application/pdf', render: renderPdf },
  { kind: 'image', supports: (mediaType) => mediaType.startsWith('image/'), render: renderImage },
  { kind: 'text', supports: (mediaType) => mediaType === 'text/plain', render: renderText },
];

export function renderRevision(input: RendererInput): RendererResult {
  const mediaType = mediaTypeOf(input);
  const renderer = builtInRenderers.find((candidate) => candidate.supports(mediaType));
  return (renderer ?? { render: renderUnsupported }).render(input);
}
