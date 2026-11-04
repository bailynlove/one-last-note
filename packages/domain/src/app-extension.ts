export const EXTENSION_API_VERSION = 1;
export const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;
export const EXTENSION_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
export const EXTENSION_PERMISSIONS = ['read-revision', 'emit-anchors', 'navigation'] as const;

export type AppExtensionPermission = (typeof EXTENSION_PERMISSIONS)[number];

export interface RendererContribution {
  id: string;
  label: string;
  extensions: string[];
  mediaTypes: string[];
  entry: string;
}

export interface MarkContribution {
  type: string;
  label: string;
  description: string;
  schema: Record<string, unknown>;
  defaultPayload: Record<string, unknown>;
}

export interface AppExtensionManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  publisher: string;
  renderers: RendererContribution[];
  marks: MarkContribution[];
  permissions: AppExtensionPermission[];
}

export interface AppExtensionInstallation {
  id: string;
  knowledgeBaseId: string;
  extensionId: string;
  name: string;
  version: string;
  apiVersion: number;
  publisher: string;
  packageHash: string;
  source: string;
  manifest: AppExtensionManifest;
  files: Record<string, string>;
  enabled: boolean;
  installedByUserId: string;
  createdAt: string;
}

export function isAppExtensionId(value: unknown): value is string {
  return typeof value === 'string' && EXTENSION_ID_PATTERN.test(value);
}

export function supportsRevision(
  renderer: RendererContribution,
  filename: string,
  mediaType: string,
): boolean {
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  return (
    renderer.extensions.some((item) => item.toLowerCase() === extension) ||
    renderer.mediaTypes.some((item) => item.toLowerCase() === mediaType.toLowerCase())
  );
}
