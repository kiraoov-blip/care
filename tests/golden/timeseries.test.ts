// CARE daily.json/profiles.json 압축 인코딩 + profileForCustomer/aggregatePortfolioProfile
// (lib/timeseries.ts) 골든 검증.
//
// 1) 디코더가 export_data.py의 압축 인코딩을 원본과 정확히 같은 값으로 복원하는지
//    (golden/golden_capture.py가 export_data.py를 거치지 않고 원본 daily/profiles
//    DataFrame에서 독립적으로 다시 뽑은 timeseries_integrity_cases와 대조).
// 2) forecastMonthLongitudinal이 이 디코더가 만든 DailyRow[]를 입력받아도 기존
//    forecast_month_longitudinal_cases(Stage 2)와 같은 결과를 내는지(같은 표본
//    고객이라 골든이 이미 갖고 있는 기대값을 그대로 재사용한다).
// 3) profileForCustomer/aggregatePortfolioProfile가 golden의 profile_for_customer_cases/
//    aggregate_portfolio_profile_cases와 같은 결과를 내는지.
//
// 실행: npx tsx tests/golden/timeseries.test.ts (또는 npm run test:golden)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  decodeCustomerDaily,
  profileForCustomer,
  aggregatePortfolioProfile,
  type DailyDataset,
  type ProfilesDataset,
  type Season,
} from "../../lib/timeseries.ts";
import { forecastMonthLongitudinal } from "../../lib/forecast.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");

const golden = JSON.parse(readFileSync(path.join(ROOT, "golden", "care-reference.json"), "utf-8"));
const dailyDataset: DailyDataset = JSON.parse(readFileSync(path.join(ROOT, "data", "daily.json"), "utf-8"));
const profilesDataset: ProfilesDataset = JSON.parse(readFileSync(path.join(ROOT, "data", "profiles.json"), "utf-8"));

let pass = 0;
let fail = 0;
const failures: string[] = [];

function deepClose(a: unknown, b: unknown, tol: number): boolean {
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

function check(label: string, actual: unknown, expected: unknown, tol = 1e-6) {
  if (deepClose(actual, expected, tol)) {
    pass++;
  } else {
    fail++;
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const t = golden.timeseries_integrity_cases;

// ── 1. 날짜축·dayTypeConst 확인 ──
check("dates.length", dailyDataset.dates.length, t.date_count);
check("dates first3", dailyDataset.dates.slice(0, 3), t.dates_first3);
check("dates last3", dailyDataset.dates.slice(-3), t.dates_last3);
check("dayTypeConst", [dailyDataset.dayTypeConst], t.daily_daytype_unique);

// ── 2. daily.json 디코딩이 원본과 정확히 같은지(표본 4명) ──
for (const cid of t.sample_customer_ids as string[]) {
  const decoded = decodeCustomerDaily(dailyDataset, cid);
  const usage = decoded.map((r) => r.일사용량_kWh);
  check(`daily(${cid}) usage array`, usage, t.daily_by_customer[cid], 0);
  // 요일/월 정보도 같은 길이인지만 빠르게 확인(값 자체는 forecastMonthLongitudinal
  // 재실행 검증에서 간접적으로 확인된다).
  check(`daily(${cid}) row count`, decoded.length, t.daily_by_customer[cid].length);
}

// ── 3. profiles.json 원본 배열이 골든과 정확히 같은지(표본 4명, 소수 3자리 반올림 기준) ──
for (const cid of t.sample_customer_ids as string[]) {
  check(`profiles(${cid}) raw array`, profilesDataset.customers[cid], t.profiles_by_customer[cid], 0);
}

// ── 4. forecastMonthLongitudinal이 압축 인코딩을 통해서도 Stage 2와 같은 결과를 내는지 ──
for (const c of golden.forecast_month_longitudinal_cases) {
  const decoded = decodeCustomerDaily(dailyDataset, c.customer_id);
  for (const f of c.forecasts) {
    const result = forecastMonthLongitudinal(decoded, f.year, f.month, f.cutoff_day);
    check(`forecastMonthLongitudinal via daily.json(${c.customer_id},${f.year}-${f.month})`, result, f.result);
  }
}

// ── 5. profileForCustomer ──
// profiles.json은 소수 3자리로 반올림해 저장했으므로(용량 문제 — lib/timeseries.ts
// 주석 참고), 반올림 전 원본으로 계산한 골든값과는 반올림 폭의 절반(0.0005)을 넘지
// 않는 오차가 생길 수 있다. 그 한도 안에서 대조한다.
for (const c of golden.profile_for_customer_cases) {
  const result = profileForCustomer(profilesDataset, c.customer_id, c.year, c.season as Season, c.daytype);
  check(
    `profileForCustomer(${c.customer_id},${c.year},${c.season},${c.daytype})`,
    result,
    c.result,
    6e-4
  );
}

// ── 6. aggregatePortfolioProfile ──
for (const c of golden.aggregate_portfolio_profile_cases) {
  const result = aggregatePortfolioProfile(
    profilesDataset,
    c.customer_ids as string[],
    c.year,
    c.season as Season,
    c.daytype
  );
  check(
    `aggregatePortfolioProfile(${c.year},${c.season},${c.daytype})`,
    result,
    c.result,
    (c.customer_ids as string[]).length * 6e-4
  );
}

console.log(`\n통과: ${pass}, 실패: ${fail}`);
if (failures.length) {
  console.log("\n--- 실패 목록(최대 50건) ---");
  for (const f of failures.slice(0, 50)) console.log(f);
  if (failures.length > 50) console.log(`... 외 ${failures.length - 50}건`);
  process.exit(1);
} else {
  console.log("전체 일치 — daily/profiles 압축 인코딩 + profileForCustomer/aggregatePortfolioProfile 골든 검증 통과");
}
