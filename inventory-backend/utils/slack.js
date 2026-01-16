// utils/slack.js
export async function sendSlackAlert({ text, blocks }) {
  if (!process.env.SLACK_WEBHOOK_URL) return;

  const enabled = (process.env.SLACK_ALERTS_ENABLED || "true") === "true";
  if (!enabled) return;

  const payload = blocks ? { blocks } : { text };

  const res = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack webhook failed: ${res.status} ${body}`);
  }
}
