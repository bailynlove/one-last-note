'use client';

import { useActionState } from 'react';
import { createTokenAction, type TokenFormState } from './actions';

const initial: TokenFormState = {};

export function AgentTokenForm() {
  const [state, action, pending] = useActionState(createTokenAction, initial);
  return (
    <form action={action} className="form">
      <label>
        Name
        <input name="name" required maxLength={80} placeholder="Research agent" />
      </label>
      <fieldset>
        <legend>Scopes</legend>
        <label className="checkboxRow">
          <input type="checkbox" name="scopes" value="read" defaultChecked /> Read Knowledge Bases,
          Notes and annotations
        </label>
        <label className="checkboxRow">
          <input type="checkbox" name="scopes" value="write" /> Write Notes, Comments, Marks,
          Relations and Trash
        </label>
      </fieldset>
      <button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create Agent token'}
      </button>
      {state.error ? (
        <p className="formError" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.token ? (
        <div className="tokenReveal">
          <p>Copy this token now. It will not be shown again.</p>
          <code>{state.token}</code>
        </div>
      ) : null}
    </form>
  );
}
