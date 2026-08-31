/**
 * 탭 3 "고객별 진단·제어" — 원본 T3(streamlit_app_actual_tou_v30.py) 이관.
 * 고객 선택 → 진단 지표 5종 + 그룹·연간추천 안내 → "진단 기간" 라디오로
 * 1) 연간 종합진단(월별 사용량 추이·연간 요금비교·월별 추천요금제 변화·계절 부하곡선) 또는
 * 2) 월별 목표관리·제어(예측·요금비교·목표 설정·행동/제어계획 최적화·누적 예측·부하곡선 전후비교)
 * 를 그린다. 이 탭의 컨트롤은 전부 탭-로컬 상태(모듈 전역 let)로, 다시 그릴 때마다
 * renderTab3(root, ctx)를 통째로 재호출하는 단순 재렌더 방식을 쓴다(다른 탭과 동일 패턴).
 */

import type { AppContext } from "../main.js";
import {
  el,
  clear,
  metricGrid,
  type MetricSpec,
  renderFullTextTable,
  type ColumnSpec,
  alertBox,
  selectField,
  radioField,
  checkboxGroupField,
  numberField,
  controlsRow,
  downloadCsvButton,
  sectionTitle,
  subheading,
  emptyNote,
  roundForDisplay,
  insightBanner,
} from "../ui.js";
import { lineChart, type LineSeries } from "../charts.js";
import { fmtWon, fmtKwh, fmtPct, usagePatternLabel, peakManagementLabel } from "../../../lib/format.js";
import type { EnrichedCustomer } from "../../../lib/enrich.js";
import {
  PLAN_ORDER,
  PLAN_BILL_COLUMNS,
  type PlanName,
  type AnnualCustomerRow,
  type MonthlyCustomerRow,
  type TariffComparisonRow,
  monthlyBillMap,
  cheapestPlan,
  billForPlan,
  inverseBillForPlan,
  tariffComparisonTable,
} from "../../../lib/tariff-monitor.js";
import { forecastMonthLongitudinal } from "../../../lib/forecast.js";
import { SEASON_MONTHS, type Season, profileForCustomer, monthlyProfileForCustomer } from "../../../lib/timeseries.js";
import { ACTION_LIBRARY, CONTROL_MODES, optimizeActions, controlledProfile, cumulativeProjection } from "../../../lib/optimize.js";

const SEASON_KEYS = Object.keys(SEASON_MONTHS) as Season[];
const CONTROL_MODE_KEYS = Object.keys(CONTROL_MODES);
const OWNERSHIP_OPTIONS = [...new Set(ACTION_LIBRARY.map((a) => a.ownership))].sort();

type Period = "연간 종합진단" | "월별 목표관리·제어";
type DayType = "주중" | "주말";
type TargetKind = "기본" | "전월" | "전년동월" | "직접입력";

// ── 탭 내부 위젯 상태(원본 st.selectbox/st.radio/st.number_input의 key에 대응) ──
let cid = "";
let period: Period = "연간 종합진단";
let annualSeason: Season = SEASON_KEYS[0];
let annualDayType: DayType = "주중";
let year: 2024 | 2025 = 2025;
let month = 8; // st.selectbox(list(range(1,13)), index=7)
let cutoff = 20;
let currentPlan: PlanName = "구독 기본형"; // plan_choices index=2
let management: "알림·행동권고" | "한전 직접제어 위임" = "알림·행동권고";
let controlMode: string = "균형"; // list(CONTROL_MODES) index=1
let ownership: Set<string> = new Set(OWNERSHIP_OPTIONS);
let targetKind: TargetKind = "기본";
let customTargetBill: number | null = null;
let controlDayType: DayType = "주중";

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** season_for_month(원본에는 없는, T3 전용의 아주 작은 순수 헬퍼) — 계절별 행동대안 필터링에 쓴다. */
function seasonForMonth(m: number): string {
  if ([6, 7, 8].includes(m)) return "여름";
  if ([1, 2, 11, 12].includes(m)) return "겨울";
  return "봄가을";
}

