'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAgentToken, revokeAgentToken } from '../../../lib/agent-tokens';
import { readSessionToken } from '../../../lib/session';

export interface TokenFormState {
  token?: string;
  error?: string;
}

export async function createTokenAction(
  _previous: TokenFormState,
  formData: FormData,
): Promise<TokenFormState> {
  const session = await readSessionToken();
  if (!session) redirect('/login');
  const name = String(formData.get('name') ?? '').trim();
  const scopes = formData
    .getAll('scopes')
    .map(String)
    .filter((scope) => scope === 'read' || scope === 'write');
  if (!name) return { error: 'Name the Agent token.' };
  if (scopes.length === 0) return { error: 'Choose at least one scope.' };
  try {
    const created = await createAgentToken(session, { name, scopes });
    revalidatePath('/settings/agent-tokens');
    return { token: created.token };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not create Agent token.' };
  }
}

export async function revokeTokenAction(formData: FormData): Promise<void> {
  const session = await readSessionToken();
  if (!session) redirect('/login');
  const id = String(formData.get('id') ?? '');
  if (id) await revokeAgentToken(session, id);
  revalidatePath('/settings/agent-tokens');
}
