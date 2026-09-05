#!/usr/bin/env bash
# Dump the largest multi-source clusters with their member headlines, so a
# human can check for false merges. This is the v0.3.0 ship criterion:
# 30 spot-checks, no story wrongly folded into another.
set -euo pipefail
LIMIT="${1:-30}"
npx wrangler d1 execute tech-news --remote --json --command "
  SELECT c.id, c.section, c.source_count, c.velocity, ROUND(c.score,1) AS score,
         (SELECT GROUP_CONCAT(s.name || ' :: ' || a.title, char(10))
            FROM articles a JOIN sources s ON s.id = a.source_id
           WHERE a.cluster_id = c.id) AS members
    FROM clusters c
   WHERE c.source_count > 1
   ORDER BY c.source_count DESC, c.score DESC
   LIMIT ${LIMIT}" 2>/dev/null | python3 -c "
import json,sys
rows = json.load(sys.stdin)[0]['results']
if not rows:
    print('no multi-source clusters yet'); raise SystemExit
for r in rows:
    print(f\"── cluster {r['id']}  [{r['section']}]  {r['source_count']} sources  \"
          f\"velocity {r['velocity']:.1f}/h  score {r['score']}\")
    for line in (r['members'] or '').split(chr(10)):
        print('   ', line)
    print()
print(f'{len(rows)} clusters shown')
"
