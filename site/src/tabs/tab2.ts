/**
 * 탭 2 "고객별 요금 모니터링" — 원본 T2(streamlit_app_actual_tou_v30.py) 이관.
 * lib/tariff-monitor.ts의 buildAnnualMonitor("연간 전체")/buildMonthlyMonitor("월중 모니터링")
 * (원본 build_tariff_monitor의 두 if/else 분기)를 호출해 고객별 요금 모니터링 표를 그린다.
 */
import type { AppContext } from "../main.js";
import {
  el,
  metricGrid,
  renderTable,
  controlsRow,
  selectField,
  numberField,
  radioField,
  downloadCsvButton,
  sectionTitle,
  emptyNote,
  roundForDisplay,
  insightBanner,
  type ColumnSpec,
} from "../ui.js";
import { fmtWon } from "../../../lib/format.js";
import {
  buildAnnualMonitor,
  buildMonthlyMonitor,
  type AnnualMonitorRow,
  type MonthlyMonitorRow,
  type PlanName,
} from "../../../lib/tariff-monitor.js";

type Period = "연간 전체" | "월중 모니터링";
type MonitorRow = AnnualMonitorRow | MonthlyMonitorRow;

// ── 탭-로컬 위젯 상태(원본 Streamlit 세션 상태에 대응) — 사이드바 값이 바뀌어 이 탭이
// 다시 그려져도(main.ts의 dirty 재렌더) 값이 유지되도록 모듈 전역에 둔다. ──
let period: Period = "연간 전체";
let year: 2024 | 2025 = 2025;
let month = 8; // 원본 c.selectbox(list(range(1,13)), index=7) → 8
let cutoff = 20;
let currentPlan: "기본형" | "프리미엄형" = "기본형";
let sortKey: "수요관리우선점수" | "TOU대비절감(원)" | "월말예상(kWh)" | "연간사용량(kWh)" = "수요관리우선점수";
let planFilter = "전체";
let clusterFilter = "전체";
// 열이 15개나 되어(만원 단위로 줄여도) 화면 폭 안에 다 들어가지 못해 표 아래에
// 항상 좌우 스크롤이 생겼다 — 스크롤을 아예 없애 달라는 요청으로, 기본은 화면
// 폭에 맞는 "핵심 열만" 보여주고 원하면 "전체 열"로 바꿔 볼 수 있게 한다.
// CSV 다운로드는 이 설정과 무관하게 항상 전체 열을 그대로 내려받는다.
let columnMode: "핵심 열만" | "전체 열" = "핵심 열만";

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function sortShow(rows: MonitorRow[], key: string): MonitorRow[] {
  if (!rows.length || !(key in (rows[0] as unknown as Record<string, unknown>))) return rows; // 원본 `if sort_key in show.columns`
  return [...rows].sort(
    (a, b) =>
      Number((b as unknown as Record<string, unknown>)[key]) -
      Number((a as unknown as Record<string, unknown>)[key])
  );
}

function roundRowForCsv(row: MonitorRow, columns: { key: string; label: string }[]): MonitorRow {
  const out = { ...row } as Record<string, unknown>;
  for (const c of columns) {
    const v = out[c.key];
    if (typeof v === "number") out[c.key] = roundForDisplay(v, c.label);
  }
  return out as unknown as MonitorRow;
}

