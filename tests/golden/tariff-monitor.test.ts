// CARE 요금 모니터링 + 당월 사용량 예측 골든 검증.
//
// lib/tariff-monitor.ts, lib/forecast.ts 가 legacy/streamlit_app_actual_tou_v30.py 를
// golden/golden_capture.py 로 캡처한 golden/care-reference.json 의 Stage 2 섹션과
// 정확히 같은 결과를 내는지 대조한다.
//
// 실행: npx tsx tests/golden/tariff-monitor.test.ts (또는 npm run test:golden)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  monthlyBillMap,
  annualBillMap,
  billForPlan,
  inverseBillForPlan,
  tariffComparisonTable,
  dynamicTariffAnalysis,
  PLAN_ORDER,
  type PlanName,
  type MonthlyRow,
} from "../../lib/tariff-monitor.ts";
import { forecastMonthLongitudinal, alertLevel, type DailyRow } from "../../lib/forecast.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(__dirname, "..", "..", "golden", "care-reference.json");
const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf-8"));

const FEE = { basicFee: 84_900, basicInc: 450, premiumFee: 249_000, premiumInc: 1_000, overage: 300 };

let pass = 0;
let fail = 0;
const failures: string[] = [];

// 부동소수 연산 순서 차이(합산 순서 등)로 인한 마지막 자리 오차를 허용하는
// 재귀 비교. 원본이 정수 연산(반올림/절사)을 거친 값은 애초에 오차가 없고,
// 여기서 오차가 나는 값은 두 가지뿐이다.
//   1) 순수 부동소수 누적합(forecast 예측치) — 통상 1e-9 수준.
//   2) 이 테스트 파일이 golden_capture.py 를 거치지 않고 legacy CSV를 직접
//      다시 파싱하는 dynamic_tariff_analysis 섹션에서, pandas의 기본 CSV
//      실수 파서(xstrtod, float_precision 미지정)가 정확반올림 파서와 최대
//      1ULP 어긋나는 값이 드물게 있고, 이게 원 단위 반올림 경계(x.5)에 걸리면
//      1원 차이로 나타난다(17,088행 중 70행, 0.4%). 실제 이관 파이프라인은
//      Python(pandas)이 export한 JSON을 그대로 쓰므로 이 문제가 생기지
//      않는다 — 이 테스트만의 파싱 방식 때문에 생기는 것이라 1원 허용오차를 둔다.
function makeDeepClose(tol: number) {
  const deepClose = (a: unknown, b: unknown): boolean => {
    if (typeof a === "number" && typeof b === "number") {
      return Object.is(a, b) || Math.abs(a - b) < tol;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((v, i) => deepClose(v, b[i]));
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      const ak = Object.keys(a as object).sort();
      const bk = Object.keys(b as object).sort();
      if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
      return ak.every((k) => deepClose((a as any)[k], (b as any)[k]));
    }
    return a === b;
  };
  return deepClose;
}

const deepClose = makeDeepClose(1e-6);
// annual_summary 전용: 아래 5절 주석 참고 — 이 테스트만의 CSV 재파싱 방식 때문에
// 생기는 최대 1원 수준의 pandas 파서 오차를 흡수한다.
const deepCloseWon = makeDeepClose(1.5);

