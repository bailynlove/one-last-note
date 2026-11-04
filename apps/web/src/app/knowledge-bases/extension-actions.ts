'use server';

import { redirect } from 'next/navigation';
import {
  installAppExtension,
  removeAppExtension,
  setAppExtensionEnabled,
} from '../../lib/app-extensions';
import { readSessionToken } from '../../lib/session';

function back(knowledgeBaseId: string, message: string): never {
  const params = new URLSearchParams({
    error: message.replace(/[\r\n\t]+/g, ' ').slice(0, 300),
  });
  redirect(`/knowledge-bases/${knowledgeBaseId}/extensions?${params}`);
}

function parseObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object.`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      error instanceof SyntaxError ? `${label} is not valid JSON.` : (error as Error).message,
    );
  }
}

export async function installExtensionAction(formData: FormData): Promise<void> {
  const token = await readSessionToken();
  if (!token) redirect('/login');
  const knowledgeBaseId = String(formData.get('knowledgeBaseId') ?? '');
  try {
    const manifest = parseObject(String(formData.get('manifest') ?? ''), 'Manifest');
    const files = parseObject(String(formData.get('files') ?? ''), 'Files');
    const textFiles: Record<string, string> = {};
    for (const [name, content] of Object.entries(files)) {
      if (typeof content !== 'string') throw new Error(`File ${name} must be a string.`);
      textFiles[name] = content;
    }
    const result = await installAppExtension(token, knowledgeBaseId, {
      manifest,
      files: textFiles,
      source: String(formData.get('source') ?? '').trim() || 'upload',
    });
    if (!result.ok) back(knowledgeBaseId, result.detail);
  } catch (error) {
    back(
      knowledgeBaseId,
      error instanceof Error ? error.message : 'The package could not be read.',
    );
  }
  redirect(`/knowledge-bases/${knowledgeBaseId}/extensions`);
}

export async function toggleExtensionAction(formData: FormData): Promise<void> {
  const token = await readSessionToken();
  if (!token) redirect('/login');
  const knowledgeBaseId = String(formData.get('knowledgeBaseId') ?? '');
  const installationId = String(formData.get('installationId') ?? '');
  const enabled = String(formData.get('enabled') ?? '') === 'true';
  const result = await setAppExtensionEnabled(token, knowledgeBaseId, installationId, enabled);
  if (!result.ok) back(knowledgeBaseId, result.detail);
  redirect(`/knowledge-bases/${knowledgeBaseId}/extensions`);
}

export async function removeExtensionAction(formData: FormData): Promise<void> {
  const token = await readSessionToken();
  if (!token) redirect('/login');
  const knowledgeBaseId = String(formData.get('knowledgeBaseId') ?? '');
  const installationId = String(formData.get('installationId') ?? '');
  const result = await removeAppExtension(token, knowledgeBaseId, installationId);
  if (!result.ok) back(knowledgeBaseId, result.detail);
  redirect(`/knowledge-bases/${knowledgeBaseId}/extensions`);
}
