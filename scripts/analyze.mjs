// Sends the computed metrics (plus yesterday's report, for continuity) to Claude and writes
// public/data/insights.json. Claude only writes the commentary; every number comes from fetch.mjs.
//
// Env: ANTHROPIC_API_KEY, optional CLAUDE_MODEL.
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { DATA_DIR, HISTORY_DIR, readJson, writeJson } from './lib.mjs';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

const GameInsight = z.object({
  id: z.string().describe('The game id from the metrics'),
  status: z.enum(['good', 'watch', 'problem']),
  summary: z.string().describe('2-3 sentences on how the game is doing this week'),
  highlights: z.array(z.string()).describe('What went well, each with the number that shows it'),
  concerns: z.array(z.string()).describe('What looks wrong or risky, each with the number that shows it'),
  actions: z.array(z.string()).describe('Concrete next steps for the developer, most important first'),
});

const Insights = z.object({
  headline: z.string().describe('One sentence: the single most important thing today'),
  overview: z.string().describe('2-4 sentences across all games'),
  games: z.array(GameInsight),
  watchNext: z.array(z.string()).describe('Things to check in tomorrow’s data'),
});

const SYSTEM = `You are the analytics lead for a small mobile game studio that makes casual and hybrid-casual puzzle games.
Each day you receive Firebase Analytics (GA4) metrics for every live game and write a short report for the developers.

How to read the data:
- All numbers are pre-computed and exact. Quote them; never invent, extrapolate or re-total figures that are not given.
- "last7" is the 7 days ending yesterday; "prev7" is the 7 days before that. Compare them for week-over-week change.
- GA4 can revise the most recent day for up to ~48 hours, so treat a sudden drop on the last day alone with caution.
- Retention d1/d7 are weighted averages over daily install cohorts (0.32 = 32%). Cohorts with fewer than ~50 users are noisy; say so.
- Revenue is in the property's currency. adRevenue is 0 when AdMob is not linked to that Firebase project; mention that only once if it matters.
- Event names are the game's own analytics events (e.g. level_complete, level_fail). Use them to spot difficulty spikes, broken funnels or features nobody uses.
- If a game has "ok": false or warnings, report what failed so the developer can fix the setup.

How to write:
- Be direct and specific, like a colleague in a stand-up. No filler, no generic advice ("keep monitoring").
- Every highlight and concern cites the number behind it.
- Actions are things a developer can do this week (tune a level, check a version, link AdMob, fix an event).
- status: "good" = growing or stable with healthy retention; "watch" = something slipping; "problem" = a sharp drop, broken data or a clear bug.
- If yesterday's report is provided, say whether its concerns improved or got worse instead of repeating them.`;

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    // Not fatal: the numbers still update every day; only Claude's written report is skipped.
    console.warn('ANTHROPIC_API_KEY is not set: skipping the written report (numbers are still updated).');
    return;
  }
  const metrics = readJson(join(DATA_DIR, 'metrics.json'));
  const previous = readJson(join(DATA_DIR, 'insights.json'), null);

  // Yesterday's report is useful context, unless it was the demo placeholder.
  const prior = previous && !previous.demo ? { generatedAt: previous.generatedAt, ...previous.report } : null;

  const user = [
    `Today's metrics (period ends ${metrics.periodEnd}):`,
    '```json',
    JSON.stringify(metrics.games),
    '```',
    prior ? `\nYesterday's report:\n\`\`\`json\n${JSON.stringify(prior)}\n\`\`\`` : '\nThere is no earlier report.',
    '\nWrite today’s report. Include one entry in "games" for every game in the metrics, using its id.',
  ].join('\n');

  const client = new Anthropic();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: zodOutputFormat(Insights) },
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  });

  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw new Error(`Claude returned no report (stop_reason: ${response.stop_reason}).`);
  }

  const insights = {
    generatedAt: new Date().toISOString(),
    periodEnd: metrics.periodEnd,
    model: MODEL,
    demo: false,
    report: response.parsed_output,
  };
  writeJson(join(DATA_DIR, 'insights.json'), insights);
  writeJson(join(HISTORY_DIR, `${metrics.periodEnd}.json`), insights);
  const u = response.usage;
  console.log(`Wrote insights.json with ${MODEL} (${u.input_tokens} in / ${u.output_tokens} out tokens)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
