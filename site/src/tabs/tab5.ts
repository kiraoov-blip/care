/**
 * 탭 5 "요금분석 및 추천" — 원본 L(with T5: 블록) 이관.
 * 안내 배너 → 1) 연간 추천 요금제(요약표·지표카드·막대차트·필터+정렬 고객표·CSV·조정표)
 * → 2) 월별 추천 요금제(지표카드·막대차트·월별요약표·고객표·CSV) → 3) 월말 사용량 예측성능표.
 * ctx.state.tariffDynamic은 사이드바 요금 가정이 바뀔 때마다 이미 다시 계산되어 들어오므로
 * 이 탭은 그 결과를 읽어 그리기만 한다(재계산 없음).
 */

import type { AppContext } from "../main.js";
import {
  clear,
  el,
  metricGrid,
  type MetricSpec,
  renderTable,
  type ColumnSpec,
  radioField,
  selectField,
  controlsRow,
  alertBox,
  downloadCsvButton,
  sectionTitle,
  subheading,
  insightBanner,
} from "../ui.js";
import { barChart, type BarDatum } from "../charts.js";
import {
  PLAN_ORDER,
  type PlanName,
  type AnnualSummaryRow,
  type AnnualTransitionRow,
  type AnnualCustomerRow,
  type MonthlySummaryRow,
  type MonthlyCustomerRow,
} from "../../../lib/tariff-monitor.js";
import { fmtPct } from "../../../lib/format.js";
import type { EnrichedCustomer } from "../../../lib/enrich.js";

const ANNUAL_SORT_OPTIONS = ["연간TOU대비절감(원)", "연간사용량(kWh)", "월평균사용량(kWh)", "연간최저요금(원)"] as const;
type AnnualSortKey = (typeof ANNUAL_SORT_OPTIONS)[number];

// 탭 내부 위젯 상태(원본 st.radio/st.selectbox의 key="annual_tariff_year" 등에 대응) —
// 사이드바 값과 달리 이 탭 안에서만 유지되는 로컬 상태다.
let annualYear: 2024 | 2025 = 2025;
let annualPlanFilter: "전체" | PlanName = "전체";
let annualSort: AnnualSortKey = "연간TOU대비절감(원)";
let monthlyYear: 2024 | 2025 = 2025;
let monthlyMonth: number = 8;

