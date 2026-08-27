/**
 * CARE 요금 모니터링(월별/연간 추천요금제) 로직의 TypeScript 이관.
 *
 * 원본: legacy/streamlit_app_actual_tou_v30.py (라인 667~797 부근의
 * monthly_bill_map / annual_bill_map / bill_for_plan / inverse_bill_for_plan /
 * tariff_comparison_table, 그리고 라인 696~759의 dynamic_tariff_analysis).
 *
 * dynamic_tariff_analysis는 원본에서 pandas groupby/pivot을 쓰는데, pandas의
 * groupby(sort=True 기본값) 는 그룹 키를 항상 정렬해서 반환한다. 이 파일도
 * 같은 정렬 규칙(고객ID 오름차순, 연도 오름차순, 요금제명 오름차순 문자열 비교)을
 * 그대로 지켜서 행 순서까지 원본과 일치시킨다 — 값뿐 아니라 순서도
 * tests/golden/tariff-monitor.test.ts 가 골든 기준값과 대조한다.
 *
 * build_tariff_monitor(원본 L800~833)는 이관하지 않았다: "그룹" 컬럼과
 * 패턴안정성점수·수요관리우선점수가 Stage 3(enrich_scores, 군집분석 이관)의
 * 산출물이라 아직 존재하지 않기 때문이다. Stage 3 완료 후 이어서 포팅한다.
 */

import { residentialBill, touBill, subscriptionBill, TOU_CONTRACT_KW } from "./tariff";

export const PLAN_ORDER = ["일반 주택용(저압)", "제주 TOU", "구독 기본형", "구독 프리미엄형"] as const;
export type PlanName = (typeof PLAN_ORDER)[number];

export const PLAN_BILL_COLUMNS: Record<PlanName, string> = {
  "일반 주택용(저압)": "일반주택용(원)",
  "제주 TOU": "제주TOU(원)",
  "구독 기본형": "기본형(원)",
  "구독 프리미엄형": "프리미엄형(원)",
};

const BILL_COLS = PLAN_ORDER.map((p) => PLAN_BILL_COLUMNS[p]);
const COL_TO_PLAN: Record<string, PlanName> = Object.fromEntries(
  PLAN_ORDER.map((p) => [PLAN_BILL_COLUMNS[p], p])
) as Record<string, PlanName>;

export interface MonthlyRow {
  고객ID: string;
  연도: number;
  월: number;
  사용량_kWh: number;
  경부하_kWh?: number;
  중간부하_kWh?: number;
  최대부하_kWh?: number;
  경부하비중: number;
  중간부하비중: number;
  최대부하비중: number;
}

interface FeeParams {
  basicFee: number;
  basicInc: number;
  premiumFee: number;
  premiumInc: number;
  overage: number;
}

// ── monthly_bill_map (L667~674) ───────────────────────────────────────
export function monthlyBillMap(
  usage: number,
  month: number,
  monthlyRow: Pick<MonthlyRow, "경부하비중" | "중간부하비중" | "최대부하비중">,
  fee: FeeParams
): Record<PlanName, number> {
  return {
    "일반 주택용(저압)": residentialBill(usage, month),
    "제주 TOU": touBill(
      usage,
      month,
      monthlyRow.경부하비중,
      monthlyRow.중간부하비중,
      monthlyRow.최대부하비중,
      TOU_CONTRACT_KW
    ),
    "구독 기본형": subscriptionBill(usage, fee.basicFee, fee.basicInc, fee.overage),
    "구독 프리미엄형": subscriptionBill(usage, fee.premiumFee, fee.premiumInc, fee.overage),
  };
}

// 파이썬 min(dict, key=dict.get) 과 동일: 동률이면 PLAN_ORDER상 먼저 나오는 쪽.
function cheapestPlan(bills: Record<PlanName, number>): PlanName {
  let best: PlanName = PLAN_ORDER[0];
  for (const p of PLAN_ORDER) if (bills[p] < bills[best]) best = p;
  return best;
}

// ── annual_bill_map (L677~683) ────────────────────────────────────────
export function annualBillMap(
  customerMonthly: MonthlyRow[],
  fee: FeeParams
): Record<PlanName, number> {
  const totals: Record<PlanName, number> = {
    "일반 주택용(저압)": 0,
    "제주 TOU": 0,
    "구독 기본형": 0,
    "구독 프리미엄형": 0,
  };
  const sorted = [...customerMonthly].sort((a, b) => a.월 - b.월);
  for (const r of sorted) {
    const b = monthlyBillMap(r.사용량_kWh, r.월, r, fee);
    for (const p of PLAN_ORDER) totals[p] += b[p];
  }
  return totals;
}

