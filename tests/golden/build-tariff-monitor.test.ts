// CARE build_tariff_monitor(원본 L800~833, "연간 전체"/"월중 모니터링" 요금 모니터링
// 최종 테이블) 골든 검증.
//
// lib/tariff-monitor.ts 의 buildAnnualMonitor/buildMonthlyMonitor 가
// data/customers.json + data/clusters.json(enrichScores 입력) + data/monthly.json
// (이미 배포된 정적 데이터)과, golden/care-reference.json 에만 있는 4명 표본의
// daily 이력을 합쳐 원본과 정확히 같은 결과를 내는지 대조한다.
//
// "연간 전체" 분기는 monthly만 있으면 계산되므로 712명 전원 × 2개년을 전부 대조하고,
// "월중 모니터링" 분기는 daily 전체(52만행)가 아직 정적 JSON으로 배포되지 않아
// golden 캡처에 함께 실어둔 표본 4명분만 대조한다(README의 "아직 남은 것" 참고).
//
// 실행: npx tsx tests/golden/build-tariff-monitor.test.ts (또는 npm run test:golden)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { enrichScores, type CustomerRow, type ClusterWideRow, type EnrichedCustomer } from "../../lib/enrich.ts";
import {
  buildAnnualMonitor,
  buildMonthlyMonitor,
  type MonthlyRow,
} from "../../lib/tariff-monitor.ts";
import type { DailyRow } from "../../lib/forecast.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");

const golden = JSON.parse(readFileSync(path.join(ROOT, "golden", "care-reference.json"), "utf-8"));
const customers: CustomerRow[] = JSON.parse(readFileSync(path.join(ROOT, "data", "customers.json"), "utf-8"));
const clusters = JSON.parse(readFileSync(path.join(ROOT, "data", "clusters.json"), "utf-8"));
const clusterWide: ClusterWideRow[] = clusters.wide;
const monthly: MonthlyRow[] = JSON.parse(readFileSync(path.join(ROOT, "data", "monthly.json"), "utf-8"));

const FEE = { basicFee: 84_900, basicInc: 450, premiumFee: 249_000, premiumInc: 1_000, overage: 300 };

let pass = 0;
let fail = 0;
const failures: string[] = [];

function deepClose(a: unknown, b: unknown, tol = 1e-6): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Object.is(a, b) || Math.abs(a - b) < tol;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepClose(v, b[i], tol));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object).sort();
    const bk = Object.keys(b as object).sort();
    if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
    return ak.every((k) => deepClose((a as any)[k], (b as any)[k], tol));
  }
  return a === b;
}

function check(label: string, actual: unknown, expected: unknown) {
  if (deepClose(actual, expected)) {
    pass++;
  } else {
    fail++;
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const c = golden.build_tariff_monitor_cases;

// ── cluster_col 매핑이 원본과 같은지 확인(코드 주석의 전제를 명시적으로 검증) ──
check("cluster_col[2024]", "2024군집", c.cluster_col["2024"]);
check("cluster_col[2025]", "2025군집", c.cluster_col["2025"]);

// ── enriched customers 맵 구성 (Stage 3와 동일 방식) ──
const enriched = enrichScores(customers, clusterWide);
const enrichedByCid = new Map<string, EnrichedCustomer>(enriched.map((e) => [e.고객ID, e]));

function sortByCid<T extends { 고객ID: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.고객ID < b.고객ID ? -1 : a.고객ID > b.고객ID ? 1 : 0));
}

// ── 1. "연간 전체" 분기 — 712명 × 2개년 전부 ──
for (const year of [2024, 2025] as const) {
  const result = sortByCid(buildAnnualMonitor(monthly, enrichedByCid, year, FEE));
  const expected = c.annual[String(year)];
  check(`buildAnnualMonitor(${year}) row count`, result.length, expected.length);
  for (let i = 0; i < Math.min(result.length, expected.length); i++) {
    check(`buildAnnualMonitor(${year})[${i}](${expected[i]?.고객ID})`, result[i], expected[i]);
  }
}

// ── 2. "월중 모니터링" 분기 — 표본 4명, 2025-07, cutoff=20, 두 요금제 기준 각각 ──
const customerDaily = new Map<string, DailyRow[]>();
for (const cid of c.monthly_sample_customer_ids as string[]) {
  customerDaily.set(cid, c.monthly_sample_daily_rows[cid]);
}

for (const plan of ["기본형", "프리미엄형"] as const) {
  const result = sortByCid(
    buildMonthlyMonitor(customerDaily, monthly, enrichedByCid, 2025, 7, 20, plan, FEE)
  );
  const expected = c.monthly[plan];
  check(`buildMonthlyMonitor(${plan}) row count`, result.length, expected.length);
  for (let i = 0; i < Math.min(result.length, expected.length); i++) {
    check(`buildMonthlyMonitor(${plan})[${i}](${expected[i]?.고객ID})`, result[i], expected[i]);
  }
}

console.log(`\n통과: ${pass}, 실패: ${fail}`);
if (failures.length) {
  console.log("\n--- 실패 목록(최대 50건) ---");
  for (const f of failures.slice(0, 50)) console.log(f);
  if (failures.length > 50) console.log(`... 외 ${failures.length - 50}건`);
  process.exit(1);
} else {
  console.log("전체 일치 — build_tariff_monitor(Stage 3 후속) 이관 골든 검증 통과");
}
