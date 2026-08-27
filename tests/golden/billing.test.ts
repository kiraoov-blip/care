// CARE 요금 계산 함수 골든 검증.
//
// lib/tariff.ts (TS 이관본)가 legacy/streamlit_app_actual_tou_v30.py 를
// golden/golden_capture.py 로 캡처한 golden/care-reference.json(=이 저장소의
// 단일 정답지)과 정확히 같은 결과를 내는지 대조한다. PRAS-DER 저장소의
// tests/golden/verify.mjs 와 같은 목적·같은 원칙: "값이 다르면 무조건 실패",
// 허용오차 없음(둘 다 정수 계산이므로).
//
// 실행: npx tsx tests/golden/billing.test.ts (또는 npm run test:golden)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  residentialBill,
  touBill,
  subscriptionBill,
  inverseSubscriptionBill,
  residentialBaseEnergy,
  billComponentBreakdown,
  roundHalfUp,
  truncateWon,
  truncate10Won,
  billedKwh,
  PLAN_DEFAULTS,
} from "../../lib/tariff.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(__dirname, "..", "..", "golden", "care-reference.json");
const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf-8"));

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, actual: number, expected: number) {
  const ok = Object.is(actual, expected) || Math.abs(actual - expected) < 1e-9;
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

// ── 1. billing_cases: residential_bill / tou_bill ─────────────────────
for (const c of golden.billing_cases) {
  check(
    `residential_bill(${c.kwh}, ${c.month})`,
    residentialBill(c.kwh, c.month),
    c.residential_won
  );
  check(
    `tou_bill(${c.kwh}, ${c.month}, .35,.35,.30)`,
    touBill(c.kwh, c.month, 0.35, 0.35, 0.3),
    c.tou_won_default_share
  );
}

// ── 2. subscription_cases ──────────────────────────────────────────────
for (const c of golden.subscription_cases) {
  const plan = PLAN_DEFAULTS[c.plan];
  check(
    `subscription_bill(${c.usage_kwh}, ${plan.fee}, ${plan.included}, ${c.overage_rate})`,
    subscriptionBill(c.usage_kwh, plan.fee, plan.included, c.overage_rate),
    c.bill_won
  );
}

// ── 3. inverse_subscription_cases ──────────────────────────────────────
for (const c of golden.inverse_subscription_cases) {
  const plan = PLAN_DEFAULTS[c.plan];
  check(
    `inverse_subscription_bill(${c.target_bill}, ${plan.fee}, ${plan.included}, ${c.overage_rate})`,
    inverseSubscriptionBill(c.target_bill, plan.fee, plan.included, c.overage_rate),
    c.max_kwh
  );
}

// ── 4. residential_component_breakdown ─────────────────────────────────
for (const c of golden.residential_component_breakdown) {
  const { basic, energy } = residentialBaseEnergy(c.kwh, c.month);
  const actual = billComponentBreakdown(basic, energy, c.kwh) as unknown as Record<
    string,
    number
  >;
  for (const [key, expected] of Object.entries(c.breakdown as Record<string, number>)) {
    check(`breakdown(${c.kwh}, ${c.month}).${key}`, actual[key], expected);
  }
}

// ── 5. rounding_cases ────────────────────────────────────────────────
// golden(=JSON.parse 결과)은 any 이지만, any를 그대로 Object.entries에 넘기면
// TS가 값 타입을 unknown으로 추론해 아래 check() 호출에서 타입 오류가 난다.
// 대조 대상이 전부 { [값]: number } 형태임을 명시적으로 캐스팅해 알려준다.
const r = golden.rounding_cases as Record<string, Record<string, number>>;
for (const [k, expected] of Object.entries(r.round_half_up)) {
  check(`round_half_up(${k})`, roundHalfUp(Number(k)), expected);
}
for (const [k, expected] of Object.entries(r.truncate_won)) {
  check(`truncate_won(${k})`, truncateWon(Number(k)), expected);
}
for (const [k, expected] of Object.entries(r.truncate_10won)) {
  check(`truncate_10won(${k})`, truncate10Won(Number(k)), expected);
}
for (const [k, expected] of Object.entries(r.billed_kwh)) {
  check(`billed_kwh(${k})`, billedKwh(Number(k)), expected);
}

console.log(`\n통과: ${pass}, 실패: ${fail}`);
if (failures.length) {
  console.log("\n--- 실패 목록 ---");
  for (const f of failures.slice(0, 50)) console.log(f);
  if (failures.length > 50) console.log(`... 외 ${failures.length - 50}건`);
  process.exit(1);
} else {
  console.log("전체 일치 — Stage 1(요금·구독 계산) 골든 검증 통과");
}
