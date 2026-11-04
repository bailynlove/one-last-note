import { createHash } from 'node:crypto';
import type {
  AppExtensionInstallation,
  AppExtensionManifest,
  MarkTypeDescriptor,
  RendererContribution,
} from '@oln/domain';
import {
  EXTENSION_API_VERSION,
  EXTENSION_ID_PATTERN,
  EXTENSION_PERMISSIONS,
  EXTENSION_VERSION_PATTERN,
  supportsRevision,
} from '@oln/domain';
import { z } from 'zod';
import { AppError } from './errors';

const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 20;

const pathSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/)
  .refine((value) => !value.includes('..') && !value.startsWith('/'), 'Unsafe path');

const manifestSchema = z
  .object({
    id: z.string().regex(EXTENSION_ID_PATTERN),
    name: z.string().min(1).max(80),
    version: z.string().regex(EXTENSION_VERSION_PATTERN),
    apiVersion: z.number().int(),
    publisher: z.string().min(1).max(80),
    renderers: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]*$/),
            label: z.string().min(1).max(80),
            extensions: z.array(z.string().regex(/^[a-z0-9]+$/)).max(20),
            mediaTypes: z.array(z.string().min(1).max(120)).max(20),
            entry: pathSchema,
          })
          .strict(),
      )
      .max(10),
    marks: z
      .array(
        z
          .object({
            type: z.string().regex(/^[a-z0-9-]+\.[a-z0-9-]+:[a-z][a-z0-9-]*$/),
            label: z.string().min(1).max(80),
            description: z.string().max(300),
            schema: z.record(z.string(), z.unknown()),
            defaultPayload: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .max(20),
    permissions: z.array(z.enum(EXTENSION_PERMISSIONS)).max(EXTENSION_PERMISSIONS.length),
  })
  .strict();

export interface AppExtensionStore {
  findAccess(
    knowledgeBaseId: string,
    userId: string,
  ): Promise<'owner' | 'manager' | 'viewer' | null>;
  list(knowledgeBaseId: string): Promise<AppExtensionInstallation[]>;
  find(knowledgeBaseId: string, installationId: string): Promise<AppExtensionInstallation | null>;
  install(input: {
    knowledgeBaseId: string;
    manifest: AppExtensionManifest;
    files: Record<string, string>;
    packageHash: string;
    source: string;
    userId: string;
    now: Date;
  }): Promise<AppExtensionInstallation>;
  setEnabled(
    knowledgeBaseId: string,
    installationId: string,
    enabled: boolean,
  ): Promise<AppExtensionInstallation | null>;
  remove(knowledgeBaseId: string, installationId: string): Promise<boolean>;
}

export interface AppExtensionServiceOptions {
  store: AppExtensionStore;
  now?: () => Date;
}

function forbidden(): AppError {
  return new AppError('Only Owners and Managers can manage App Extensions.', {
    status: 403,
    title: 'Forbidden',
  });
}

function notFound(): AppError {
  return new AppError('App Extension not found.', { status: 404, title: 'Not found' });
}

function packageHash(manifest: AppExtensionManifest, files: Record<string, string>): string {
  const canonicalFiles = Object.keys(files)
    .sort()
    .map((path) => [path, files[path]]);
  return createHash('sha256')
    .update(JSON.stringify({ manifest, files: canonicalFiles }))
    .digest('hex');
}

function validatePackage(
  manifest: unknown,
  files: unknown,
): {
  manifest: AppExtensionManifest;
  files: Record<string, string>;
} {
  const parsed = manifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new AppError('The App Extension manifest is invalid.', {
      status: 422,
      title: 'Invalid package',
      cause: parsed.error,
    });
  }
  if (parsed.data.apiVersion !== EXTENSION_API_VERSION) {
    throw new AppError(`App Extension API ${parsed.data.apiVersion} is not supported.`, {
      status: 422,
      title: 'Invalid package',
    });
  }
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new AppError('The App Extension package has no files.', {
      status: 422,
      title: 'Invalid package',
    });
  }
  const entries = Object.entries(files as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_FILES) {
    throw new AppError('The App Extension package has too many files.', {
      status: 422,
      title: 'Invalid package',
    });
  }
  let total = 0;
  const cleanFiles: Record<string, string> = {};
  for (const [path, content] of entries) {
    if (!pathSchema.safeParse(path).success) {
      throw new AppError('The App Extension package contains an unsafe file path.', {
        status: 422,
        title: 'Invalid package',
      });
    }
    if (typeof content !== 'string') {
      throw new AppError('App Extension files must be text.', {
        status: 422,
        title: 'Invalid package',
      });
    }
    total += Buffer.byteLength(content);
    cleanFiles[path] = content;
  }
  if (total > MAX_PACKAGE_BYTES) {
    throw new AppError('The App Extension package is too large.', {
      status: 413,
      title: 'Package too large',
    });
  }
  for (const renderer of parsed.data.renderers) {
    if (!cleanFiles[renderer.entry]) {
      throw new AppError(`Renderer entry ${renderer.entry} is missing.`, {
        status: 422,
        title: 'Invalid package',
      });
    }
  }
  for (const mark of parsed.data.marks) {
    if (!mark.type.startsWith(`${parsed.data.id}:`)) {
      throw new AppError('Mark types must be namespaced by the extension ID.', {
        status: 422,
        title: 'Invalid package',
      });
    }
  }
  return { manifest: parsed.data, files: cleanFiles };
}

