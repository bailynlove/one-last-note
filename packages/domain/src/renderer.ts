export type RendererKind = 'markdown' | 'html' | 'pdf' | 'image' | 'text' | 'unsupported';

export interface RendererDiagnostic {
  code: string;
  message: string;
}

export interface RendererResult {
  kind: RendererKind;
  html?: string;
  text?: string;
  contentSecurityPolicy?: string;
  assetPolicy: 'blocked' | 'allowed';
  diagnostics: RendererDiagnostic[];
  selectable: boolean;
}

export interface RendererInput {
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
  assetsAllowed?: boolean;
}

export interface Renderer {
  readonly kind: RendererKind;
  supports(mediaType: string): boolean;
  render(input: RendererInput): RendererResult;
}
