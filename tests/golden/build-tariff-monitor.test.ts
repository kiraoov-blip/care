// CARE build_tariff_monitor(원본 L800~833, "연간 전체"/"월중 모니터링" 요금 모니터링
// 최종 테이블) 골든 검증.
//
// lib/tariff-monitor.ts 의 buildAnnualMonitor/buildMonthlyMonitor 가
// data/customers.json + data/clusters.json(enrichScores 입력) + data/monthly.json +
// data/daily.json(모두 이미 배포된 정적 데이터)만으로 원본과 정확히 같은 결과를
// 내는지 대조한다.
//
// "연간 전체"/"월중 모니터링" 두 분기 모두 712명 전원을 대조한다 — data/daily.json이
// 이번 업데이트부터 52만행 전체를 압축 인코딩해 배포하므로(scripts/export_data.py,
// lib/timeseries.ts), 예전처럼 표본 몇 명만 검증할 필요가 없어졌다.
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
import { decodeAllCustomerDaily, type DailyDataset } from "../../lib/timeseries.ts";
import type { DailyRow } from "../../lib/forecast.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");

const golden = JSON.parse(readFileSync(path.join(ROOT, "golden", "care-reference.json"), "utf-8"));
const customers: CustomerRow[] = JSON.parse(readFileSync(path.join(ROOT, "data", "customers.json"), "utf-8"));
const clusters = JSON.parse(readFileSync(path.join(ROOT, "data", "clusters.json"), "utf-8"));
const clusterWide: ClusterWideRow[] = clusters.wide;
const monthly: MonthlyRow[] = JSON.parse(readFileSync(path.join(ROOT, "data", "monthly.json"), "utf-8"));
const dailyDataset: DailyDataset = JSON.parse(readFileSync(path.join(ROOT, "data", "daily.json"), "utf-8"));

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

// ── 2. "월중 모니터링" 분기 — 712명 전원, 2025-07, cutoff=20, 두 요금제 기준 각각 ──
const customerDaily: Map<string, DailyRow[]> = decodeAllCustomerDaily(dailyDataset);

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
