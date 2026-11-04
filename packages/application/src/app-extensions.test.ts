import type { AppExtensionInstallation, AppExtensionManifest } from '@oln/domain';
import { describe, expect, it } from 'vitest';
import { AppExtensionService, type AppExtensionStore } from './app-extensions';

const manifest: AppExtensionManifest = {
  id: 'acme.reader',
  name: 'Acme Reader',
  version: '1.0.0',
  apiVersion: 1,
  publisher: 'Acme',
  renderers: [
    {
      id: 'reader',
      label: 'Acme Reader',
      extensions: ['acme'],
      mediaTypes: ['application/x-acme'],
      entry: 'renderer.js',
    },
  ],
  marks: [],
  permissions: ['read-revision'],
};

const files = { 'renderer.js': 'oln.root.textContent = oln.revision.filename;' };

function installation(): AppExtensionInstallation {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    knowledgeBaseId: '00000000-0000-4000-8000-000000000002',
    extensionId: manifest.id,
    name: manifest.name,
    version: manifest.version,
    apiVersion: 1,
    publisher: manifest.publisher,
    packageHash: 'hash',
    source: 'upload',
    manifest,
    files,
    enabled: false,
    installedByUserId: '00000000-0000-4000-8000-000000000003',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function store(role: 'owner' | 'manager' | 'viewer' | null): AppExtensionStore {
  return {
    async findAccess() {
      return role;
    },
    async list() {
      return [];
    },
    async find() {
      return installation();
    },
    async install(input) {
      return { ...installation(), ...input, version: input.manifest.version };
    },
    async setEnabled() {
      return installation();
    },
    async remove() {
      return true;
    },
  };
}

describe('App Extension packages', () => {
  it('hashes and installs a validated package as a disabled pin', async () => {
    const service = new AppExtensionService({ store: store('manager') });
    const result = await service.install('user', 'kb', { manifest, files });
    expect(result.packageHash).toHaveLength(64);
    expect(result.enabled).toBe(false);
  });

  it('rejects unsafe paths, missing entries, wrong API, and unnamespaced Marks', async () => {
    const service = new AppExtensionService({ store: store('owner') });
    await expect(
      service.install('user', 'kb', { manifest, files: { '../renderer.js': 'x' } }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.install('user', 'kb', { manifest, files: { 'other.js': 'x' } }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.install('user', 'kb', { manifest: { ...manifest, apiVersion: 2 }, files }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.install('user', 'kb', {
        manifest: {
          ...manifest,
          marks: [
            {
              type: 'other:mark',
              label: 'Mark',
              description: '',
              schema: {},
              defaultPayload: {},
            },
          ],
        },
        files,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('rejects packages over 2 MB and viewers', async () => {
    const service = new AppExtensionService({ store: store('owner') });
    await expect(
      service.install('user', 'kb', { manifest, files: { 'renderer.js': 'x'.repeat(2_100_000) } }),
    ).rejects.toMatchObject({ status: 413 });
    const viewerService = new AppExtensionService({ store: store('viewer') });
    await expect(viewerService.install('user', 'kb', { manifest, files })).rejects.toMatchObject({
      status: 403,
    });
  });
});