function check(label: string, actual: unknown, expected: unknown, close = deepClose) {
  if (close(actual, expected)) {
    pass++;
  } else {
    fail++;
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── 1. monthly_bill_map_cases ──────────────────────────────────────────
for (const c of golden.monthly_bill_map_cases) {
  const row: MonthlyRow = {
    고객ID: c.customer_id,
    연도: c.year,
    월: c.month,
    사용량_kWh: c.usage_kwh,
    경부하비중: c.off_share,
    중간부하비중: c.mid_share,
    최대부하비중: c.peak_share,
  };
  const bills = monthlyBillMap(c.usage_kwh, c.month, row, FEE);
  for (const [plan, expected] of Object.entries(c.bills as Record<string, number>)) {
    check(`monthlyBillMap(${c.customer_id},${c.month}).${plan}`, bills[plan as PlanName], expected);
  }
}

// ── 2. annual_bill_map_cases ────────────────────────────────────────────
{
  const rowsByCustomerYear = new Map<string, MonthlyRow[]>();
  for (const c of golden.monthly_bill_map_cases) {
    const key = `${c.customer_id}|${c.year}`;
    const row: MonthlyRow = {
      고객ID: c.customer_id,
      연도: c.year,
      월: c.month,
      사용량_kWh: c.usage_kwh,
      경부하비중: c.off_share,
      중간부하비중: c.mid_share,
      최대부하비중: c.peak_share,
    };
    if (!rowsByCustomerYear.has(key)) rowsByCustomerYear.set(key, []);
    rowsByCustomerYear.get(key)!.push(row);
  }
  for (const c of golden.annual_bill_map_cases) {
    const rows = rowsByCustomerYear.get(`${c.customer_id}|${c.year}`) ?? [];
    const totals = annualBillMap(rows, FEE);
    for (const [plan, expected] of Object.entries(c.totals as Record<string, number>)) {
      check(`annualBillMap(${c.customer_id},${c.year}).${plan}`, totals[plan as PlanName], expected);
    }
  }
}

// ── 3. bill_for_plan_cases / inverse_bill_for_plan_cases ────────────────
// 두 케이스 모두 legacy monthly.iloc[0](첫 행)의 경부하/중간부하/최대부하 비중을 쓴다.
const firstMonthlyRow: MonthlyRow = (() => {
  const c = golden.monthly_bill_map_cases[0];
  return {
    고객ID: c.customer_id,
    연도: c.year,
    월: c.month,
    사용량_kWh: c.usage_kwh,
    경부하비중: c.off_share,
    중간부하비중: c.mid_share,
    최대부하비중: c.peak_share,
  };
})();

for (const c of golden.bill_for_plan_cases) {
  check(
    `billForPlan(${c.plan},${c.usage_kwh})`,
    billForPlan(c.plan as PlanName, c.usage_kwh, c.month, firstMonthlyRow, FEE),
    c.bill_won
  );
}

for (const c of golden.inverse_bill_for_plan_cases) {
  check(
    `inverseBillForPlan(${c.plan},${c.target_bill})`,
    inverseBillForPlan(c.target_bill, c.plan as PlanName, c.month, firstMonthlyRow, FEE),
    c.max_kwh
  );
}

// ── 4. tariff_comparison_table_cases ────────────────────────────────────
for (const c of golden.tariff_comparison_table_cases) {
  const table = tariffComparisonTable(c.bills as Record<string, number>, c.current_plan);
  check(
    `tariffComparisonTable(${c.customer_id},${c.current_plan}) row count`,
    table.length,
    (c.table as unknown[]).length
  );
  for (let i = 0; i < table.length; i++) {
    check(`tariffComparisonTable(${c.customer_id},${c.current_plan})[${i}]`, table[i], c.table[i]);
  }
}

// ── 5. dynamic_tariff_analysis_digest ───────────────────────────────────
{
  // golden 캡처는 monthly_bill_map_cases 처럼 일부 고객만 담고 있지 않고
  // 원본이 실제로 쓴 전체 monthly 테이블을 그대로 다시 로드해야 하므로,
  // 이 섹션은 골든 캡처 시점에 사용된 전체 monthly 데이터가 legacy/matched_monthly.csv.gz
  // 안에 그대로 있다는 전제로, 이 테스트 파일과 같은 리포지토리 안의 legacy 원본 CSV를
  // 직접 읽어 대조한다(별도의 CSV 파서 없이 최소 구현).
  const csvPath = path.join(__dirname, "..", "..", "legacy", "matched_monthly.csv.gz");
  const digest = golden.dynamic_tariff_analysis_digest;
  try {
    const zlib = await import("node:zlib");
    const gz = readFileSync(csvPath);
    const csv = zlib.gunzipSync(gz).toString("utf-8");
    const lines = csv.trim().split(/\r?\n/);
    const header = lines[0].split(",");
    const idx = (name: string) => header.indexOf(name);
    const monthly: MonthlyRow[] = lines.slice(1).map((line) => {
      const cells = line.split(",");
      return {
        고객ID: cells[idx("고객ID")],
        연도: Number(cells[idx("연도")]),
        월: Number(cells[idx("월")]),
        사용량_kWh: Number(cells[idx("사용량_kWh")]),
        경부하비중: Number(cells[idx("경부하비중")]),
        중간부하비중: Number(cells[idx("중간부하비중")]),
        최대부하비중: Number(cells[idx("최대부하비중")]),
      };
    });
    const result = dynamicTariffAnalysis(monthly, FEE);

    check("dynamicTariffAnalysis monthly_customer row count", result.monthlyCustomer.length, digest.monthly_customer_row_count);
    check("dynamicTariffAnalysis annual_customer row count", result.annualCustomer.length, digest.annual_customer_row_count);
    check("dynamicTariffAnalysis monthly_summary row count", result.monthlySummary.length, digest.monthly_summary_row_count);
    check("dynamicTariffAnalysis annual_stability", result.annualStability, digest.annual_stability);
    check("dynamicTariffAnalysis monthly_stability", result.monthlyStability, digest.monthly_stability);

    for (let i = 0; i < digest.monthly_customer_first5.length; i++) {
      check(`dynamicTariffAnalysis monthly_customer[${i}]`, result.monthlyCustomer[i], digest.monthly_customer_first5[i]);
    }
    for (let i = 0; i < digest.annual_customer_first5.length; i++) {
      check(`dynamicTariffAnalysis annual_customer[${i}]`, result.annualCustomer[i], digest.annual_customer_first5[i]);
    }
    check("dynamicTariffAnalysis annual_summary", result.annualSummary, digest.annual_summary, deepCloseWon);
    check("dynamicTariffAnalysis annual_transition", result.annualTransition, digest.annual_transition);
    for (let i = 0; i < digest.monthly_summary_first5.length; i++) {
      check(`dynamicTariffAnalysis monthly_summary[${i}]`, result.monthlySummary[i], digest.monthly_summary_first5[i]);
    }
  } catch (e) {
    fail++;
    failures.push(`dynamicTariffAnalysis section threw: ${(e as Error).message}`);
  }
}

// ── 6. alert_level_cases ────────────────────────────────────────────────
for (const c of golden.alert_level_cases) {
  check(`alertLevel(${c.current},${c.forecast},${c.included})`, alertLevel(c.current, c.forecast, c.included), c.level);
}

// ── 7. forecast_month_longitudinal_cases ────────────────────────────────
for (const c of golden.forecast_month_longitudinal_cases) {
  const customerDaily: DailyRow[] = c.customer_daily_rows;
  for (const f of c.forecasts) {
    const result = forecastMonthLongitudinal(customerDaily, f.year, f.month, f.cutoff_day);
    check(`forecastMonthLongitudinal(${c.customer_id},${f.year}-${f.month},cutoff${f.cutoff_day})`, result, f.result);
  }
}

console.log(`\n통과: ${pass}, 실패: ${fail}`);
if (failures.length) {
  console.log("\n--- 실패 목록 ---");
  for (const f of failures.slice(0, 50)) console.log(f);
  if (failures.length > 50) console.log(`... 외 ${failures.length - 50}건`);
  process.exit(1);
} else {
  console.log("전체 일치 — Stage 2(요금 모니터링·사용량 예측) 골든 검증 통과");
}