// 금액 열은 화면 표에서는 만원 단위(소수 1자리)로 줄여서 보여준다 — 원 단위 그대로면
// 자리수가 많아 표가 넓어지고 좌우 스크롤이 잘 생긴다. 다만 CSV 다운로드까지 만원
// 단위로 바꾸면 원본 데이터와 단위가 달라져 헷갈릴 수 있으므로, CSV는 기존과 동일하게
// 원 단위 그대로 내려받도록 화면표시용(DISPLAY)과 CSV용(CSV) 열 정의를 분리한다.
const ANNUAL_DISPLAY_COLUMNS: ColumnSpec<AnnualMonitorRow>[] = [
  { key: "고객ID", label: "고객ID", kind: "text" },
  { key: "그룹", label: "그룹", kind: "text" },
  { key: "연간사용량(kWh)", label: "연간사용량(kWh)", kind: "number" },
  { key: "월평균사용량(kWh)", label: "월평균사용량(kWh)", kind: "number" },
  { key: "일반주택용(원)", label: "일반주택용(만원)", kind: "manwon", get: (r) => r["일반주택용(원)"] },
  { key: "제주TOU(원)", label: "제주TOU(만원)", kind: "manwon", get: (r) => r["제주TOU(원)"] },
  { key: "기본형(원)", label: "기본형(만원)", kind: "manwon", get: (r) => r["기본형(원)"] },
  { key: "프리미엄형(원)", label: "프리미엄형(만원)", kind: "manwon", get: (r) => r["프리미엄형(원)"] },
  { key: "추천요금제", label: "추천요금제", kind: "text" },
  { key: "TOU대비절감(원)", label: "TOU대비절감(만원)", kind: "manwon", get: (r) => r["TOU대비절감(원)"] },
  { key: "기본형제공량사용률(%)", label: "기본형제공량사용률(%)", kind: "percent" },
  { key: "프리미엄형제공량사용률(%)", label: "프리미엄형제공량사용률(%)", kind: "percent" },
  { key: "2024→2025증감률(%)", label: "2024→2025증감률(%)", kind: "percent" },
  { key: "패턴안정성점수", label: "패턴안정성점수", kind: "number" },
  { key: "수요관리우선점수", label: "수요관리우선점수", kind: "number" },
];
const ANNUAL_CSV_COLUMNS: ColumnSpec<AnnualMonitorRow>[] = [
  { key: "고객ID", label: "고객ID", kind: "text" },
  { key: "그룹", label: "그룹", kind: "text" },
  { key: "연간사용량(kWh)", label: "연간사용량(kWh)", kind: "number" },
  { key: "월평균사용량(kWh)", label: "월평균사용량(kWh)", kind: "number" },
  { key: "일반주택용(원)", label: "일반주택용(원)", kind: "money" },
  { key: "제주TOU(원)", label: "제주TOU(원)", kind: "money" },
  { key: "기본형(원)", label: "기본형(원)", kind: "money" },
  { key: "프리미엄형(원)", label: "프리미엄형(원)", kind: "money" },
  { key: "추천요금제", label: "추천요금제", kind: "text" },
  { key: "TOU대비절감(원)", label: "TOU대비절감(원)", kind: "money" },
  { key: "기본형제공량사용률(%)", label: "기본형제공량사용률(%)", kind: "percent" },
  { key: "프리미엄형제공량사용률(%)", label: "프리미엄형제공량사용률(%)", kind: "percent" },
  { key: "2024→2025증감률(%)", label: "2024→2025증감률(%)", kind: "percent" },
  { key: "패턴안정성점수", label: "패턴안정성점수", kind: "number" },
  { key: "수요관리우선점수", label: "수요관리우선점수", kind: "number" },
];

const MONTHLY_DISPLAY_COLUMNS: ColumnSpec<MonthlyMonitorRow>[] = [
  { key: "고객ID", label: "고객ID", kind: "text" },
  { key: "그룹", label: "그룹", kind: "text" },
  { key: "현재누적(kWh)", label: "현재누적(kWh)", kind: "number" },
  { key: "남은정액량(kWh)", label: "남은정액량(kWh)", kind: "number" },
  { key: "월말예상(kWh)", label: "월말예상(kWh)", kind: "number" },
  { key: "예측하한(kWh)", label: "예측하한(kWh)", kind: "number" },
  { key: "예측상한(kWh)", label: "예측상한(kWh)", kind: "number" },
  { key: "실제월사용량(kWh)", label: "실제월사용량(kWh)", kind: "number" },
  { key: "일반주택용(원)", label: "일반주택용(만원)", kind: "manwon", get: (r) => r["일반주택용(원)"] },
  { key: "제주TOU(원)", label: "제주TOU(만원)", kind: "manwon", get: (r) => r["제주TOU(원)"] },
  { key: "기본형(원)", label: "기본형(만원)", kind: "manwon", get: (r) => r["기본형(원)"] },
  { key: "프리미엄형(원)", label: "프리미엄형(만원)", kind: "manwon", get: (r) => r["프리미엄형(원)"] },
  { key: "추천요금제", label: "추천요금제", kind: "text" },
  { key: "TOU대비절감(원)", label: "TOU대비절감(만원)", kind: "manwon", get: (r) => r["TOU대비절감(원)"] },
  { key: "기본형제공량사용률(%)", label: "기본형제공량사용률(%)", kind: "percent" },
  { key: "프리미엄형제공량사용률(%)", label: "프리미엄형제공량사용률(%)", kind: "percent" },
  { key: "알림단계", label: "알림단계", kind: "text" },
  { key: "예측오차(%)", label: "예측오차(%)", kind: "percent" },
  { key: "패턴안정성점수", label: "패턴안정성점수", kind: "number" },
  { key: "수요관리우선점수", label: "수요관리우선점수", kind: "number" },
];

