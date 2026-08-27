// CARE 패턴안정성점수·수요관리우선점수·구조변화신호(enrich_scores) 골든 검증.
//
// lib/enrich.ts 가 data/customers.json + data/clusters.json(둘 다
// scripts/export_data.py 가 Python에서 미리 뽑아둔 정적 데이터)을 입력으로
// golden/care-reference.json 의 clustering_and_enrich_full 섹션(712명 전원)과
// 정확히 같은 결과를 내는지 대조한다.
//
// 실행: npx tsx tests/golden/enrich.test.ts (또는 npm run test:golden)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { enrichScores, type CustomerRow, type ClusterWideRow } from "../../lib/enrich.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");

const golden = JSON.parse(readFileSync(path.join(ROOT, "golden", "care-reference.json"), "utf-8"));
const customers: CustomerRow[] = JSON.parse(readFileSync(path.join(ROOT, "data", "customers.json"), "utf-8"));
const clusters = JSON.parse(readFileSync(path.join(ROOT, "data", "clusters.json"), "utf-8"));
const clusterWide: ClusterWideRow[] = clusters.wide;

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown, tol = 1e-4) {
  const ok =
    typeof actual === "number" && typeof expected === "number"
      ? Object.is(actual, expected) || Math.abs(actual - expected) < tol
      : actual === expected;
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const c = golden.clustering_and_enrich_full;

// ── 0. 순서 확인: customers.json 행 순서가 골든의 enriched_고객ID_order와 같아야
//    이후 인덱스 대조가 의미 있다 (enrich_scores는 left-merge라 순서를 보존한다) ──
check("customers.json row order matches golden", customers.map((c) => c.고객ID).join(","), (c as any).enriched_고객ID_order.join(","));

// ── 1. wide(고객×연도별 군집) 데이터가 export_data.py 산출물과 일치 ──
check("clusters.json wide row count", clusterWide.length, c.wide_full.length);
{
  const byId = new Map(clusterWide.map((w) => [w.고객ID, w]));
  for (const g of c.wide_full as any[]) {
    const w = byId.get(g.고객ID);
    check(`wide(${g.고객ID}).2024군집`, w?.["2024군집"], g["2024군집"]);
    check(`wide(${g.고객ID}).2025군집`, w?.["2025군집"], g["2025군집"]);
    check(`wide(${g.고객ID}).군집유지여부`, w?.군집유지여부, g.군집유지여부);
  }
}

// ── 2. enrichScores 실행 결과 대조 (712명 전원) ──
const enriched = enrichScores(customers, clusterWide);
check("enriched row count", enriched.length, c.enriched_패턴안정성점수_all.length);

for (let i = 0; i < enriched.length; i++) {
  check(`enriched[${i}].패턴안정성점수 (${enriched[i].고객ID})`, enriched[i].패턴안정성점수, c.enriched_패턴안정성점수_all[i]);
  check(`enriched[${i}].수요관리우선점수 (${enriched[i].고객ID})`, enriched[i].수요관리우선점수, c.enriched_수요관리우선점수_all[i]);
  check(`enriched[${i}].구조변화신호 (${enriched[i].고객ID})`, enriched[i].구조변화신호, c.enriched_구조변화신호_all[i]);
}

console.log(`\n통과: ${pass}, 실패: ${fail}`);
if (failures.length) {
  console.log("\n--- 실패 목록(최대 50건) ---");
  for (const f of failures.slice(0, 50)) console.log(f);
  if (failures.length > 50) console.log(`... 외 ${failures.length - 50}건`);
  process.exit(1);
} else {
  console.log("전체 일치 — Stage 3(패턴안정성·수요관리우선점수 이관) 골든 검증 통과");
}
