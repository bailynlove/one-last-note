export async function notifyFailure(event: string, error: unknown): Promise<void> {
  const url = process.env.BACKUP_ALERT_WEBHOOK_URL;
  if (!url) return;
  const message = error instanceof Error ? error.message : String(error);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event, message, at: new Date().toISOString() }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // A failed alert must not hide the original backup/restore failure.
  }
}