export function renderTab5(root: HTMLElement, ctx: AppContext): void {
  clear(root);
  const { state } = ctx;
  const { tariffDynamic } = state;
  const rates = state.fee.surchargeRates!;

  root.append(
    ...sectionTitle(
      "요금분석 및 추천",
      "사이드바의 기본형·프리미엄형 구독료, 제공량 및 초과단가를 바꾸면 아래 추천 고객 수와 요금이 즉시 다시 계산됩니다."
    )
  );
  root.append(
    alertBox(
      "info",
      `일반·TOU 반영값: 연료비조정 ${rates.fuel.toFixed(1)}원/kWh + 기후환경 ${rates.climate.toFixed(1)}원/kWh, ` +
        `부가세 ${(rates.vat * 100).toFixed(1)}%, 전력산업기반기금 ${(rates.fund * 100).toFixed(1)}%. ` +
        `구독료와 초과단가는 이 항목을 포함한 최종가격입니다.`
    )
  );

  // ── 1. 연간 추천 요금제 ──
  root.append(...subheading("연간 추천 요금제", { step: 1 }));

  // 핵심 결과 배너는 연도 라디오보다 뒤, annualCounts 계산 이후에 넣는다(아래 참고).
  root.append(annualSummaryTable(tariffDynamic.annualSummary));

  root.append(
    radioField(
      "연간 추천 분석연도",
      [
        { value: "2024", label: "2024" },
        { value: "2025", label: "2025" },
      ],
      String(annualYear),
      (v) => {
        annualYear = Number(v) as 2024 | 2025;
        renderTab5(root, ctx);
      }
    )
  );

  const annualSelected = tariffDynamic.annualCustomer.filter((a) => a.연도 === annualYear);
  const annualCounts = planCounts(annualSelected, (r) => r.연간추천요금제);
  const annualTop = PLAN_ORDER.reduce((a, b) => (annualCounts[b] > annualCounts[a] ? b : a));
  const annualTotal = annualSelected.length || 1;

  root.append(
    insightBanner({
      tone: "brand",
      headline: `${annualYear}년 연간 기준으로는 전체 ${annualTotal.toLocaleString(
        "ko-KR"
      )}명 중 ${annualCounts[annualTop].toLocaleString("ko-KR")}명(${((annualCounts[annualTop] / annualTotal) * 100).toFixed(
        1
      )}%)에게 "${annualTop}" 요금제가 가장 많이 추천됩니다.`,
      detail: `2024→2025년 연간 추천 요금제를 그대로 유지한 고객은 ${fmtPct(tariffDynamic.annualStability)}입니다.`,
    })
  );

  root.append(
    metricGrid([
      { label: "일반주택용 추천", value: `${annualCounts["일반 주택용(저압)"].toLocaleString("ko-KR")}명` },
      { label: "제주 TOU 추천", value: `${annualCounts["제주 TOU"].toLocaleString("ko-KR")}명` },
      { label: "기본형 추천", value: `${annualCounts["구독 기본형"].toLocaleString("ko-KR")}명` },
      { label: "프리미엄형 추천", value: `${annualCounts["구독 프리미엄형"].toLocaleString("ko-KR")}명` },
      { label: "2024→2025 연간추천 유지", value: fmtPct(tariffDynamic.annualStability) },
    ] as MetricSpec[])
  );

  root.append(el("div", { className: "section-sub", text: `${annualYear}년 연간 추천요금제 분포` }));
  root.append(
    barChart({
      data: PLAN_ORDER.map((p) => ({ label: p, value: annualCounts[p] })) as BarDatum[],
      valueFormat: (v) => v.toLocaleString("ko-KR"),
    })
  );

  const annualPlanFilterControl = selectField(
    "연간 추천요금제 필터",
    [{ value: "전체", label: "전체" }, ...PLAN_ORDER.map((p) => ({ value: p, label: p }))],
    annualPlanFilter,
    (v) => {
      annualPlanFilter = v as "전체" | PlanName;
      renderTab5(root, ctx);
    }
  );
  const annualSortControl = selectField(
    "연간 표 정렬",
    ANNUAL_SORT_OPTIONS.map((v) => ({ value: v, label: v })),
    annualSort,
    (v) => {
      annualSort = v as AnnualSortKey;
      renderTab5(root, ctx);
    }
  );
  root.append(controlsRow([annualPlanFilterControl, annualSortControl]));

  let annualShow = annualSelected;
  if (annualPlanFilter !== "전체") annualShow = annualShow.filter((a) => a.연간추천요금제 === annualPlanFilter);
  annualShow = [...annualShow].sort((a, b) => b[annualSort] - a[annualSort]);

  const annualShowColumns: ColumnSpec<Record<string, unknown>>[] = [
    { key: "고객ID", label: "고객ID", kind: "text" },
    { key: "연간사용량(kWh)", label: "연간사용량(kWh)", kind: "number" },
    { key: "월평균사용량(kWh)", label: "월평균사용량(kWh)", kind: "number" },
    { key: "일반주택용(원)", label: "일반주택용(원)", kind: "money" },
    { key: "제주TOU(원)", label: "제주TOU(원)", kind: "money" },
    { key: "기본형(원)", label: "기본형(원)", kind: "money" },
    { key: "프리미엄형(원)", label: "프리미엄형(원)", kind: "money" },
    { key: "연간추천요금제", label: "연간추천요금제", kind: "text" },
    { key: "연간TOU대비절감(원)", label: "연간TOU대비절감(원)", kind: "money" },
  ];
  const annualShowRows = annualShow as unknown as Record<string, unknown>[];
  root.append(renderTable(annualShowColumns, annualShowRows, { height: 420 }));
  root.append(
    downloadCsvButton(
      "연간 추천요금제 고객표 CSV",
      `v30_${annualYear}_연간추천요금제.csv`,
      annualShowColumns,
      annualShowRows
    )
  );

  root.append(...subheading("연간 추천 요금제 조정·변경"));
  root.append(annualTransitionTable(tariffDynamic.annualTransition));

  // ── 2. 월별 추천 요금제 ──
  root.append(...subheading("월별 추천 요금제", { step: 2 }));
  const monthlyYearControl = selectField(
    "월별 추천 분석연도",
    [
      { value: "2024", label: "2024" },
      { value: "2025", label: "2025" },
    ],
    String(monthlyYear),
    (v) => {
      monthlyYear = Number(v) as 2024 | 2025;
      renderTab5(root, ctx);
    }
  );
  const monthlyMonthControl = selectField(
    "월별 추천 분석월",
    Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({ value: String(m), label: String(m) })),
    String(monthlyMonth),
    (v) => {
      monthlyMonth = Number(v);
      renderTab5(root, ctx);
    }
  );
  root.append(controlsRow([monthlyYearControl, monthlyMonthControl]));

  const monthlySelected = tariffDynamic.monthlyCustomer.filter(
    (r) => r.연도 === monthlyYear && r.월 === monthlyMonth
  );
  const monthlyCounts = planCounts(monthlySelected, (r) => r.월별추천요금제);

  root.append(
    metricGrid([
      { label: "일반주택용 추천", value: `${monthlyCounts["일반 주택용(저압)"].toLocaleString("ko-KR")}명` },
      { label: "제주 TOU 추천", value: `${monthlyCounts["제주 TOU"].toLocaleString("ko-KR")}명` },
      { label: "기본형 추천", value: `${monthlyCounts["구독 기본형"].toLocaleString("ko-KR")}명` },
      { label: "프리미엄형 추천", value: `${monthlyCounts["구독 프리미엄형"].toLocaleString("ko-KR")}명` },
      { label: "월별 추천 연도간 유지", value: fmtPct(tariffDynamic.monthlyStability) },
    ] as MetricSpec[])
  );

  root.append(el("div", { className: "section-sub", text: `${monthlyYear}년 ${monthlyMonth}월 추천요금제 분포` }));
  root.append(
    barChart({
      data: PLAN_ORDER.map((p) => ({ label: p, value: monthlyCounts[p] })) as BarDatum[],
      valueFormat: (v) => v.toLocaleString("ko-KR"),
    })
  );

  root.append(monthlySummaryTable(tariffDynamic.monthlySummary.filter((r) => r.연도 === monthlyYear)));

  const monthlyShowColumns: ColumnSpec<Record<string, unknown>>[] = [
    { key: "고객ID", label: "고객ID", kind: "text" },
    { key: "사용량(kWh)", label: "사용량(kWh)", kind: "number" },
    { key: "일반주택용(원)", label: "일반주택용(원)", kind: "money" },
    { key: "제주TOU(원)", label: "제주TOU(원)", kind: "money" },
    { key: "기본형(원)", label: "기본형(원)", kind: "money" },
    { key: "프리미엄형(원)", label: "프리미엄형(원)", kind: "money" },
    { key: "월별추천요금제", label: "월별추천요금제", kind: "text" },
    { key: "연간추천요금제", label: "연간추천요금제", kind: "text" },
    { key: "월·연간추천일치", label: "월·연간추천일치", kind: "text" },
  ];
  const monthlySelectedRows = monthlySelected as unknown as Record<string, unknown>[];
  root.append(renderTable(monthlyShowColumns, monthlySelectedRows, { height: 420 }));
  root.append(
    downloadCsvButton(
      "월별 추천요금제 고객표 CSV",
      `v30_${monthlyYear}_${monthlyMonth}월_추천요금제.csv`,
      monthlyShowColumns,
      monthlySelectedRows
    )
  );

  // ── 3. 월말 사용량 예측성능 ──
  root.append(...subheading("월말 사용량 예측성능", { step: 3 }));
  root.append(forecastPerformanceTable(state.enriched));
}