// ── "핵심 열만" 보기용 부분집합 — 화면 표시(DISPLAY) 열 중에서 판단에 가장 중요한
// 6~7개만 남긴다(고객 식별·현재 상태·추천 결과·절감액·우선순위 점수 중심). 나머지
// 상세 열(예측 상/하한, 제공량 사용률 등)은 "전체 열"로 바꾸면 그대로 볼 수 있고,
// CSV에는 이 화면표시 설정과 무관하게 항상 전체 열이 담긴다. ──
const ANNUAL_COMPACT_COLUMNS: ColumnSpec<AnnualMonitorRow>[] = [
  { key: "고객ID", label: "고객ID", kind: "text" },
  { key: "그룹", label: "그룹", kind: "text" },
  { key: "연간사용량(kWh)", label: "연간사용량(kWh)", kind: "number" },
  { key: "추천요금제", label: "추천요금제", kind: "text" },
  { key: "TOU대비절감(원)", label: "TOU대비절감(만원)", kind: "manwon", get: (r) => r["TOU대비절감(원)"] },
  { key: "2024→2025증감률(%)", label: "2024→2025증감률(%)", kind: "percent" },
  { key: "수요관리우선점수", label: "수요관리우선점수", kind: "number" },
];
const MONTHLY_COMPACT_COLUMNS: ColumnSpec<MonthlyMonitorRow>[] = [
  { key: "고객ID", label: "고객ID", kind: "text" },
  { key: "그룹", label: "그룹", kind: "text" },
  { key: "월말예상(kWh)", label: "월말예상(kWh)", kind: "number" },
  { key: "추천요금제", label: "추천요금제", kind: "text" },
  { key: "TOU대비절감(원)", label: "TOU대비절감(만원)", kind: "manwon", get: (r) => r["TOU대비절감(원)"] },
  { key: "알림단계", label: "알림단계", kind: "text" },
  { key: "수요관리우선점수", label: "수요관리우선점수", kind: "number" },
];
const MONTHLY_CSV_COLUMNS: ColumnSpec<MonthlyMonitorRow>[] = [
  { key: "고객ID", label: "고객ID", kind: "text" },
  { key: "그룹", label: "그룹", kind: "text" },
  { key: "현재누적(kWh)", label: "현재누적(kWh)", kind: "number" },
  { key: "남은정액량(kWh)", label: "남은정액량(kWh)", kind: "number" },
  { key: "월말예상(kWh)", label: "월말예상(kWh)", kind: "number" },
  { key: "예측하한(kWh)", label: "예측하한(kWh)", kind: "number" },
  { key: "예측상한(kWh)", label: "예측상한(kWh)", kind: "number" },
  { key: "실제월사용량(kWh)", label: "실제월사용량(kWh)", kind: "number" },
  { key: "일반주택용(원)", label: "일반주택용(원)", kind: "money" },
  { key: "제주TOU(원)", label: "제주TOU(원)", kind: "money" },
  { key: "기본형(원)", label: "기본형(원)", kind: "money" },
  { key: "프리미엄형(원)", label: "프리미엄형(원)", kind: "money" },
  { key: "추천요금제", label: "추천요금제", kind: "text" },
  { key: "TOU대비절감(원)", label: "TOU대비절감(원)", kind: "money" },
  { key: "기본형제공량사용률(%)", label: "기본형제공량사용률(%)", kind: "percent" },
  { key: "프리미엄형제공량사용률(%)", label: "프리미엄형제공량사용률(%)", kind: "percent" },
  { key: "알림단계", label: "알림단계", kind: "text" },
  { key: "예측오차(%)", label: "예측오차(%)", kind: "percent" },
  { key: "패턴안정성점수", label: "패턴안정성점수", kind: "number" },
  { key: "수요관리우선점수", label: "수요관리우선점수", kind: "number" },
];

