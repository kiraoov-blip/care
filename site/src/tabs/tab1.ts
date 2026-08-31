/**
 * 탭 1 "2024~2025년 사용량 분석" — 원본 L(with T1: 블록) 이관.
 * 지표 카드 5개 → 월별 평균 사용량 라인차트 → (월별 변화표 / 사용량 증감률 분포 막대)
 * → 계절·주중·주말 선택형 평균 부하곡선.
 */

import type { AppContext } from "../main.js";
import {
  clear,
  metricGrid,
  type MetricSpec,
  renderTable,
  type ColumnSpec,
  sectionCard,
  cardRow,
  sectionTitle,
  subheading,
  controlsRow,
  selectField,
  radioField,
  insightBanner,
} from "../ui.js";
import { lineChart, barChart, type LineSeries, type BarDatum } from "../charts.js";
import type { OverallMonthlyRow, MonthlyChangeRow, OverallProfileRow } from "../data.js";
import { fmtKwh, fmtPct } from "../../../lib/format.js";
import { SEASON_MONTHS } from "../../../lib/timeseries.js";
import type { EnrichedCustomer } from "../../../lib/enrich.js";

const SEASON_KEYS = Object.keys(SEASON_MONTHS);

// 탭 내부 위젯 상태(원본 st.selectbox/st.radio의 key="overview_season"/"overview_day"에 대응) —
// 사이드바 값과 달리 이 탭 안에서만 유지되는 로컬 상태다.
let selectedSeason: string = SEASON_KEYS[0]; // "봄가을"
let selectedDayType: "주중" | "주말" = "주중";

export function renderTab1(root: HTMLElement, ctx: AppContext): void {
  clear(root);
  const { raw, state } = ctx;
  const S = raw.stats;

  root.append(...sectionTitle("2024~2025년 사용량 분석"));

  // ── 핵심 결과 배너: 이 화면의 결론을 지표 카드보다 먼저, 한 문장으로 보여준다 ──
  const changeRate = S.연평균증감률;
  const isDecrease = changeRate < 0;
  root.append(
    insightBanner({
      tone: isDecrease ? "mint" : "brand",
      headline: `2025년 고객당 연평균 사용량은 전년 대비 ${Math.abs(changeRate * 100).toFixed(1)}% ${
        isDecrease ? "감소" : "증가"
      }했습니다.`,
      detail: `2개년 모두 자료가 있는 핵심 고객 ${S["2개년핵심고객수"].toLocaleString(
        "ko-KR"
      )}명 기준이며, 같은 그룹을 유지한 고객은 ${fmtPct(S.군집유지율)}, 추천 요금제를 유지한 고객은 ${fmtPct(
        state.tariffDynamic.annualStability
      )}입니다.`,
      stats: [
        { value: fmtKwh(S["2024연평균kWh"]), label: "2024년 연평균" },
        { value: fmtKwh(S["2025연평균kWh"]), label: "2025년 연평균" },
      ],
    })
  );

  // ── 지표 카드 5개 ──
  const metrics: MetricSpec[] = [
    { label: "분석 대상 고객", value: `${S["2개년핵심고객수"].toLocaleString("ko-KR")}명` },
    { label: "2024년 연평균 사용량", value: fmtKwh(S["2024연평균kWh"]) },
    {
      label: "2025년 연평균 사용량",
      value: fmtKwh(S["2025연평균kWh"]),
      delta: fmtPct(changeRate),
      deltaDirection: changeRate < 0 ? "down" : "up",
    },
    { label: "동일 그룹 유지 비율", value: fmtPct(S.군집유지율) },
    { label: "추천 요금제 유지 비율", value: fmtPct(state.tariffDynamic.annualStability) },
  ];
  root.append(metricGrid(metrics));

  // ── 월별 고객당 평균 사용량(2024 vs 2025) ──
  root.append(monthlyUsageLineChart(raw.overallMonthly));

  // ── 좌: 월별 변화표 / 우: 연간 사용량 증감률 분포 ──
  const leftCard = sectionCard(null, [monthlyChangeTable(raw.monthlyChange)]);
  const rightCard = sectionCard(null, [usageChangeDistributionChart(state.enriched)]);
  root.append(cardRow([leftCard, rightCard]));

  // ── 계절·주중/주말 평균 부하곡선 ──
  root.append(...subheading("계절·주중/주말 평균 부하곡선"));
  const seasonControl = selectField(
    "계절",
    SEASON_KEYS.map((k) => ({ value: k, label: k })),
    selectedSeason,
    (v) => {
      selectedSeason = v;
      renderTab1(root, ctx);
    }
  );
  const dayTypeControl = radioField(
    "일 유형",
    [
      { value: "주중", label: "주중" },
      { value: "주말", label: "주말" },
    ],
    selectedDayType,
    (v) => {
      selectedDayType = v as "주중" | "주말";
      renderTab1(root, ctx);
    }
  );
  root.append(controlsRow([seasonControl, dayTypeControl]));
  root.append(profileLineChart(raw.overallProfiles, selectedSeason, selectedDayType));
}

/** 월별 고객당 평균 사용량 라인차트(원본 om=D["overall_monthly"]..., px.line). */
function monthlyUsageLineChart(overallMonthly: OverallMonthlyRow[]): HTMLDivElement {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = [2024, 2025];
  const series: LineSeries[] = years.map((year, idx) => ({
    name: String(year),
    colorIndex: idx,
    values: months.map((m) => {
      const row = overallMonthly.find((r) => r.연도 === year && r.월 === m);
      return row ? row.고객당평균_kWh : null;
    }),
  }));
  return lineChart({
    xLabels: months,
    series,
    xTickEvery: 1,
    showMarkers: false,
    yFormat: fmtKwh,
    yLabel: "고객당 평균 사용량(kWh)",
  });
}

