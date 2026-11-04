import type { EmailSender } from '@oln/application';

interface EmailLogger {
  info(details: unknown, message: string): void;
}

export interface MagicLinkEmailSenderOptions {
  apiKey?: string;
  from: string;
  logger: EmailLogger;
}

export function createMagicLinkEmailSender({
  apiKey,
  from,
  logger,
}: MagicLinkEmailSenderOptions): EmailSender {
  if (!apiKey) {
    return {
      async sendMagicLink({ to, url }) {
        logger.info({ to, url }, 'magic link email (delivery not configured)');
      },
    };
  }

  return {
    async sendMagicLink({ to, url }) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: 'Sign in to one last note',
          text: `Open this link to sign in to one last note:\n\n${url}\n\nThis link expires in 15 minutes and can only be used once.`,
          html: `<p>Open this link to sign in to one last note:</p><p><a href="${url}">Sign in</a></p><p>This link expires in 15 minutes and can only be used once.</p>`,
        }),
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        throw new Error(`Resend rejected the email (${response.status})`);
      }
    },
  };
}
