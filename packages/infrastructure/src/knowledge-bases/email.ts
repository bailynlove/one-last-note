import type { KnowledgeBaseEmailSender } from '@oln/application';

interface EmailLogger {
  info(details: unknown, message: string): void;
}

export interface KnowledgeBaseEmailSenderOptions {
  apiKey?: string;
  from: string;
  logger: EmailLogger;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function createKnowledgeBaseEmailSender({
  apiKey,
  from,
  logger,
}: KnowledgeBaseEmailSenderOptions): KnowledgeBaseEmailSender {
  if (!apiKey) {
    return {
      async sendInvitation({ to, url }) {
        logger.info({ to, url }, 'knowledge base invitation email (delivery not configured)');
      },
    };
  }

  return {
    async sendInvitation({ to, knowledgeBaseName, role, url }) {
      const name = escapeHtml(knowledgeBaseName);
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: `Join ${knowledgeBaseName} on one last note`,
          text: `You have been invited to ${knowledgeBaseName} as a ${role}.\n\nAccept the invitation:\n\n${url}\n\nThis invitation expires in 7 days.`,
          html: `<p>You have been invited to <strong>${name}</strong> as a ${role}.</p><p><a href="${url}">Accept the invitation</a></p><p>This invitation expires in 7 days.</p>`,
        }),
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        throw new Error(`Resend rejected the email (${response.status})`);
      }
    },
  };
}