export class AppExtensionService {
  private readonly now: () => Date;

  constructor(private readonly options: AppExtensionServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async list(userId: string, knowledgeBaseId: string): Promise<AppExtensionInstallation[]> {
    const role = await this.options.store.findAccess(knowledgeBaseId, userId);
    if (!role) throw notFound();
    return this.options.store.list(knowledgeBaseId);
  }

  async install(
    userId: string,
    knowledgeBaseId: string,
    input: { manifest: unknown; files: unknown; source?: string },
  ): Promise<AppExtensionInstallation> {
    const role = await this.options.store.findAccess(knowledgeBaseId, userId);
    if (role !== 'owner' && role !== 'manager') throw forbidden();
    const pkg = validatePackage(input.manifest, input.files);
    const hash = packageHash(pkg.manifest, pkg.files);
    try {
      return await this.options.store.install({
        knowledgeBaseId,
        manifest: pkg.manifest,
        files: pkg.files,
        packageHash: hash,
        source: input.source?.trim().slice(0, 300) || 'upload',
        userId,
        now: this.now(),
      });
    } catch (error) {
      let current: unknown = error;
      for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
        if ('code' in current && (current as { code?: unknown }).code === '23505') {
          throw new AppError('That App Extension version is already installed.', {
            status: 409,
            title: 'Already installed',
          });
        }
        current = 'cause' in current ? (current as { cause?: unknown }).cause : null;
      }
      throw error;
    }
  }

  async setEnabled(
    userId: string,
    knowledgeBaseId: string,
    installationId: string,
    enabled: boolean,
  ): Promise<AppExtensionInstallation> {
    const role = await this.options.store.findAccess(knowledgeBaseId, userId);
    if (role !== 'owner' && role !== 'manager') throw forbidden();
    const installation = await this.options.store.setEnabled(
      knowledgeBaseId,
      installationId,
      enabled,
    );
    if (!installation) throw notFound();
    return installation;
  }

  async remove(userId: string, knowledgeBaseId: string, installationId: string): Promise<void> {
    const role = await this.options.store.findAccess(knowledgeBaseId, userId);
    if (role !== 'owner' && role !== 'manager') throw forbidden();
    if (!(await this.options.store.remove(knowledgeBaseId, installationId))) throw notFound();
  }

  async markTypes(userId: string, knowledgeBaseId: string): Promise<MarkTypeDescriptor[]> {
    const installations = (await this.list(userId, knowledgeBaseId)).filter(
      (installation) => installation.enabled,
    );
    return installations.flatMap((installation) =>
      installation.manifest.marks.map((mark) => ({
        type: mark.type,
        label: mark.label,
        description: mark.description,
        schema: mark.schema,
        defaultPayload: mark.defaultPayload,
        source: 'extension' as const,
        extensionId: installation.extensionId,
        extensionVersion: installation.version,
        operations: ['create', 'list'],
      })),
    );
  }

  async rendererFor(
    knowledgeBaseId: string,
    filename: string,
    mediaType: string,
  ): Promise<{ installation: AppExtensionInstallation; renderer: RendererContribution } | null> {
    const installations = (await this.options.store.list(knowledgeBaseId)).filter(
      (installation) => installation.enabled,
    );
    for (const installation of installations) {
      const renderer = installation.manifest.renderers.find((item) =>
        supportsRevision(item, filename, mediaType),
      );
      if (renderer) return { installation, renderer };
    }
    return null;
  }
}
