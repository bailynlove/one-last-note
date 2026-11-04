import type { Annotation, MarkTypeDescriptor } from '@oln/domain';
import { describe, expect, it } from 'vitest';
import { AnnotationService, type AnnotationStore } from './annotations';
import { validateMarkPayload } from './mark-types';

const rating: MarkTypeDescriptor = {
  type: 'acme.reader:rating',
  label: 'Rating',
  description: 'A rating.',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['value'],
    properties: { value: { type: 'integer', minimum: 1, maximum: 5 } },
  },
  defaultPayload: { value: 3 },
  source: 'extension',
  extensionId: 'acme.reader',
  extensionVersion: '1.0.0',
  operations: ['create', 'list'],
};

const base = {
  kind: 'text' as const,
  exact: 'quote',
  prefix: '',
  suffix: '',
  startOffset: 0,
  endOffset: 5,
  path: 'p',
};

function store(created: Annotation[]): AnnotationStore {
  return {
    async findAccess() {
      return { role: 'viewer' };
    },
    async findKnowledgeBaseRole() {
      return { role: 'viewer' };
    },
    async hasRevision() {
      return true;
    },
    async list() {
      return created;
    },
    async find() {
      return null;
    },
    async create(input) {
      const annotation: Annotation = {
        id: crypto.randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId,
        noteId: input.noteId,
        revisionId: input.revisionId,
        originalRevisionId: input.revisionId,
        parentId: null,
        author: { id: input.authorUserId, displayName: 'User', avatarUrl: null },
        kind: input.kind,
        markType: input.markType,
        payload: input.payload,
        body: input.body,
        agentName: input.agentName,
        anchor: input.anchor,
        needsReview: false,
        deleted: false,
        createdAt: input.now.toISOString(),
        updatedAt: input.now.toISOString(),
        replies: [],
      };
      created.push(annotation);
      return annotation;
    },
    async updateBody() {
      return null;
    },
    async softDelete() {},
    async hardDeleteIfUnthreaded() {
      return true;
    },
  };
}

describe('Mark payload registry', () => {
  it('validates typed extension payloads and rejects bad values', () => {
    expect(validateMarkPayload(rating, { value: 4 })).toBeNull();
    expect(validateMarkPayload(rating, { value: 9 })).toContain('too large');
    expect(validateMarkPayload(rating, { value: 4, extra: true })).toContain('unknown field');
    expect(validateMarkPayload(rating, {})).toContain('missing value');
  });

  it('stores custom payloads and built-in Highlight defaults through one service', async () => {
    const created: Annotation[] = [];
    const service = new AnnotationService({
      store: store(created),
      markTypes: {
        async markTypes() {
          return [rating];
        },
      },
    });
    const custom = await service.create({ id: 'user' }, 'kb', 'note', {
      revisionId: 'rev',
      kind: 'mark',
      markType: 'acme.reader:rating',
      payload: { value: 5 },
      anchor: base,
    });
    expect(custom.payload).toEqual({ value: 5 });
    const highlight = await service.create({ id: 'user' }, 'kb', 'note', {
      revisionId: 'rev',
      kind: 'mark',
      anchor: base,
    });
    expect(highlight.markType).toBe('core/highlight');
    expect(highlight.payload).toEqual({});
  });

  it('rejects unknown and invalid Mark types without creating data', async () => {
    const created: Annotation[] = [];
    const service = new AnnotationService({
      store: store(created),
      markTypes: {
        async markTypes() {
          return [rating];
        },
      },
    });
    await expect(
      service.create({ id: 'user' }, 'kb', 'note', {
        revisionId: 'rev',
        kind: 'mark',
        markType: 'other.reader:rating',
        anchor: base,
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.create({ id: 'user' }, 'kb', 'note', {
        revisionId: 'rev',
        kind: 'mark',
        markType: 'acme.reader:rating',
        payload: { value: 99 },
        anchor: base,
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(created).toHaveLength(0);
  });
});
