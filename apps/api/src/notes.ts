import type { AuthService, NoteService } from '@oln/application';
import { AppError } from '@oln/application';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser } from './auth';

const idParams = z.object({ id: z.uuid() });
const revisionParams = z.object({ id: z.uuid(), revisionId: z.uuid() });
const attachmentBody = z.object({
  sourceKnowledgeBaseId: z.uuid(),
  targetKnowledgeBaseId: z.uuid(),
});
const titleBody = z.object({ title: z.string().min(1).max(200) });
const knowledgeBaseId = z.uuid();
const MAX_UPLOAD_KNOWLEDGE_BASES = 50;

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError('The request is invalid.', { status: 400, title: 'Invalid request' });
  }
  return result.data;
}

async function currentUser(request: FastifyRequest, auth: AuthService) {
  return (await requireUser(request, auth)).user;
}

interface UploadParts {
  bytes: Uint8Array;
  filename: string;
  mediaType: string;
  title?: string;
  knowledgeBaseIds: string[];
}

async function readUpload(request: FastifyRequest): Promise<UploadParts> {
  let bytes: Uint8Array | null = null;
  let filename = '';
  let mediaType = 'application/octet-stream';
  let title: string | undefined;
  const knowledgeBaseIds: string[] = [];

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (bytes) {
        part.file.resume();
        continue;
      }
      bytes = await part.toBuffer();
      filename = part.filename;
      mediaType = part.mimetype;
      continue;
    }
    if (part.fieldname === 'title' && typeof part.value === 'string') {
      title = part.value;
    }
    if (part.fieldname === 'knowledgeBaseIds' && typeof part.value === 'string') {
      const ids = part.value
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (knowledgeBaseIds.length + ids.length > MAX_UPLOAD_KNOWLEDGE_BASES) {
        throw new AppError('Choose fewer Knowledge Bases.', {
          status: 400,
          title: 'Upload rejected',
        });
      }
      for (const id of ids) {
        if (!knowledgeBaseId.safeParse(id).success) {
          throw new AppError('The request is invalid.', { status: 400, title: 'Invalid request' });
        }
        knowledgeBaseIds.push(id);
      }
    }
  }

  if (!bytes) {
    throw new AppError('Choose a file to upload.', { status: 400, title: 'Upload rejected' });
  }
  return { bytes, filename, mediaType, title, knowledgeBaseIds };
}

export function registerNoteRoutes(
  app: FastifyInstance,
  auth: AuthService,
  service: NoteService,
): void {
  app.get('/knowledge-bases/:id/notes', async (request) => {
    const user = await currentUser(request, auth);
    const { id } = parse(idParams, request.params);
    return service.listNotes(user.id, id);
  });

  app.post('/knowledge-bases/:id/notes', async (request, reply) => {
    const user = await currentUser(request, auth);
    const { id } = parse(idParams, request.params);
    const upload = await readUpload(request);
    const note = await service.upload(user.id, [id, ...upload.knowledgeBaseIds], {
      filename: upload.filename,
      mediaType: upload.mediaType,
      bytes: upload.bytes,
      title: upload.title,
    });
    reply.status(201).send(note);
  });

  app.get('/notes/:id', async (request) => {
    const user = await currentUser(request, auth);
    const { id } = parse(idParams, request.params);
    return service.getNote(user.id, id);
  });

  app.patch('/notes/:id', async (request) => {
    const user = await currentUser(request, auth);
    const { id } = parse(idParams, request.params);
    const { title } = parse(titleBody, request.body);
    return service.updateTitle(user.id, id, title);
  });

  app.post('/notes/:id/revisions', async (request, reply) => {
    const user = await currentUser(request, auth);
    const { id } = parse(idParams, request.params);
    const upload = await readUpload(request);
    const note = await service.replace(user.id, id, {
      filename: upload.filename,
      mediaType: upload.mediaType,
      bytes: upload.bytes,
      title: upload.title,
    });
    reply.status(201).send(note);
  });

  app.post('/notes/:id/associations', async (request) => {
    const user = await currentUser(request, auth);
    const { id } = parse(idParams, request.params);
    const body = parse(attachmentBody, request.body);
    return service.attachToKnowledgeBase(
      user.id,
      id,
      body.sourceKnowledgeBaseId,
      body.targetKnowledgeBaseId,
    );
  });

  app.get('/notes/:id/revisions/:revisionId/original', async (request, reply) => {
    const user = await currentUser(request, auth);
    const { id, revisionId } = parse(revisionParams, request.params);
    const original = await service.download(user.id, id, revisionId);
    reply
      .type(original.revision.mediaType)
      .header(
        'content-disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(original.revision.originalFilename)}`,
      )
      .send(Buffer.from(original.bytes));
  });
}