/** st.markdown의 **굵게**를 <b>로 변환(alertBox/html 대체 문구용). */
function bold(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

export function renderTab3(root: HTMLElement, ctx: AppContext): void {
  clear(root);
  const { state } = ctx;

  root.append(...sectionTitle("고객별 요금분석 및 사용량 관리·제어"));

  // ── 고객 선택 ──
  const customerIds = [...state.enriched].map((c) => c.고객ID).sort();
  if (customerIds.length === 0) {
    root.append(emptyNote("표시할 고객이 없습니다."));
    return;
  }
  if (!cid || !customerIds.includes(cid)) cid = customerIds[0];

  root.append(
    controlsRow([
      selectField(
        "고객 선택",
        customerIds.map((c) => ({ value: c, label: c })),
        cid,
        (v) => {
          cid = v;
          renderTab3(root, ctx);
        }
      ),
    ])
  );

  const r: EnrichedCustomer = state.enrichedByCid.get(cid)!;
  const patternScore = Number(r.패턴안정성점수);
  const peakScore = Number(r.수요관리우선점수);

  root.append(
    metricGrid([
      { label: "2024 사용량", value: fmtKwh(Number(r["2024_연간사용량_kWh"])) },
      {
        label: "2025 사용량",
        value: fmtKwh(Number(r["2025_연간사용량_kWh"])),
        delta: fmtPct(r.연간사용량증감률),
        deltaDirection: r.연간사용량증감률 < 0 ? "down" : "up",
      },
      {
        label: "사용패턴 일관성",
        value: usagePatternLabel(patternScore),
        delta: `${patternScore.toFixed(1)}점`,
        help: "2024년과 2025년의 총사용량, 시간대별 비중, 주말·주중 패턴과 부하율이 비슷할수록 높습니다.",
      },
      {
        label: "피크관리 필요도",
        value: peakManagementLabel(peakScore),
        delta: `${peakScore.toFixed(1)}점`,
        help: "최대시간 부하, 최대부하시간대 사용비중, 연간 사용량, 냉난방 민감도와 예측 가능성을 종합한 상대순위입니다.",
      },
      { label: "최근 변화 신호", value: r.구조변화신호 },
    ] as MetricSpec[])
  );
  root.append(
    el("div", {
      className: "section-sub",
      html:
        "<b>사용패턴 일관성</b>은 두 해의 생활·사용패턴이 얼마나 비슷한지를 뜻합니다. " +
        "<b>피크관리 필요도</b>가 높을수록 한전의 피크 알림·부하이동·직접제어 실증을 우선 검토할 고객입니다.",
    })
  );

  const annualRecCustomer = state.tariffDynamic.annualCustomer.filter((a) => a.고객ID === cid);
  const rec24 = annualRecCustomer.find((a) => a.연도 === 2024)?.연간추천요금제 ?? "자료 없음";
  const rec25 = annualRecCustomer.find((a) => a.연도 === 2025)?.연간추천요금제 ?? "자료 없음";
  root.append(
    alertBox(
      "info",
      `그룹: ${String(r["2024군집"])} → ${String(r["2025군집"])} / 현재 요금 설정의 연간 추천: ${rec24} → ${rec25}`
    )
  );

  // ── 진단 기간 ──
  root.append(
    radioField(
      "진단 기간",
      [
        { value: "연간 종합진단", label: "연간 종합진단" },
        { value: "월별 목표관리·제어", label: "월별 목표관리·제어" },
      ],
      period,
      (v) => {
        period = v as Period;
        renderTab3(root, ctx);
      }
    )
  );

  if (period === "연간 종합진단") {
    renderAnnualDiagnosis(root, ctx, cid, r);
  } else {
    renderMonthlyControl(root, ctx, cid);
  }
}

// ── 1) 연간 종합진단 ────────────────────────────────────────────────────
function renderAnnualDiagnosis(root: HTMLElement, ctx: AppContext, cid: string, r: EnrichedCustomer): void {
  const { raw, state } = ctx;

  // ── 핵심 결과 배너: 이 고객의 연간 진단 결론을 표·차트보다 먼저 한 문장으로 ──
  const changeRate = r.연간사용량증감률;
  const annualRecCustomer = state.tariffDynamic.annualCustomer.filter((a) => a.고객ID === cid);
  const rec25 = annualRecCustomer.find((a) => a.연도 === 2025)?.연간추천요금제;
  root.append(
    insightBanner({
      tone: changeRate < 0 ? "mint" : "brand",
      headline: `이 고객의 2025년 사용량은 전년 대비 ${Math.abs(changeRate * 100).toFixed(1)}% ${
        changeRate < 0 ? "감소" : "증가"
      }했으며, 2025년 연간 추천 요금제는 "${rec25 ?? "자료 없음"}"입니다.`,
      detail: `현재 소속 그룹: ${String(r["2024군집"])} → ${String(r["2025군집"])}`,
    })
  );

  // 월별 사용량 추이(2024 vs 2025)
  const cm = raw.monthly.filter((m) => m.고객ID === cid);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years: (2024 | 2025)[] = [2024, 2025];
  const cmSeries: LineSeries[] = years.map((y, idx) => ({
    name: String(y),
    colorIndex: idx,
    values: months.map((mo) => {
      const row = cm.find((x) => x.연도 === y && x.월 === mo);
      return row ? row.사용량_kWh : null;
    }),
  }));
  root.append(lineChart({ xLabels: months, series: cmSeries, xTickEvery: 1, showMarkers: false, yFormat: fmtKwh }));

  // 연간 요금 및 연간 추천요금제
  root.append(...subheading("연간 요금 및 연간 추천요금제"));
  root.append(annualBillTable(state.tariffDynamic.annualCustomer, cid));

  // 월별 추천요금제 변화
  root.append(...subheading("월별 추천요금제 변화"));
  root.append(monthlyRecommendationPivotTable(state.tariffDynamic.monthlyCustomer, cid));

  // 대표 계절 + 주중/주말 부하곡선
  root.append(
    controlsRow([
      selectField(
        "대표 계절",
        SEASON_KEYS.map((s) => ({ value: s, label: s })),
        annualSeason,
        (v) => {
          annualSeason = v as Season;
          renderTab3(root, ctx);
        }
      ),
      radioField(
        "",
        [
          { value: "주중", label: "주중" },
          { value: "주말", label: "주말" },
        ],
        annualDayType,
        (v) => {
          annualDayType = v as DayType;
          renderTab3(root, ctx);
        }
      ),
    ])
  );

  const profileSeries: LineSeries[] = years.map((y, idx) => {
    const pts = profileForCustomer(raw.profilesDataset, cid, y, annualSeason, annualDayType);
    return { name: String(y), colorIndex: idx, values: pts.map((p) => p.평균사용량_kWh) };
  });
  const hourLabels = profileForCustomer(raw.profilesDataset, cid, years[0], annualSeason, annualDayType).map(
    (p) => p.시간
  );
  root.append(
    lineChart({
      xLabels: hourLabels,
      series: profileSeries,
      xTickValues: [1, 3, 6, 9, 12, 15, 18, 21, 24],
      showMarkers: false,
      yFormat: (v) => `${v.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}kWh/h`,
    })
  );
}

type AnnualBillRow = { 연도: string; 요금제: PlanName; "연간요금(원)": number; "월평균요금(원)": number; 판정: string };

function annualBillTable(annualCustomer: AnnualCustomerRow[], cid: string): HTMLDivElement {
  const rows: AnnualBillRow[] = [];
  for (const y of [2024, 2025] as const) {
    const ar = annualCustomer.find((a) => a.고객ID === cid && a.연도 === y);
    if (!ar) continue;
    const arRec = ar as unknown as Record<string, number>;
    for (const plan of PLAN_ORDER) {
      const billCol = PLAN_BILL_COLUMNS[plan];
      const amount = arRec[billCol];
      rows.push({
        연도: String(y),
        요금제: plan,
        "연간요금(원)": amount,
        "월평균요금(원)": amount / 12.0,
        판정: plan === ar.연간추천요금제 ? "연간 추천" : "비교",
      });
    }
  }
  const columns: ColumnSpec<AnnualBillRow>[] = [
    { key: "연도", label: "연도", kind: "text" },
    { key: "요금제", label: "요금제", kind: "text" },
    { key: "연간요금(원)", label: "연간요금(원)", kind: "money" },
    { key: "월평균요금(원)", label: "월평균요금(원)", kind: "money" },
    { key: "판정", label: "판정", kind: "text" },
  ];
  return renderFullTextTable(columns, rows);
}

type MonthlyRecRow = { 월: string; "2024 월별추천": string; "2025 월별추천": string; 변경여부: string };

function monthlyRecommendationPivotTable(monthlyCustomer: MonthlyCustomerRow[], cid: string): HTMLDivElement {
  const mr = monthlyCustomer.filter((m) => m.고객ID === cid);
  const rows: MonthlyRecRow[] = [];
  for (let m = 1; m <= 12; m++) {
    const r2024 = mr.find((x) => x.연도 === 2024 && x.월 === m)?.월별추천요금제;
    const r2025 = mr.find((x) => x.연도 === 2025 && x.월 === m)?.월별추천요금제;
    rows.push({
      월: String(m),
      "2024 월별추천": r2024 ?? "",
      "2025 월별추천": r2025 ?? "",
      변경여부: r2024 !== undefined && r2025 !== undefined && r2024 === r2025 ? "유지" : "변경",
    });
  }
  const columns: ColumnSpec<MonthlyRecRow>[] = [
    { key: "월", label: "월", kind: "text" },
    { key: "2024 월별추천", label: "2024 월별추천", kind: "text" },
    { key: "2025 월별추천", label: "2025 월별추천", kind: "text" },
    { key: "변경여부", label: "변경여부", kind: "text" },
  ];
  return renderFullTextTable(columns, rows);
}

// ── 2) 월별 목표관리·제어 ──────────────────────────────────────────────
function renderMonthlyControl(root: HTMLElement, ctx: AppContext, cid: string): void {
  const { raw, state } = ctx;
  const fee = state.fee;

  const maxday = daysInMonth(year, month);
  cutoff = Math.min(Math.max(cutoff, 5), Math.max(maxday - 1, 5));

  root.append(
    controlsRow([
      selectField(
        "대상 연도",
        [2024, 2025].map((y) => ({ value: String(y), label: String(y) })),
        String(year),
        (v) => {
          year = Number(v) as 2024 | 2025;
          renderTab3(root, ctx);
        }
      ),
      selectField(
        "대상 월",
        Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({ value: String(m), label: String(m) })),
        String(month),
        (v) => {
          month = Number(v);
          renderTab3(root, ctx);
        }
      ),
      numberField(
        "조회일",
        cutoff,
        (v) => {
          cutoff = Math.min(Math.max(Math.round(v), 5), Math.max(maxday - 1, 5));
          renderTab3(root, ctx);
        },
        { min: 5, max: Math.max(maxday - 1, 5), step: 1 }
      ),
    ])
  );
  root.append(el("div", { className: "section-sub", text: `선택한 조회일: ${cutoff}일` }));

  root.append(
    controlsRow([
      selectField(
        "현재 적용 요금제",
        PLAN_ORDER.map((p) => ({ value: p, label: p })),
        currentPlan,
        (v) => {
          currentPlan = v as PlanName;
          renderTab3(root, ctx);
        }
      ),
      radioField(
        "관리 방식",
        [
          { value: "알림·행동권고", label: "알림·행동권고" },
          { value: "한전 직접제어 위임", label: "한전 직접제어 위임" },
        ],
        management,
        (v) => {
          management = v as "알림·행동권고" | "한전 직접제어 위임";
          renderTab3(root, ctx);
        }
      ),
      selectField(
        "제어·권고 강도",
        CONTROL_MODE_KEYS.map((k) => ({ value: k, label: k })),
        controlMode,
        (v) => {
          controlMode = v;
          renderTab3(root, ctx);
        }
      ),
    ])
  );
  root.append(
    checkboxGroupField("등록·연결된 기기", OWNERSHIP_OPTIONS, ownership, () => {
      renderTab3(root, ctx);
    })
  );

  const cd = state.customerDaily.get(cid) ?? [];
  const f = forecastMonthLongitudinal(cd, year, month, cutoff);
  const mrow = raw.monthly.find((m) => m.고객ID === cid && m.연도 === year && m.월 === month);
  if (!mrow) {
    root.append(emptyNote("선택한 연도·월의 월별 사용 자료가 없습니다."));
    return;
  }

  const bills = monthlyBillMap(f.forecast, month, mrow, fee);
  const rec = cheapestPlan(bills);
  const currentBill = bills[currentPlan];
  const isSubscription = currentPlan === "구독 기본형" || currentPlan === "구독 프리미엄형";
  const inc = currentPlan === "구독 기본형" ? fee.basicInc : currentPlan === "구독 프리미엄형" ? fee.premiumInc : null;

  root.append(
    metricGrid([
      { label: "현재 누적", value: fmtKwh(f.current) },
      {
        label: "남은 제공량",
        value: isSubscription && inc !== null ? fmtKwh(Math.max(inc - f.current, 0)) : "정액제 아님",
      },
      { label: "월말 예상", value: fmtKwh(f.forecast) },
      {
        label: "예상 범위",
        value: `${f.lower.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}~${f.upper.toLocaleString(
          "ko-KR",
          { minimumFractionDigits: 1, maximumFractionDigits: 1 }
        )}kWh`,
      },
      { label: "현재요금제 예상", value: fmtWon(currentBill) },
      { label: "추천요금제", value: rec },
    ])
  );

  // ── 핵심 결과 배너: 이번 달 예상 요금·추천 요금제 절감액을 표보다 먼저 ──
  const saving = Math.max(currentBill - bills[rec], 0.0);
  root.append(
    insightBanner({
      tone: saving > 0 ? "mint" : "gold",
      headline:
        rec !== currentPlan && saving > 0
          ? `현재 사용 추세대로면 "${rec}"로 바꿀 때 현재 요금제보다 월 약 ${fmtWon(saving)} 절감될 것으로 예상됩니다.`
          : "현재 사용 추세에서는 지금 적용 중인 요금제가 비용상 최저이거나 추천 요금제와 동일합니다.",
      detail: `월말 예상 사용량 ${fmtKwh(f.forecast)} 기준, 현재 요금제(${currentPlan}) 예상 납부액은 ${fmtWon(
        currentBill
      )}입니다.`,
    })
  );

  root.append(...subheading("4개 요금제 적용 시 예상 납부액 비교"));
  const comparison = tariffComparisonTable(bills, currentPlan);
  root.append(comparisonTable(comparison));

  // ── 관리 목표 ──
  const targetLabels: [string, string, string, string] = isSubscription
    ? ["현재 요금제 제공량 이내", "전월과 같은 요금", "전년 동월과 같은 요금", "목표요금 직접 입력"]
    : ["현재 요금제 예상요금 이내", "전월과 같은 요금", "전년 동월과 같은 요금", "목표요금 직접 입력"];
  root.append(
    radioField(
      "관리 목표",
      [
        { value: "기본", label: targetLabels[0] },
        { value: "전월", label: targetLabels[1] },
        { value: "전년동월", label: targetLabels[2] },
        { value: "직접입력", label: targetLabels[3] },
      ],
      targetKind,
      (v) => {
        targetKind = v as TargetKind;
        renderTab3(root, ctx);
      }
    )
  );

  let targetUsage: number = isSubscription && inc !== null ? inc : f.forecast;

  if (targetKind === "전월") {
    const [py, pm] = month === 1 ? [year - 1, 12] : [year, month - 1];
    const prev = raw.monthly.find((m) => m.고객ID === cid && m.연도 === py && m.월 === pm);
    if (prev) {
      const targetBill = billForPlan(currentPlan, prev.사용량_kWh, pm, prev, fee);
      targetUsage = inverseBillForPlan(targetBill, currentPlan, month, mrow, fee);
    } else {
      root.append(alertBox("warning", "전월 자료가 없어 기본 목표를 적용합니다."));
    }
  } else if (targetKind === "전년동월") {
    const prev = raw.monthly.find((m) => m.고객ID === cid && m.연도 === year - 1 && m.월 === month);
    if (prev) {
      const targetBill = billForPlan(currentPlan, prev.사용량_kWh, month, prev, fee);
      targetUsage = inverseBillForPlan(targetBill, currentPlan, month, mrow, fee);
    } else {
      root.append(alertBox("warning", "전년 동월 자료가 없어 기본 목표를 적용합니다."));
    }
  } else if (targetKind === "직접입력") {
    const defaultBill = Math.round(currentBill);
    const shown = customTargetBill ?? defaultBill;
    root.append(
      numberField(
        "목표 월 납부액(원)",
        shown,
        (v) => {
          customTargetBill = Math.min(Math.max(Math.round(v), 0), 1_000_000);
          renderTab3(root, ctx);
        },
        { min: 0, max: 1_000_000, step: 1_000 }
      )
    );
    targetUsage = inverseBillForPlan(shown, currentPlan, month, mrow, fee);
  }

  if (targetUsage < f.current) {
    root.append(
      alertBox(
        "warning",
        "이미 누적사용량이 목표 사용량을 초과하여 이번 달에는 목표 달성이 어렵습니다. 가능한 범위의 감축계획만 산정합니다."
      )
    );
  }

  const required = Math.max(f.forecast - targetUsage, 0);
  const plan = optimizeActions(
    required,
    f.remaining_days,
    seasonForMonth(month),
    [...ownership],
    controlMode,
    management === "한전 직접제어 위임"
  );
  const controlledForecast = Math.max(f.forecast - plan.effective, f.current);
  const remainingGap = Math.max(controlledForecast - targetUsage, 0.0);

  root.append(
    metricGrid([
      { label: "목표 사용량", value: fmtKwh(targetUsage) },
      { label: "필요 감축량", value: fmtKwh(required) },
      { label: "계획 실효감축", value: fmtKwh(plan.effective) },
      { label: "관리 후 예상", value: fmtKwh(controlledForecast) },
    ])
  );

  type ActionDisplayRow = {
    대안: string;
    유형: string;
    실행횟수: number;
    "예상절감·이동량(kWh)": number;
    "실효량(kWh)": number;
    불편점수: number;
  };
  const actionColumns: ColumnSpec<ActionDisplayRow>[] = [
    { key: "대안", label: "대안", kind: "text" },
    { key: "유형", label: "유형", kind: "text" },
    { key: "실행횟수", label: "실행횟수", kind: "count" },
    { key: "예상절감·이동량(kWh)", label: "예상절감·이동량(kWh)", kind: "number" },
    { key: "실효량(kWh)", label: "실효량(kWh)", kind: "number" },
    { key: "불편점수", label: "불편점수", kind: "number" },
  ];
  if (plan.rows.length > 0) {
    const displayRows: ActionDisplayRow[] = plan.rows.map((row) => ({
      대안: row.대안,
      유형: row.유형,
      실행횟수: row.실행횟수,
      "예상절감·이동량(kWh)": row["예상절감·이동량(kWh)"],
      "실효량(kWh)": row["실효량(kWh)"],
      불편점수: row.불편점수,
    }));
    root.append(renderFullTextTable(actionColumns, displayRows));
    const csvRows = displayRows.map((row) => roundRowForCsv(row, actionColumns));
    root.append(
      downloadCsvButton("행동·제어계획 CSV", `${cid}_${year}_${month}월_제어계획.csv`, actionColumns, csvRows)
    );
  } else {
    root.append(alertBox("info", "현재 목표를 위해 추가로 선택할 수 있는 행동대안이 없거나 감축이 필요하지 않습니다."));
  }

  const goalTolerance = Math.max(1.0, targetUsage * 0.005);
  if (remainingGap > goalTolerance) {
    const controlledBills = monthlyBillMap(controlledForecast, month, mrow, fee);
    const controlledRec = cheapestPlan(controlledBills);
    root.append(
      alertBox(
        "warning",
        `현재 등록기기와 <b>${controlMode}</b> 설정만으로는 목표를 충족하기 어렵습니다. 관리 후에도 목표 사용량을 약 <b>${fmtKwh(
          remainingGap
        )}</b> 초과할 것으로 예상됩니다.`
      )
    );
    if (controlledRec === "구독 기본형" || controlledRec === "구독 프리미엄형") {
      root.append(
        alertBox(
          "info",
          `관리 후 예상 사용량을 기준으로는 <b>${controlledRec}</b>가 비용상 가장 유리합니다. 비슷한 초과가 반복된다면 사용량을 무리하게 억제하기보다 해당 <b>구독서비스 전환</b>을 검토하는 편이 적절합니다.`
        )
      );
    } else {
      root.append(
        alertBox(
          "info",
          `관리 후 예상 사용량을 기준으로는 <b>${controlledRec}</b>가 가장 유리합니다. 현재 구독형보다 이 요금제를 유지·전환하는 방안이 비용 측면에서 적합할 수 있습니다.`
        )
      );
    }
    root.append(
      el("div", {
        className: "section-sub",
        html: bold(
          "**추가 대안** ① 직접제어 허용기기 확대 또는 제어강도 상향 ② 목표요금·목표사용량의 현실적 조정 ③ 초과요금을 감수하고 고객 편의 유지 ④ 다음 달부터 조기 알림·제어 시작"
        ),
      })
    );
  } else if (required > 0) {
    root.append(alertBox("success", "현재 등록기기와 제어·권고 범위에서 목표 달성이 가능한 것으로 추정됩니다."));
  }

  // ── 월중 누적 사용량 예측(미제어/행동권고/직접제어) ──
  const dm = cd.filter((d) => d.연도 === year && d.월 === month);
  const advisoryReduction = plan.effective * (management === "알림·행동권고" ? 0.8 : 0.0);
  const directReduction = management === "한전 직접제어 위임" ? plan.effective : 0.0;
  const proj = cumulativeProjection(dm, cutoff, f.forecast, advisoryReduction, directReduction);
  const projSeries: LineSeries[] = [
    { name: "실제누적", colorIndex: 0, values: proj.map((p) => p.실제누적) },
    { name: "미제어예상", colorIndex: 1, values: proj.map((p) => p.미제어예상) },
    { name: "행동권고예상", colorIndex: 2, values: proj.map((p) => p.행동권고예상) },
    { name: "직접제어예상", colorIndex: 3, values: proj.map((p) => p.직접제어예상) },
    { name: "목표 사용량", colorIndex: 0, dashed: true, values: proj.map(() => targetUsage) },
  ];
  root.append(
    lineChart({
      xLabels: proj.map((p) => p.일),
      series: projSeries,
      yFormat: fmtKwh,
      yLabel: "월 누적 사용량(kWh)",
    })
  );

  // ── 주중·주말 평균 부하곡선: 관리 전후 ──
  root.append(...subheading("주중·주말 평균 부하곡선: 관리 전후"));
  root.append(
    radioField(
      "",
      [
        { value: "주중", label: "주중" },
        { value: "주말", label: "주말" },
      ],
      controlDayType,
      (v) => {
        controlDayType = v as DayType;
        renderTab3(root, ctx);
      }
    )
  );
  const p = monthlyProfileForCustomer(raw.profilesDataset, cid, year, month, controlDayType);
  const base = p.map((pt) => pt.평균사용량_kWh);
  const after = controlledProfile(base, plan.rows, f.remaining_days);
  root.append(
    lineChart({
      xLabels: p.map((pt) => pt.시간),
      series: [
        { name: "관리 전", colorIndex: 0, values: base },
        { name: "관리 후 예상", colorIndex: 1, values: after },
      ],
      xTickValues: [1, 3, 6, 9, 12, 15, 18, 21, 24],
      showMarkers: false,
      yLabel: "평균부하(kWh/h)",
      yFormat: (v) => v.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    })
  );
}