// ── bill_for_plan / inverse_bill_for_plan (L762~781) ───────────────────
export function billForPlan(
  plan: PlanName,
  usage: number,
  month: number,
  monthlyRow: Pick<MonthlyRow, "경부하비중" | "중간부하비중" | "최대부하비중">,
  fee: FeeParams
): number {
  return monthlyBillMap(usage, month, monthlyRow, fee)[plan];
}

export function inverseBillForPlan(
  targetBill: number,
  plan: PlanName,
  month: number,
  monthlyRow: Pick<MonthlyRow, "경부하비중" | "중간부하비중" | "최대부하비중">,
  fee: FeeParams
): number {
  const target = Math.max(targetBill, 0.0);
  // 연료비·기후환경요금과 세금·기금까지 포함한 최종 청구액을 기준으로 모든 요금제를 수치적으로 역산함.
  let lo = 0.0;
  let hi = 2_000.0;
  while (billForPlan(plan, hi, month, monthlyRow, fee) < target && hi < 50_000) {
    hi *= 2;
  }
  for (let i = 0; i < 70; i++) {
    const mid = (lo + hi) / 2;
    if (billForPlan(plan, mid, month, monthlyRow, fee) <= target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

// ── tariff_comparison_table (L784~797) ─────────────────────────────────
export interface TariffComparisonRow {
  요금제: string;
  "월말 예상요금(원)": number;
  "현재요금제 대비 차이(원)": number;
  "최저요금 대비 차이(원)": number;
  판정: string;
}

export function tariffComparisonTable(
  bills: Record<string, number>,
  currentPlan: string
): TariffComparisonRow[] {
  const entries = Object.entries(bills);
  let cheapest = entries[0][0];
  for (const [k, v] of entries) if (v < bills[cheapest]) cheapest = k;
  const currentBill = bills[currentPlan];
  const minimumBill = bills[cheapest];
  const rows: TariffComparisonRow[] = entries.map(([plan, value]) => ({
    요금제: plan,
    "월말 예상요금(원)": value,
    "현재요금제 대비 차이(원)": value - currentBill,
    "최저요금 대비 차이(원)": value - minimumBill,
    판정: plan === currentPlan ? "현재 적용" : plan === cheapest ? "추천" : "비교",
  }));
  rows.sort((a, b) => a["월말 예상요금(원)"] - b["월말 예상요금(원)"]);
  return rows;
}

// ── dynamic_tariff_analysis (L696~759) ─────────────────────────────────
export interface MonthlyCustomerRow {
  고객ID: string;
  연도: number;
  월: number;
  "사용량(kWh)": number;
  "일반주택용(원)": number;
  "제주TOU(원)": number;
  "기본형(원)": number;
  "프리미엄형(원)": number;
  월별추천요금제: PlanName;
  "월별최저요금(원)": number;
  연간추천요금제: PlanName;
  "월·연간추천일치": "일치" | "상이";
}

export interface AnnualCustomerRow {
  고객ID: string;
  연도: number;
  "일반주택용(원)": number;
  "제주TOU(원)": number;
  "기본형(원)": number;
  "프리미엄형(원)": number;
  "연간사용량(kWh)": number;
  "월평균사용량(kWh)": number;
  연간추천요금제: PlanName;
  "연간최저요금(원)": number;
  "연간TOU대비절감(원)": number;
}

export interface AnnualSummaryRow {
  연도: string;
  요금제: PlanName;
  "고객당평균연간요금(원)": number;
  "고객당중앙연간요금(원)": number;
  "고객당평균월요금(원)": number;
  "고객당중앙월요금(원)": number;
  연간추천고객수: number;
  "연간추천비중(%)": number;
}

export interface AnnualTransitionRow {
  "2024 연간추천": string;
  "2025 연간추천": string;
  고객수: number;
  "2024 추천군 내 비중(%)": number;
}

export interface MonthlySummaryRow {
  연도: number;
  월: number;
  요금제: PlanName;
  월별추천고객수: number;
  "월별추천비중(%)": number;
}

export interface DynamicTariffResult {
  monthlyCustomer: MonthlyCustomerRow[];
  annualCustomer: AnnualCustomerRow[];
  annualSummary: AnnualSummaryRow[];
  annualTransition: AnnualTransitionRow[];
  annualStability: number;
  monthlyStability: number;
  monthlySummary: MonthlySummaryRow[];
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// 문자열 비교: pandas(Python)의 코드포인트 비교와 JS 기본 문자열 비교(UTF-16 코드유닛)는
// 이 데이터에 나오는 한글(전부 기본 다국어 평면, BMP) 범위에서 결과가 같다.
function strCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function dynamicTariffAnalysis(monthly: MonthlyRow[], fee: FeeParams): DynamicTariffResult {
  // ── monthly_customer: 원본 순서 그대로(정렬 없음) ──
  const monthlyCustomer: Omit<MonthlyCustomerRow, "연간추천요금제" | "월·연간추천일치">[] =
    monthly.map((r) => {
      const bills = monthlyBillMap(r.사용량_kWh, r.월, r, fee);
      const rec = cheapestPlan(bills);
      return {
        고객ID: r.고객ID,
        연도: r.연도,
        월: r.월,
        "사용량(kWh)": r.사용량_kWh,
        "일반주택용(원)": bills["일반 주택용(저압)"],
        "제주TOU(원)": bills["제주 TOU"],
        "기본형(원)": bills["구독 기본형"],
        "프리미엄형(원)": bills["구독 프리미엄형"],
        월별추천요금제: rec,
        "월별최저요금(원)": bills[rec],
      };
    });

  // ── annual = groupby(["고객ID","연도"], sort=True) 합계 ──
  // pandas groupby 기본값은 그룹 키를 정렬해서 반환하므로, (고객ID, 연도) 오름차순으로 집계한다.
  const annualMap = new Map<string, AnnualCustomerRow & { __sumUsage: number }>();
  for (const r of monthlyCustomer) {
    const key = `${r.고객ID} ${r.연도}`;
    let a = annualMap.get(key);
    if (!a) {
      a = {
        고객ID: r.고객ID,
        연도: r.연도,
        "일반주택용(원)": 0,
        "제주TOU(원)": 0,
        "기본형(원)": 0,
        "프리미엄형(원)": 0,
        "연간사용량(kWh)": 0,
        "월평균사용량(kWh)": 0,
        연간추천요금제: PLAN_ORDER[0],
        "연간최저요금(원)": 0,
        "연간TOU대비절감(원)": 0,
        __sumUsage: 0,
      };
      annualMap.set(key, a);
    }
    a["일반주택용(원)"] += r["일반주택용(원)"];
    a["제주TOU(원)"] += r["제주TOU(원)"];
    a["기본형(원)"] += r["기본형(원)"];
    a["프리미엄형(원)"] += r["프리미엄형(원)"];
    a.__sumUsage += r["사용량(kWh)"];
  }
  const annual = [...annualMap.values()].sort(
    (a, b) => strCompare(a.고객ID, b.고객ID) || a.연도 - b.연도
  );
  for (const a of annual) {
    a["연간사용량(kWh)"] = a.__sumUsage;
    a["월평균사용량(kWh)"] = a.__sumUsage / 12.0;
    // idxmin(axis=1): 동률이면 BILL_COLS(=PLAN_ORDER) 순서상 먼저 나오는 컬럼.
    let bestCol = BILL_COLS[0];
    for (const c of BILL_COLS) if ((a as any)[c] < (a as any)[bestCol]) bestCol = c;
    a.연간추천요금제 = COL_TO_PLAN[bestCol];
    a["연간최저요금(원)"] = (a as any)[bestCol];
    a["연간TOU대비절감(원)"] = Math.max(a["제주TOU(원)"] - a["연간최저요금(원)"], 0);
    delete (a as any).__sumUsage;
  }

  // ── monthly_customer 완성: annual의 연간추천요금제 merge + 일치 여부 ──
  const annualRecByKey = new Map<string, PlanName>();
  for (const a of annual) annualRecByKey.set(`${a.고객ID} ${a.연도}`, a.연간추천요금제);
  const monthlyCustomerFull: MonthlyCustomerRow[] = monthlyCustomer.map((r) => {
    const annualRec = annualRecByKey.get(`${r.고객ID} ${r.연도}`) as PlanName;
    return {
      ...r,
      연간추천요금제: annualRec,
      "월·연간추천일치": r.월별추천요금제 === annualRec ? "일치" : "상이",
    };
  });

  // ── annual_summary: 연도별 × PLAN_ORDER별 집계 ──
  const years = [...new Set(annual.map((a) => a.연도))].sort((a, b) => a - b);
  const annualSummary: AnnualSummaryRow[] = [];
  for (const year of years) {
    const g = annual.filter((a) => a.연도 === year);
    for (const plan of PLAN_ORDER) {
      const col = PLAN_BILL_COLUMNS[plan];
      const vals = g.map((a) => (a as any)[col] as number);
      const count = g.filter((a) => a.연간추천요금제 === plan).length;
      annualSummary.push({
        연도: String(year),
        요금제: plan,
        "고객당평균연간요금(원)": mean(vals),
        "고객당중앙연간요금(원)": median(vals),
        "고객당평균월요금(원)": mean(vals.map((v) => v / 12.0)),
        "고객당중앙월요금(원)": median(vals.map((v) => v / 12.0)),
        연간추천고객수: count,
        "연간추천비중(%)": (count / Math.max(g.length, 1)) * 100,
      });
    }
  }

  // ── annual_wide(pivot) 없이 바로 연도별 추천요금제 맵 구성 (712명 전원이
  //    2024/2025 모두 존재한다는 이 데이터셋의 전제 위에서 pivot과 동치) ──
  const byCustomer = new Map<string, Map<number, PlanName>>();
  for (const a of annual) {
    if (!byCustomer.has(a.고객ID)) byCustomer.set(a.고객ID, new Map());
    byCustomer.get(a.고객ID)!.set(a.연도, a.연간추천요금제);
  }
  let stableCount = 0;
  const allCustomerIds = [...byCustomer.keys()];
  const transitionCounts = new Map<string, { rec2024: string; rec2025: string; count: number }>();
  for (const cid of allCustomerIds) {
    const m = byCustomer.get(cid)!;
    const r2024 = m.get(2024);
    const r2025 = m.get(2025);
    if (r2024 !== undefined && r2025 !== undefined) {
      if (r2024 === r2025) stableCount++;
      const key = `${r2024} ${r2025}`;
      const existing = transitionCounts.get(key);
      if (existing) existing.count++;
      else transitionCounts.set(key, { rec2024: r2024, rec2025: r2025, count: 1 });
    }
    // 2024/2025 중 하나라도 없으면 pandas의 NaN==NaN → False 와 동일하게 "불안정"으로 집계(가산 없음).
  }
  const annualStability = allCustomerIds.length > 0 ? stableCount / allCustomerIds.length : NaN;

  const denomByRec2024 = new Map<string, number>();
  for (const t of transitionCounts.values()) {
    denomByRec2024.set(t.rec2024, (denomByRec2024.get(t.rec2024) ?? 0) + t.count);
  }
  const annualTransition: AnnualTransitionRow[] = [...transitionCounts.values()]
    .sort((a, b) => strCompare(a.rec2024, b.rec2024) || strCompare(a.rec2025, b.rec2025))
    .map((t) => ({
      "2024 연간추천": t.rec2024,
      "2025 연간추천": t.rec2025,
      고객수: t.count,
      "2024 추천군 내 비중(%)": (t.count / (denomByRec2024.get(t.rec2024) ?? 1)) * 100,
    }));

  // ── monthly_summary: (연도 오름차순 × 월 1~12 × PLAN_ORDER) 전 조합, 0으로 채움 ──
  const monthlyCountByKey = new Map<string, number>();
  for (const r of monthlyCustomerFull) {
    const key = `${r.연도} ${r.월} ${r.월별추천요금제}`;
    monthlyCountByKey.set(key, (monthlyCountByKey.get(key) ?? 0) + 1);
  }
  const uniqueCustomerCount = new Set(monthlyCustomerFull.map((r) => r.고객ID)).size;
  const monthlySummary: MonthlySummaryRow[] = [];
  const monthlyYears = [...new Set(monthlyCustomerFull.map((r) => r.연도))].sort((a, b) => a - b);
  for (const year of monthlyYears) {
    for (let month = 1; month <= 12; month++) {
      for (const plan of PLAN_ORDER) {
        const count = monthlyCountByKey.get(`${year} ${month} ${plan}`) ?? 0;
        monthlySummary.push({
          연도: year,
          월: month,
          요금제: plan,
          월별추천고객수: count,
          "월별추천비중(%)": (count / Math.max(uniqueCustomerCount, 1)) * 100,
        });
      }
    }
  }

  // ── monthly_stability: (고객ID,월) 기준 2024 vs 2025 월별추천요금제 일치 비율 ──
  // (이 데이터셋에서 모든 고객×월 조합이 두 해 모두 존재한다는 전제는 annual_stability와 동일)
  const byCustomerMonth = new Map<string, Map<number, PlanName>>();
  for (const r of monthlyCustomerFull) {
    const key = `${r.고객ID} ${r.월}`;
    if (!byCustomerMonth.has(key)) byCustomerMonth.set(key, new Map());
    byCustomerMonth.get(key)!.set(r.연도, r.월별추천요금제);
  }
  let monthlyStableCount = 0;
  const allCustomerMonthKeys = [...byCustomerMonth.keys()];
  for (const key of allCustomerMonthKeys) {
    const m = byCustomerMonth.get(key)!;
    const r2024 = m.get(2024);
    const r2025 = m.get(2025);
    if (r2024 !== undefined && r2025 !== undefined && r2024 === r2025) monthlyStableCount++;
  }
  const monthlyStability =
    allCustomerMonthKeys.length > 0 ? monthlyStableCount / allCustomerMonthKeys.length : NaN;

  return {
    monthlyCustomer: monthlyCustomerFull,
    annualCustomer: annual.map(({ ...rest }) => {
      delete (rest as any).__sumUsage;
      return rest;
    }),
    annualSummary,
    annualTransition,
    annualStability,
    monthlyStability,
    monthlySummary,
  };
}
