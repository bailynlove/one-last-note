import { loadWebConfig } from '@oln/config';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { fetchSessionUser } from '../../../lib/auth';
import {
  getKnowledgeBase,
  listInvitations,
  listJoinLinks,
  listMembers,
  type Member,
  pendingOwnershipTransfer,
} from '../../../lib/knowledge-bases';
import { readSessionToken } from '../../../lib/session';
import styles from '../../workspace.module.css';
import {
  cancelOwnershipTransferAction,
  changeRoleAction,
  createJoinLinkAction,
  inviteAction,
  removeMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
  revokeJoinLinkAction,
  transferOwnershipAction,
  updateKnowledgeBaseAction,
} from '../actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const token = await readSessionToken();
  if (!token) {
    return { title: 'Knowledge Base' };
  }
  const { id } = await params;
  const result = await getKnowledgeBase(token, id);
  return { title: result.ok ? result.data.name : 'Knowledge Base' };
}

export default async function KnowledgeBasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = await readSessionToken();
  const { id } = await params;
  if (!token) {
    redirect(`/login?next=/knowledge-bases/${id}`);
  }
  const query = await searchParams;
  const [access, currentUser] = await Promise.all([
    getKnowledgeBase(token, id),
    fetchSessionUser(token),
  ]);
  if (!access.ok) {
    if (access.status === 404) {
      notFound();
    }
    return (
      <main className={styles.page}>
        <p className={`${styles.notice} ${styles.error}`}>{access.detail}</p>
      </main>
    );
  }

  const knowledgeBase = access.data;
  const members = await listMembers(token, id);
  if (!members.ok) {
    return (
      <main className={styles.page}>
        <p className={`${styles.notice} ${styles.error}`}>{members.detail}</p>
      </main>
    );
  }

  const canManage = knowledgeBase.role === 'owner' || knowledgeBase.role === 'manager';
  const isOwner = knowledgeBase.role === 'owner';
  const [invitations, joinLinks, pendingTransfer] = await Promise.all([
    canManage ? listInvitations(token, id) : Promise.resolve(null),
    isOwner ? listJoinLinks(token, id) : Promise.resolve(null),
    isOwner ? pendingOwnershipTransfer(token, id) : Promise.resolve(null),
  ]);
  const managers = members.data.filter((member) => member.role === 'manager');
  const joinToken = (await cookies()).get('oln_join_preview')?.value ?? null;
  const transferId =
    typeof query.transferId === 'string'
      ? query.transferId
      : pendingTransfer?.ok
        ? (pendingTransfer.data?.id ?? null)
        : null;
  const transferTargetId = pendingTransfer?.ok ? pendingTransfer.data?.toUserId : null;
  const transferTarget = transferTargetId
    ? members.data.find((member) => member.userId === transferTargetId)
    : null;
  const config = loadWebConfig();
  const joinUrl = joinToken ? new URL(`/join/${joinToken}`, config.WEB_APP_URL).toString() : null;

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <a className={styles.brand} href="/">
          one last note
        </a>
        <div className={styles.identity}>
          <a className={styles.textButton} href="/">
            All Knowledge Bases
          </a>
          <span className={styles.role}>{knowledgeBase.role}</span>
        </div>
      </div>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <p className={styles.sidebarHeading}>This Knowledge Base</p>
          <ul className={styles.kbList}>
            <li>
              <a
                className={`${styles.kbLink} ${styles.kbLinkActive}`}
                href={`/knowledge-bases/${id}`}
              >
                Overview
              </a>
            </li>
            <li>
              <a className={styles.kbLink} href={`/knowledge-bases/${id}#members`}>
                Members
              </a>
            </li>
            {canManage ? (
              <li>
                <a className={styles.kbLink} href={`/knowledge-bases/${id}#invitations`}>
                  Invitations
                </a>
              </li>
            ) : null}
            {isOwner ? (
              <li>
                <a className={styles.kbLink} href={`/knowledge-bases/${id}#join-links`}>
                  Join links
                </a>
              </li>
            ) : null}
          </ul>
        </aside>

        <section className={styles.main}>
          <h1 className={styles.heading}>{knowledgeBase.name}</h1>
          <p className={styles.lede}>{knowledgeBase.description || 'No description yet.'}</p>

          {typeof query.error === 'string' ? (
            <p className={`${styles.notice} ${styles.error}`}>{query.error}</p>
          ) : null}
          {typeof query.saved === 'string' ? <p className={styles.notice}>Saved.</p> : null}

          {joinUrl && isOwner ? (
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Join link created</h2>
                <span className={styles.badge}>share it</span>
              </div>
              <p className={styles.empty}>
                Anyone signed in who opens this link can join with the role you chose. Revoke it
                below when it has served its purpose.
              </p>
              <code className={styles.code}>{joinUrl}</code>
            </section>
          ) : null}

          {transferId ? (
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Ownership transfer started</h2>
                <span className={styles.badge}>awaiting manager</span>
              </div>
              <p className={styles.empty}>
                {transferTarget
                  ? `Send this link to ${transferTarget.displayName}. Ownership changes only after they accept.`
                  : 'Send this link to the Manager. Ownership changes only after they accept.'}
              </p>
              <code className={styles.code}>
                {new URL(`/ownership-transfers/${transferId}`, config.WEB_APP_URL).toString()}
              </code>
              <form action={cancelOwnershipTransferAction} style={{ marginTop: 12 }}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="transferId" value={transferId} />
                <button
                  className={`${styles.buttonSecondary} ${styles.buttonDanger}`}
                  type="submit"
                >
                  Cancel transfer
                </button>
              </form>
            </section>
          ) : null}

          {isOwner ? (
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Settings</h2>
                <span className={styles.badge}>Owner</span>
              </div>
              <form action={updateKnowledgeBaseAction} className={styles.form}>
                <input type="hidden" name="id" value={id} />
                <label className={styles.field}>
                  Name
                  <input
                    className={styles.input}
                    name="name"
                    defaultValue={knowledgeBase.name}
                    maxLength={120}
                    required
                  />
                </label>
                <label className={styles.field}>
                  Description
                  <textarea
                    className={styles.textarea}
                    name="description"
                    defaultValue={knowledgeBase.description ?? ''}
                    maxLength={1000}
                  />
                </label>
                <div>
                  <button className={styles.button} type="submit">
                    Save settings
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          <section className={styles.card} id="members">
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Members</h2>
              <span className={styles.badge}>{members.data.length}</span>
            </div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Role</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.data.map((member: Member) => {
                  const canChange = isOwner && member.role !== 'owner';
                  const isSelf = member.userId === currentUser?.id;
                  const canRemove =
                    member.role !== 'owner' &&
                    (isOwner ||
                      (knowledgeBase.role === 'manager' && member.role === 'viewer') ||
                      isSelf);
                  return (
                    <tr key={member.userId}>
                      <td>
                        <strong>{member.displayName}</strong>
                        <div className={styles.muted}>{member.email}</div>
                      </td>
                      <td>
                        {canChange ? (
                          <form action={changeRoleAction} className={styles.inlineForm}>
                            <input type="hidden" name="id" value={id} />
                            <input type="hidden" name="userId" value={member.userId} />
                            <select
                              className={styles.select}
                              name="role"
                              defaultValue={member.role}
                            >
                              <option value="manager">Manager</option>
                              <option value="viewer">Viewer</option>
                            </select>
                            <button className={styles.buttonSecondary} type="submit">
                              Update
                            </button>
                          </form>
                        ) : (
                          <span className={styles.role}>{member.role}</span>
                        )}
                      </td>
                      <td>
                        {canRemove ? (
                          <form action={removeMemberAction}>
                            <input type="hidden" name="id" value={id} />
                            <input type="hidden" name="userId" value={member.userId} />
                            <button
                              className={`${styles.buttonSecondary} ${styles.buttonDanger}`}
                              type="submit"
                            >
                              Remove
                            </button>
                          </form>
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {canManage ? (
            <section className={styles.card} id="invitations">
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Invitations</h2>
                <span className={styles.badge}>email</span>
              </div>
              <form action={inviteAction} className={`${styles.inlineForm} ${styles.form}`}>
                <input type="hidden" name="id" value={id} />
                <label className={styles.field} style={{ flex: '1 1 220px' }}>
                  Email
                  <input className={styles.input} name="email" type="email" required />
                </label>
                <label className={styles.field}>
                  Role
                  <select className={styles.select} name="role" defaultValue="viewer">
                    <option value="viewer">Viewer</option>
                    {isOwner ? <option value="manager">Manager</option> : null}
                  </select>
                </label>
                <button className={styles.button} type="submit">
                  Send invitation
                </button>
              </form>

              {invitations?.ok && invitations.data.length > 0 ? (
                <table className={styles.table} style={{ marginTop: 18 }}>
                  <thead>
                    <tr>
                      <th scope="col">Email</th>
                      <th scope="col">Role</th>
                      <th scope="col">Expires</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invitations.data.map((invitation) => (
                      <tr key={invitation.id}>
                        <td>{invitation.email}</td>
                        <td className={styles.role}>{invitation.role}</td>
                        <td className={styles.muted}>
                          {new Date(invitation.expiresAt).toLocaleDateString()}
                        </td>
                        <td>
                          <div className={styles.actions}>
                            <form action={resendInvitationAction}>
                              <input type="hidden" name="id" value={id} />
                              <input type="hidden" name="invitationId" value={invitation.id} />
                              <button className={styles.buttonSecondary} type="submit">
                                Resend
                              </button>
                            </form>
                            <form action={revokeInvitationAction}>
                              <input type="hidden" name="id" value={id} />
                              <input type="hidden" name="invitationId" value={invitation.id} />
                              <button
                                className={`${styles.buttonSecondary} ${styles.buttonDanger}`}
                                type="submit"
                              >
                                Revoke
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className={styles.empty} style={{ marginTop: 16 }}>
                  No pending invitations.
                </p>
              )}
            </section>
          ) : null}

          {isOwner ? (
            <section className={styles.card} id="join-links">
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Join links</h2>
                <span className={styles.badge}>Owner</span>
              </div>
              <p className={styles.empty}>
                A join link can be used more than once until it expires or you revoke it.
              </p>
              <form action={createJoinLinkAction} className={`${styles.inlineForm} ${styles.form}`}>
                <input type="hidden" name="id" value={id} />
                <label className={styles.field}>
                  Role
                  <select className={styles.select} name="role" defaultValue="viewer">
                    <option value="viewer">Viewer</option>
                    <option value="manager">Manager</option>
                  </select>
                </label>
                <label className={styles.field}>
                  Expires in days
                  <input
                    className={styles.input}
                    name="expiresInDays"
                    type="number"
                    min={1}
                    max={30}
                    defaultValue={7}
                  />
                </label>
                <button className={styles.button} type="submit">
                  Create link
                </button>
              </form>

              {joinLinks?.ok && joinLinks.data.length > 0 ? (
                <table className={styles.table} style={{ marginTop: 18 }}>
                  <thead>
                    <tr>
                      <th scope="col">Role</th>
                      <th scope="col">Expires</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {joinLinks.data.map((link) => (
                      <tr key={link.id}>
                        <td className={styles.role}>{link.role}</td>
                        <td className={styles.muted}>
                          {new Date(link.expiresAt).toLocaleDateString()}
                        </td>
                        <td>
                          <form action={revokeJoinLinkAction}>
                            <input type="hidden" name="id" value={id} />
                            <input type="hidden" name="joinLinkId" value={link.id} />
                            <button
                              className={`${styles.buttonSecondary} ${styles.buttonDanger}`}
                              type="submit"
                            >
                              Revoke
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className={styles.empty} style={{ marginTop: 16 }}>
                  No active join links.
                </p>
              )}
            </section>
          ) : null}

          {isOwner && managers.length > 0 ? (
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Transfer ownership</h2>
                <span className={styles.badge}>Owner only</span>
              </div>
              <p className={styles.empty}>
                Choose a Manager. They become Owner only after accepting; you become a Manager.
              </p>
              <form action={transferOwnershipAction} className={styles.inlineForm}>
                <input type="hidden" name="id" value={id} />
                <select
                  className={styles.select}
                  name="toUserId"
                  defaultValue={managers[0]?.userId}
                >
                  {managers.map((manager) => (
                    <option key={manager.userId} value={manager.userId}>
                      {manager.displayName} ({manager.email})
                    </option>
                  ))}
                </select>
                <button className={styles.button} type="submit">
                  Start transfer
                </button>
              </form>
            </section>
          ) : null}
        </section>
      </div>
    </main>
  );
}