/** value_counts().reindex(PLAN_ORDER, fill_value=0)와 동일: PLAN_ORDER 순서로 개수를 센다. */
function planCounts<T>(rows: T[], plan: (r: T) => PlanName): Record<PlanName, number> {
  const counts: Record<PlanName, number> = {
    "일반 주택용(저압)": 0,
    "제주 TOU": 0,
    "구독 기본형": 0,
    "구독 프리미엄형": 0,
  };
  for (const r of rows) counts[plan(r)]++;
  return counts;
}

/** annual_summary(원본: 고객당중앙연간/월요금 컬럼 제외 + 연간추천고객수 → "연간 추천 고객 수(명)" 이름 변경). */
function annualSummaryTable(rows: AnnualSummaryRow[]): HTMLDivElement {
  const columns: ColumnSpec<Record<string, unknown>>[] = [
    { key: "연도", label: "연도", kind: "text" },
    { key: "요금제", label: "요금제", kind: "text" },
    { key: "고객당평균연간요금(원)", label: "고객당평균연간요금(원)", kind: "money" },
    { key: "고객당평균월요금(원)", label: "고객당평균월요금(원)", kind: "money" },
    { key: "연간추천고객수", label: "연간 추천 고객 수(명)", kind: "count" },
    { key: "연간추천비중(%)", label: "연간추천비중(%)", kind: "percent" },
  ];
  return renderTable(columns, rows as unknown as Record<string, unknown>[]);
}

