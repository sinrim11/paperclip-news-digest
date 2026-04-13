/**
 * Slack webhook notification helper.
 * Sends a message to SLACK_WEBHOOK_URL if configured; silently skips otherwise.
 */

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

export async function sendSlack(text: string): Promise<void> {
  if (!SLACK_WEBHOOK_URL) return;
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error('[slack] Failed to send notification:', err);
  }
}