/** 월별 변화표(원본 mc=D["monthly_change"][...] .rename(...)). */
function monthlyChangeTable(monthlyChange: MonthlyChangeRow[]): HTMLDivElement {
  const rows = monthlyChange.map((r) => ({
    월: String(r.월),
    "2024년 고객당 평균 사용량(kWh)": r["2024고객당평균_kWh"],
    "2025년 고객당 평균 사용량(kWh)": r["2025고객당평균_kWh"],
    "사용량 증감(kWh)": r.증감_kWh,
    "증감률(%)": r.증감률 * 100,
    "경부하 비중 증감(%p)": r.경부하비중증감p * 100,
    "최대부하 비중 증감(%p)": r.최대부하비중증감p * 100,
  }));
  const columns: ColumnSpec<Record<string, unknown>>[] = [
    { key: "월", label: "월", kind: "text" },
    { key: "2024년 고객당 평균 사용량(kWh)", label: "2024년 고객당 평균 사용량(kWh)", kind: "number" },
    { key: "2025년 고객당 평균 사용량(kWh)", label: "2025년 고객당 평균 사용량(kWh)", kind: "number" },
    { key: "사용량 증감(kWh)", label: "사용량 증감(kWh)", kind: "number" },
    { key: "증감률(%)", label: "증감률(%)", kind: "percent" },
    { key: "경부하 비중 증감(%p)", label: "경부하 비중 증감(%p)", kind: "percent" },
    { key: "최대부하 비중 증감(%p)", label: "최대부하 비중 증감(%p)", kind: "percent" },
  ];
  return renderTable(columns, rows);
}

/** 연간 사용량 증감률 분포 막대(원본 pd.cut(customers["연간사용량증감률"], [...])).
 * 구간을 기존 5단계(20%감소/5~20%감소/±5%이내/5~20%증가/20%증가)에서 7단계로
 * 더 세분화해 달라는 요청 — 5~20%였던 두 구간을 각각 5~10%/10~20%로 한 번 더
 * 나눴다. 높이(height)는 옆 카드의 "월별 변화표"(12개월 행 + 헤더)와 시각적으로
 * 맞도록 기본값(240)보다 훨씬 크게(460) 지정한다 — .card-row가 flex(기본
 * align-items:stretch)라 두 카드의 세로 길이는 이미 같아지지만, 차트 자체의
 * viewBox 비율이 낮으면 카드 안에서 위쪽에 작게 그려지고 아래가 빈 채로 남으므로
 * viewBox 높이 자체를 표 높이에 맞춰 키운다. */
function usageChangeDistributionChart(enriched: EnrichedCustomer[]): HTMLDivElement {
  const bins: { label: string; test: (v: number) => boolean }[] = [
    { label: "20% 이상 감소", test: (v) => v <= -0.2 },
    { label: "10~20% 감소", test: (v) => v > -0.2 && v <= -0.1 },
    { label: "5~10% 감소", test: (v) => v > -0.1 && v <= -0.05 },
    { label: "±5% 이내", test: (v) => v > -0.05 && v <= 0.05 },
    { label: "5~10% 증가", test: (v) => v > 0.05 && v <= 0.1 },
    { label: "10~20% 증가", test: (v) => v > 0.1 && v <= 0.2 },
    { label: "20% 이상 증가", test: (v) => v > 0.2 },
  ];
  const counts = bins.map(() => 0);
  for (const c of enriched) {
    const v = c.연간사용량증감률;
    const idx = bins.findIndex((b) => b.test(v));
    if (idx >= 0) counts[idx]++;
  }
  const total = enriched.length;
  const data: BarDatum[] = bins.map((b, i) => ({ label: b.label, value: counts[i] }));
  return barChart({
    data,
    width: 560, // card-row 절반 폭 카드에 들어가므로 전체 폭 기본값(820) 대신 좁게 지정
    height: 460, // 옆 "월별 변화표"(12행) 높이에 맞춰 세로로 늘린다(기본값 240 → 460)
    valueFormat: (v) => `${total > 0 ? ((v / total) * 100).toFixed(1) : "0.0"}%`,
    highlightMax: true,
  });
}

/** 계절·주중/주말 평균 부하곡선(원본 pp=D["overall_profiles"][...], px.line). */
function profileLineChart(overallProfiles: OverallProfileRow[], season: string, dayType: string): HTMLDivElement {
  const filtered = overallProfiles.filter((r) => r.계절 === season && r.일유형 === dayType);
  const hours = Array.from({ length: 24 }, (_, i) => i + 1);
  const years = [2024, 2025];
  const series: LineSeries[] = years.map((year, idx) => ({
    name: String(year),
    colorIndex: idx,
    values: hours.map((h) => {
      const row = filtered.find((r) => r.연도 === year && r.시간 === h);
      return row ? row.고객당평균_kWh : null;
    }),
  }));
  return lineChart({
    xLabels: hours,
    series,
    xTickValues: [1, 3, 6, 9, 12, 15, 18, 21, 24],
    showMarkers: false,
    yFormat: (v) => `${v.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}kWh/h`,
  });
}
