/**
 * Recurring community threads, which are not news and must never cluster.
 *
 * Reddit and forum feeds carry standing furniture: a weekly self-promotion
 * thread, a daily discussion, a "who's hiring" post. Two of them from
 * different communities are word-for-word alike — r/MachineLearning's
 * "[D] Self-Promotion Thread" and r/devops's "Weekly Self Promotion Thread"
 * scored 0.943 against each other, higher than almost every real pair of
 * articles about the same event.
 *
 * No threshold can separate that, because by every measure available they
 * *are* the same headline. What makes them different is that they are not
 * about anything: the same title returns next week meaning something else.
 *
 * So they are excluded from matching altogether. They still collect and still
 * appear — a reader may well want r/devops's thread — they simply never join
 * or seed a cluster.
 */

const PATTERNS: RegExp[] = [
  /\bmega ?thread\b/i,
  /\bself[-\s]?promotion\b/i,
  /\b(daily|weekly|monthly|sunday|monday|friday)\s+\w*\s*(thread|discussion|papers|roundup)\b/i,
  /\b(discussion|question|hiring|showcase|promotion)\s+thread\b/i,
  /\bwho(?:'s| is)\s+hiring\b/i,
  /\bwhat are you working on\b/i,
  /\b(simple|stupid|no) questions\b/i,
  /\bfree talk\b/i,
  /^\s*\[?\s*(d|discussion)\s*\]?\s*$/i,
];

/** True when a headline is standing furniture rather than a story. */
export function isBoilerplate(title: string): boolean {
  return PATTERNS.some((pattern) => pattern.test(title));
}
