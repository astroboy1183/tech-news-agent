/**
 * Slack delivery.
 *
 * A webhook post, deliberately: a Slack app would need OAuth, a token store
 * and a redirect URL for something whose entire job is "put a message in one
 * channel once a day". The webhook URL is the only credential and it is a
 * secret on the Worker.
 *
 * Dormant until SLACK_WEBHOOK_URL is set, like the summarizer — a delivery
 * channel nobody configured is not an error.
 */

import type { Digest } from "./digest.server";

export class NoWebhook extends Error {}

/** Slack renders at most 50 blocks and truncates text at 3000 characters. */
const MAX_BLOCKS = 48;

function escapeMrkdwn(text: string): string {
  // Slack's mrkdwn only requires these three; over-escaping mangles headlines.
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function link(url: string, label: string): string {
  return `<${url}|${escapeMrkdwn(label)}>`;
}

type Block = Record<string, unknown>;

export function renderDigestBlocks(digest: Digest, origin: string): Block[] {
  const blocks: Block[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Tech News — ${digest.date}`, emoji: false },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${digest.counts.stories} stories · ${digest.counts.corroborated} covered by more than one outlet`,
        },
      ],
    },
  ];

  if (digest.lead) {
    const lead = digest.lead;
    const body = lead.summary ?? lead.excerpt ?? "";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${link(`${origin}/story/${lead.id}`, lead.headline)}*${
          body ? `\n${escapeMrkdwn(body.slice(0, 600))}` : ""
        }${lead.sourceCount > 1 ? `\n_${lead.sourceCount} outlets_` : ""}`,
      },
    });
  }

  for (const block of digest.sections) {
    if (blocks.length >= MAX_BLOCKS - 1) break;
    const lines = block.stories
      .map((s) => {
        const target = s.sourceCount > 1 || s.summary ? `${origin}/story/${s.id}` : s.url;
        const badge = s.sourceCount > 1 ? ` _(${s.sourceCount} outlets)_` : "";
        return `• ${link(target, s.headline)}${badge}`;
      })
      .join("\n");

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${escapeMrkdwn(block.label)}*\n${lines.slice(0, 2800)}` },
    });
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `<${origin}|Read the full front page>` }],
  });

  return blocks;
}

export async function deliverToSlack(
  env: Env,
  digest: Digest,
  origin: string,
): Promise<{ delivered: boolean; status: number }> {
  const webhook = (env as unknown as { SLACK_WEBHOOK_URL?: string }).SLACK_WEBHOOK_URL;
  if (!webhook) throw new NoWebhook("SLACK_WEBHOOK_URL is not set");

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: `Tech News — ${digest.date}: ${digest.counts.stories} stories`,
      blocks: renderDigestBlocks(digest, origin),
    }),
  });

  return { delivered: response.ok, status: response.status };
}