function comparisonTable(comparison: TariffComparisonRow[]): HTMLDivElement {
  type ComparisonRow = {
    요금제: string;
    "월말 예상요금(원)": number;
    "현재요금제 대비 차이(원)": number;
    "최저요금 대비 차이(원)": number;
    판정: string;
  };
  const rows: ComparisonRow[] = comparison.map((row) => ({
    요금제: row.요금제,
    "월말 예상요금(원)": row["월말 예상요금(원)"],
    "현재요금제 대비 차이(원)": row["현재요금제 대비 차이(원)"],
    "최저요금 대비 차이(원)": row["최저요금 대비 차이(원)"],
    판정: row.판정,
  }));
  const columns: ColumnSpec<ComparisonRow>[] = [
    { key: "요금제", label: "요금제", kind: "text" },
    { key: "월말 예상요금(원)", label: "월말 예상요금(원)", kind: "money" },
    { key: "현재요금제 대비 차이(원)", label: "현재요금제 대비 차이(원)", kind: "money" },
    { key: "최저요금 대비 차이(원)", label: "최저요금 대비 차이(원)", kind: "money" },
    { key: "판정", label: "판정", kind: "text" },
  ];
  return renderFullTextTable(columns, rows);
}

/** round_table 상당(CSV 출력 직전, 금액열은 정수로·그 외 숫자열은 소수1자리로 반올림). */
function roundRowForCsv<T extends Record<string, unknown>>(row: T, columns: { key: string; label: string }[]): T {
  const out = { ...row } as Record<string, unknown>;
  for (const c of columns) {
    const v = out[c.key];
    if (typeof v === "number") out[c.key] = roundForDisplay(v, c.label);
  }
  return out as T;
}