export function renderTab2(root: HTMLElement, ctx: AppContext): void {
  function paint(): void {
    root.innerHTML = "";
    root.append(...sectionTitle("요금 모니터링 및 요금제 추천"));

    // 필터 6~8개(분석기간·분석연도·[분석월·조회일]·정액알림기준요금제·정렬기준·
    // 추천요금제필터·그룹필터)를 한 행에 모아 보여준다 — 예전에는 3개 controlsRow로
    // 나뉘어 있었다. 여기서는 먼저 모든 값을 계산해 두고, 맨 아래에서 controlsRow
    // 하나로 합쳐 렌더링한다(모바일 폭에서는 controlsRow의 flex-wrap으로 자동
    // 줄바꿈된다). 추천요금제/그룹 필터는 monitor 계산 결과(현재 상태 기준)에서
    // 옵션 목록을 뽑아야 하므로, 아래에서 컨트롤을 만들기 전에 monitor부터 구한다.
    const maxday = daysInMonth(year, month);
    cutoff = Math.min(Math.max(cutoff, 5), Math.max(maxday - 1, 5));

    const monitor: MonitorRow[] =
      period === "연간 전체"
        ? buildAnnualMonitor(ctx.raw.monthly, ctx.state.enrichedByCid, year, ctx.state.fee)
        : buildMonthlyMonitor(
            ctx.state.customerDaily,
            ctx.raw.monthly,
            ctx.state.enrichedByCid,
            year,
            month,
            cutoff,
            currentPlan,
            ctx.state.fee
          );

    const periodControl = selectField(
      "분석 기간",
      [
        { value: "연간 전체", label: "연간 전체" },
        { value: "월중 모니터링", label: "월중 모니터링" },
      ],
      period,
      (v) => {
        period = v as Period;
        paint();
      }
    );
    const yearControl = selectField(
      "분석 연도",
      [2024, 2025].map((y) => ({ value: String(y), label: String(y) })),
      String(year),
      (v) => {
        year = Number(v) as 2024 | 2025;
        paint();
      }
    );

    const allControls: HTMLElement[] = [periodControl, yearControl];
    if (period !== "연간 전체") {
      const monthControl = selectField(
        "분석 월",
        Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({ value: String(m), label: String(m) })),
        String(month),
        (v) => {
          month = Number(v);
          paint();
        }
      );
      const cutoffControl = numberField(
        "조회일",
        cutoff,
        (v) => {
          cutoff = Math.min(Math.max(Math.round(v), 5), Math.max(maxday - 1, 5));
          paint();
        },
        { min: 5, max: Math.max(maxday - 1, 5), step: 1 }
      );
      allControls.push(monthControl, cutoffControl);
    }

    const currentPlanControl = selectField(
      "정액 알림 기준 요금제",
      [
        { value: "기본형", label: "기본형" },
        { value: "프리미엄형", label: "프리미엄형" },
      ],
      currentPlan,
      (v) => {
        currentPlan = v as "기본형" | "프리미엄형";
        paint();
      }
    );
    const sortKeyControl = selectField(
      "정렬 기준",
      ["수요관리우선점수", "TOU대비절감(원)", "월말예상(kWh)", "연간사용량(kWh)"].map((k) => ({ value: k, label: k })),
      sortKey,
      (v) => {
        sortKey = v as typeof sortKey;
        paint();
      }
    );
    allControls.push(currentPlanControl, sortKeyControl);

    if (monitor.length === 0) {
      root.append(controlsRow(allControls));
      if (period !== "연간 전체") {
        root.append(el("div", { className: "section-sub", text: `선택한 조회일: ${cutoff}일` }));
      }
      root.append(emptyNote("표시할 고객이 없습니다."));
      return;
    }

    // ── 추천요금제/그룹 필터 ──
    const planOptions = ["전체", ...[...new Set(monitor.map((r) => r.추천요금제 as string))].sort()];
    const clusterOptions = ["전체", ...[...new Set(monitor.map((r) => r.그룹))].sort()];
    if (!planOptions.includes(planFilter)) planFilter = "전체";
    if (!clusterOptions.includes(clusterFilter)) clusterFilter = "전체";

    const planFilterControl = selectField(
      "추천요금제 필터",
      planOptions.map((p) => ({ value: p, label: p })),
      planFilter,
      (v) => {
        planFilter = v;
        paint();
      }
    );
    const clusterFilterControl = selectField(
      "그룹 필터",
      clusterOptions.map((c) => ({ value: c, label: c })),
      clusterFilter,
      (v) => {
        clusterFilter = v;
        paint();
      }
    );
    allControls.push(planFilterControl, clusterFilterControl);

    root.append(controlsRow(allControls));
    if (period !== "연간 전체") {
      root.append(el("div", { className: "section-sub", text: `선택한 조회일: ${cutoff}일` }));
    }

    let show: MonitorRow[] = monitor;
    if (planFilter !== "전체") show = show.filter((r) => r.추천요금제 === (planFilter as PlanName));
    if (clusterFilter !== "전체") show = show.filter((r) => r.그룹 === clusterFilter);
    show = sortShow(show, sortKey);

    // ── 핵심 결과 배너: 조건에 맞는 고객 중 가장 많이 추천되는 요금제와 평균 절감액을
    // 지표 카드보다 먼저 한 문장으로 보여준다 ──
    const countByPlan = (plan: PlanName) => show.filter((r) => r.추천요금제 === plan).length;
    const avgSaving = mean(show.map((r) => r["TOU대비절감(원)"]));
    const planCounts = [...new Set(show.map((r) => r.추천요금제 as PlanName))].map((plan) => ({
      plan,
      count: countByPlan(plan),
    }));
    planCounts.sort((a, b) => b.count - a.count);
    const top = planCounts[0];
    root.append(
      insightBanner({
        tone: avgSaving > 0 ? "mint" : "gold",
        headline: top
          ? `현재 조건에서는 전체 ${show.length.toLocaleString("ko-KR")}명 중 ${top.count.toLocaleString(
              "ko-KR"
            )}명(${((top.count / show.length) * 100).toFixed(1)}%)에게 "${top.plan}" 요금제가 가장 많이 추천됩니다.`
          : "표시할 추천 결과가 없습니다.",
        detail:
          avgSaving > 0
            ? `제주 TOU 대비 평균 ${fmtWon(avgSaving)} 절감이 예상됩니다.`
            : undefined,
        stats: [{ value: fmtWon(avgSaving), label: "평균 절감가능액(TOU 대비)" }],
      })
    );

    // ── c1..c6 = st.columns(6) : 지표 카드 ──
    root.append(
      metricGrid([
        { label: "전체 고객", value: `${show.length.toLocaleString("ko-KR")}명` },
        { label: "일반주택용 추천", value: `${countByPlan("일반 주택용(저압)").toLocaleString("ko-KR")}명` },
        { label: "제주 TOU 추천", value: `${countByPlan("제주 TOU").toLocaleString("ko-KR")}명` },
        { label: "기본형 추천", value: `${countByPlan("구독 기본형").toLocaleString("ko-KR")}명` },
        { label: "프리미엄형 추천", value: `${countByPlan("구독 프리미엄형").toLocaleString("ko-KR")}명` },
        { label: "평균 절감가능액", value: fmtWon(avgSaving) },
      ])
    );

    // ── st.dataframe(show, ...) : 화면 표는 만원 단위로 줄인 열을 쓴다 ──
    // 열이 15개라 어떤 화면 폭에서도 좌우 스크롤이 생기던 문제 — "핵심 열만" 보기를
    // 기본으로 둬서 스크롤 없이 한눈에 보이게 하고, 필요하면 "전체 열"로 바꿔
    // 볼 수 있게 한다(그 경우엔 기존처럼 표 아래 가로 스크롤이 다시 생긴다).
    const columnModeControl = radioField(
      "표 보기",
      [
        { value: "핵심 열만", label: "핵심 열만" },
        { value: "전체 열", label: "전체 열" },
      ],
      columnMode,
      (v) => {
        columnMode = v as "핵심 열만" | "전체 열";
        paint();
      }
    );
    root.append(columnModeControl);
    const fullColumns = period === "연간 전체" ? ANNUAL_DISPLAY_COLUMNS : MONTHLY_DISPLAY_COLUMNS;
    const compactColumns = period === "연간 전체" ? ANNUAL_COMPACT_COLUMNS : MONTHLY_COMPACT_COLUMNS;
    const displayColumns = (columnMode === "핵심 열만" ? compactColumns : fullColumns) as unknown as ColumnSpec<
      Record<string, unknown>
    >[];
    root.append(renderTable(displayColumns, show as unknown as Record<string, unknown>[], { height: 520 }));

    // ── st.download_button(...) : CSV는 기존과 동일하게 원 단위 그대로 내려받는다 ──
    const csvColumns = (period === "연간 전체" ? ANNUAL_CSV_COLUMNS : MONTHLY_CSV_COLUMNS) as unknown as ColumnSpec<
      Record<string, unknown>
    >[];
    const csvRows = show.map((r) => roundRowForCsv(r, csvColumns) as unknown as Record<string, unknown>);
    root.append(
      downloadCsvButton(
        "고객별 요금 모니터링 CSV",
        `v30_${year}_${period}_요금모니터링.csv`,
        csvColumns,
        csvRows
      )
    );
  }

  paint();
}
