// Generiert /tmp/advice-seed.sql aus prisma/advice-seed.ts.
// Lokal ausfuehren mit `tsx scripts/generate-advice-sql.ts`, dann
// per scp auf VPS und mit psql laden.

import { ADVICE_SEED } from "../prisma/advice-seed";
import { writeFileSync } from "node:fs";

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

const lines = [
  "-- Auto-generated. Idempotent: nur einfuegen wenn Tabelle leer.",
  "DO $$",
  "BEGIN",
  '  IF (SELECT COUNT(*) FROM "Advice") = 0 THEN',
];

for (const a of ADVICE_SEED) {
  lines.push(
    `    INSERT INTO "Advice" (text, category, source) VALUES ('${esc(a.text)}', '${esc(a.category)}', 'Kevin Kelly — Excellent Advice for Living');`,
  );
}

lines.push("  END IF;");
lines.push("END $$;");

const sql = lines.join("\n");
writeFileSync("/tmp/advice-seed.sql", sql);
console.log(`Wrote /tmp/advice-seed.sql with ${ADVICE_SEED.length} entries`);