/** annual_transition(원본: 2024→2025 연간추천 조정·변경 상세). */
function annualTransitionTable(rows: AnnualTransitionRow[]): HTMLDivElement {
  const columns: ColumnSpec<Record<string, unknown>>[] = [
    { key: "2024 연간추천", label: "2024 연간추천", kind: "text" },
    { key: "2025 연간추천", label: "2025 연간추천", kind: "text" },
    { key: "고객수", label: "고객수", kind: "count" },
    { key: "2024 추천군 내 비중(%)", label: "2024 추천군 내 비중(%)", kind: "percent" },
  ];
  return renderTable(columns, rows as unknown as Record<string, unknown>[]);
}

/** monthly_summary(원본: 선택 연도로 필터한 연도×월×요금제 조합별 추천고객수). */
function monthlySummaryTable(rows: MonthlySummaryRow[]): HTMLDivElement {
  type Row = { 연도: string; 월: string; 요금제: PlanName; 월별추천고객수: number; "월별추천비중(%)": number };
  const display: Row[] = rows.map((r) => ({
    연도: String(r.연도),
    월: String(r.월),
    요금제: r.요금제,
    월별추천고객수: r.월별추천고객수,
    "월별추천비중(%)": r["월별추천비중(%)"],
  }));
  const columns: ColumnSpec<Row>[] = [
    { key: "연도", label: "연도", kind: "text" },
    { key: "월", label: "월", kind: "text" },
    { key: "요금제", label: "요금제", kind: "text" },
    { key: "월별추천고객수", label: "월별추천고객수", kind: "count" },
    { key: "월별추천비중(%)", label: "월별추천비중(%)", kind: "percent" },
  ];
  return renderTable(columns, display, { height: 320 });
}

/** ff(원본: customers[[...]] MAPE·오차10%이내 비율을 %로 환산). */
function forecastPerformanceTable(enriched: EnrichedCustomer[]): HTMLDivElement {
  type Row = {
    고객ID: string;
    "15일예측_MAPE(%)": number;
    "20일예측_MAPE(%)": number;
    "15일예측_오차10%이내(%)": number;
    "20일예측_오차10%이내(%)": number;
  };
  const rows: Row[] = enriched.map((c) => ({
    고객ID: c.고객ID,
    "15일예측_MAPE(%)": Number(c["15일예측_MAPE"]) * 100,
    "20일예측_MAPE(%)": Number(c["20일예측_MAPE"]) * 100,
    "15일예측_오차10%이내(%)": Number(c["15일예측_오차10%이내"]) * 100,
    "20일예측_오차10%이내(%)": Number(c["20일예측_오차10%이내"]) * 100,
  }));
  const columns: ColumnSpec<Row>[] = [
    { key: "고객ID", label: "고객ID", kind: "text" },
    { key: "15일예측_MAPE(%)", label: "15일예측_MAPE(%)", kind: "percent" },
    { key: "20일예측_MAPE(%)", label: "20일예측_MAPE(%)", kind: "percent" },
    { key: "15일예측_오차10%이내(%)", label: "15일예측_오차10%이내(%)", kind: "percent" },
    { key: "20일예측_오차10%이내(%)", label: "20일예측_오차10%이내(%)", kind: "percent" },
  ];
  return renderTable(columns, rows, { height: 420 });
}
