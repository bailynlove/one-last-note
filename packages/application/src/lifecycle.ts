import type { DeletedKnowledgeBase, PurgeResult, TrashedAssociation } from '@oln/domain';
import { TRASH_RETENTION_MS } from '@oln/domain';
import { AppError } from './errors';

export interface LifecycleStore {
  trashAssociation(
    userId: string,
    noteId: string,
    knowledgeBaseId: string,
    now: Date,
    purgeAfter: Date,
  ): Promise<TrashedAssociation | null>;
  restoreAssociation(
    userId: string,
    noteId: string,
    knowledgeBaseId: string,
    now: Date,
  ): Promise<TrashedAssociation | null>;
  listAssociationTrash(
    userId: string,
    knowledgeBaseId: string,
  ): Promise<TrashedAssociation[] | null>;
  deleteKnowledgeBase(
    userId: string,
    knowledgeBaseId: string,
    now: Date,
    purgeAfter: Date,
  ): Promise<DeletedKnowledgeBase | null>;
  restoreKnowledgeBase(
    userId: string,
    knowledgeBaseId: string,
    now: Date,
  ): Promise<DeletedKnowledgeBase | null>;
  listDeletedKnowledgeBases(userId: string): Promise<DeletedKnowledgeBase[]>;
  purgeDue(now: Date, deleteObjects: (keys: string[]) => Promise<void>): Promise<PurgeResult>;
}

export interface LifecycleServiceOptions {
  store: LifecycleStore;
  now?: () => Date;
  retentionMs?: number;
}

export class LifecycleService {
  private readonly now: () => Date;
  private readonly retentionMs: number;

  constructor(private readonly options: LifecycleServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.retentionMs = options.retentionMs ?? TRASH_RETENTION_MS;
  }

  async trashAssociation(
    userId: string,
    noteId: string,
    knowledgeBaseId: string,
  ): Promise<TrashedAssociation> {
    const now = this.now();
    const result = await this.options.store.trashAssociation(
      userId,
      noteId,
      knowledgeBaseId,
      now,
      new Date(now.getTime() + this.retentionMs),
    );
    if (!result) {
      throw new AppError('This association cannot be moved to Trash.', {
        status: 404,
        title: 'Not found',
      });
    }
    return result;
  }

  async restoreAssociation(
    userId: string,
    noteId: string,
    knowledgeBaseId: string,
  ): Promise<TrashedAssociation> {
    const result = await this.options.store.restoreAssociation(
      userId,
      noteId,
      knowledgeBaseId,
      this.now(),
    );
    if (!result) {
      throw new AppError('This association cannot be restored.', {
        status: 404,
        title: 'Not found',
      });
    }
    return result;
  }

  async listAssociationTrash(
    userId: string,
    knowledgeBaseId: string,
  ): Promise<TrashedAssociation[]> {
    const rows = await this.options.store.listAssociationTrash(userId, knowledgeBaseId);
    if (rows === null) {
      throw new AppError('Only Owners and Managers can view Trash.', {
        status: 403,
        title: 'Not allowed',
      });
    }
    return rows;
  }

  async deleteKnowledgeBase(
    userId: string,
    knowledgeBaseId: string,
  ): Promise<DeletedKnowledgeBase> {
    const now = this.now();
    const result = await this.options.store.deleteKnowledgeBase(
      userId,
      knowledgeBaseId,
      now,
      new Date(now.getTime() + this.retentionMs),
    );
    if (!result) {
      throw new AppError('Only the Owner can delete this Knowledge Base.', {
        status: 403,
        title: 'Not allowed',
      });
    }
    return result;
  }

  async restoreKnowledgeBase(
    userId: string,
    knowledgeBaseId: string,
  ): Promise<DeletedKnowledgeBase> {
    const result = await this.options.store.restoreKnowledgeBase(
      userId,
      knowledgeBaseId,
      this.now(),
    );
    if (!result) {
      throw new AppError('This Knowledge Base cannot be restored.', {
        status: 404,
        title: 'Not found',
      });
    }
    return result;
  }

  listDeletedKnowledgeBases(userId: string): Promise<DeletedKnowledgeBase[]> {
    return this.options.store.listDeletedKnowledgeBases(userId);
  }

  purgeDue(deleteObjects: (keys: string[]) => Promise<void>): Promise<PurgeResult> {
    return this.options.store.purgeDue(this.now(), deleteObjects);
  }
}

export function daysRemaining(purgeAfter: string, now = new Date()): number {
  return Math.max(0, Math.ceil((new Date(purgeAfter).getTime() - now.getTime()) / 86_400_000));
}
