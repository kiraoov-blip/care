/**
 * 탭 6 "계통영향 분석 및 제어 시뮬레이션" — 원본 T6(streamlit_app_actual_tou_v30.py) 이관.
 * 100가구 무작위 표본 추출 → 대표일 부하곡선(2024/2025) → 변압기 목표 운전한도·직접제어
 * 참여율 설정 → optimizeTransformerProfile 결과(제어 전/후 곡선·지표) → 표본 고객목록표.
 *
 * 알려진 편차 2가지(작업 지시에 사전 승인됨):
 * 1) 표본 추출: 원본은 numpy PCG64(np.random.default_rng(seed).choice)를 쓰는데 브라우저에서
 *    비트 단위로 재현할 수 없다. 그래서 이 파일 안에서만 쓰는 결정론적 시드 PRNG(mulberry32)로
 *    Fisher-Yates 부분 셔플을 해 100가구를 뽑는다 — 같은 표본추출번호라도 원본 파이썬과
 *    100가구 구성이 100% 같지는 않다(안내 문구로 명시).
 * 2) ZIP 다운로드: zip 라이브러리가 없어 "100가구 분석결과 ZIP" 대신 CSV 2개(고객목록·
 *    변압기제어상세)를 각각 다운로드하는 버튼으로 대체한다.
 */

import type { AppContext } from "../main.js";
import {
  clear,
  el,
  metricGrid,
  type MetricSpec,
  renderTable,
  type ColumnSpec,
  numberField,
  selectField,
  radioField,
  controlsRow,
  downloadCsvButton,
  roundForDisplay,
  sectionTitle,
  subheading,
  insightBanner,
} from "../ui.js";
import { lineChart } from "../charts.js";
import { SEASON_MONTHS, type Season, aggregatePortfolioProfile } from "../../../lib/timeseries.js";
import { optimizeTransformerProfile } from "../../../lib/optimize.js";
import { fmtPct } from "../../../lib/format.js";
import type { EnrichedCustomer } from "../../../lib/enrich.js";

type DayType = "주중" | "주말";
const SEASON_KEYS = Object.keys(SEASON_MONTHS) as Season[];

// ── 탭 내부 위젯 상태(원본 st.number_input/selectbox/radio의 key=...에 대응) — 사이드바
// 값이 바뀌어 이 탭이 다시 그려져도 값이 유지되도록 모듈 전역에 둔다. ──
let seed = 42;
let season: Season = SEASON_KEYS[0];
let daytype: DayType = "주중";
let targetYear: 2024 | 2025 = 2025;
let limitPct = 90;
let participationPct = 70;

type PortfolioRow = {
  고객ID: string;
  "2024년 연간 사용량(kWh)": number;
  "2025년 연간 사용량(kWh)": number;
  "연간사용량증감률(%)": number;
  "2024년 그룹 유형": string;
  "2025년 그룹 유형": string;
};

type ControlRow = {
  시간: number;
  "제어전(kW)": number;
  "시간이동출력(kW)": number;
  "실제감축출력(kW)": number;
  "이동유입(kW)": number;
  "제어후(kW)": number;
  "운전한도(kW)": number;
};

/** mulberry32 — 이 파일 안에서만 쓰는 작은 결정론적 시드 PRNG(알려진 편차 1 참고). */
function mulberry32(seed0: number): () => number {
  let a = seed0 >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 정렬된 고객ID 목록에서 Fisher-Yates 부분 셔플로 최대 count명을 결정론적으로 뽑는다. */
function sampleCustomerIds(enriched: EnrichedCustomer[], seedValue: number, count: number): string[] {
  const ids = enriched.map((c) => c.고객ID).sort();
  const n = ids.length;
  const k = Math.min(count, n);
  const rand = mulberry32(seedValue);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rand() * (n - i));
    const tmp = ids[i];
    ids[i] = ids[j];
    ids[j] = tmp;
  }
  return ids.slice(0, k);
}

function fmtNum1(v: number): string {
  return v.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** round_table(원본) 대응 — CSV로 내보내기 직전에 금액 외 숫자열은 소수 1자리로 반올림한다. */
function roundRow<T extends Record<string, unknown>>(row: T, columns: { key: string; label: string }[]): T {
  const out: Record<string, unknown> = { ...row };
  for (const c of columns) {
    const v = out[c.key];
    if (typeof v === "number") out[c.key] = roundForDisplay(v, c.label);
  }
  return out as T;
}

/** 작은 진행률 막대(원본 st.progress 대응) — 채워진 트랙 + 아래 캡션. */
function progressWithCaption(pct: number, caption: string): HTMLDivElement {
  const clamped = Math.max(0, Math.min(100, pct));
  const track = el("div");
  track.style.cssText =
    "background:var(--chart-grid,#e2e8f0);border-radius:999px;height:8px;overflow:hidden;margin:0.3rem 0 0.2rem;";
  const fill = el("div");
  fill.style.cssText = `background:var(--chart-series-1);height:100%;width:${clamped}%;`;
  track.append(fill);
  return el("div", {}, [track, el("div", { className: "section-sub", text: caption })]);
}

export function renderTab6(root: HTMLElement, ctx: AppContext): void {
  clear(root);
  const { state } = ctx;

  root.append(
    ...sectionTitle(
      "계통영향 분석 및 제어 시뮬레이션",
      "712명 중 100가구를 무작위로 추출해 합산 부하곡선을 만들고, 변압기 목표 운전한도와 직접제어 참여율에 따른 피크 감축 효과를 시험합니다."
    )
  );

  root.append(...subheading("100 가구 무작위 추출 분석"));

  // ── c1,c2,c3,c4 = st.columns(4) ──
  const seedControl = numberField(
    "표본 추출번호",
    seed,
    (v) => {
      seed = Math.min(Math.max(Math.round(v), 0), 9999);
      renderTab6(root, ctx);
    },
    { min: 0, max: 9999, step: 1 }
  );
  const seasonControl = selectField(
    "계절",
    SEASON_KEYS.map((s) => ({ value: s, label: s })),
    season,
    (v) => {
      season = v as Season;
      renderTab6(root, ctx);
    }
  );
  const daytypeControl = radioField(
    "일 유형",
    [
      { value: "주중", label: "주중" },
      { value: "주말", label: "주말" },
    ],
    daytype,
    (v) => {
      daytype = v as DayType;
      renderTab6(root, ctx);
    }
  );
  const targetYearControl = selectField(
    "제어 적용연도",
    [
      { value: "2024", label: "2024" },
      { value: "2025", label: "2025" },
    ],
    String(targetYear),
    (v) => {
      targetYear = Number(v) as 2024 | 2025;
      renderTab6(root, ctx);
    }
  );
  root.append(controlsRow([seedControl, seasonControl, daytypeControl, targetYearControl]));
  root.append(
    el("div", {
      className: "section-sub",
      text: "표본은 이 브라우저 안에서 결정론적으로 추출되며, 원본 파이썬과 동일한 표본추출번호라도 100가구 구성이 100% 동일하지는 않습니다.",
    })
  );

  // ── rng.choice(..., size=100, replace=False) 대응(알려진 편차 1) ──
  const ids = sampleCustomerIds(state.enriched, seed, 100);
  const idSet = new Set(ids);
  const base24 = aggregatePortfolioProfile(ctx.raw.profilesDataset, ids, 2024, season, daytype);
  const base25 = aggregatePortfolioProfile(ctx.raw.profilesDataset, ids, 2025, season, daytype);

  const sampled = state.enriched.filter((c) => idSet.has(c.고객ID));
  const portfolioRows: PortfolioRow[] = sampled.map((c) => ({
    고객ID: c.고객ID,
    "2024년 연간 사용량(kWh)": Number(c["2024_연간사용량_kWh"]),
    "2025년 연간 사용량(kWh)": Number(c["2025_연간사용량_kWh"]),
    "연간사용량증감률(%)": c.연간사용량증감률 * 100,
    "2024년 그룹 유형": c["2024군집"],
    "2025년 그룹 유형": c["2025군집"],
  }));
  const portfolioSorted = [...portfolioRows].sort(
    (a, b) => b["2025년 연간 사용량(kWh)"] - a["2025년 연간 사용량(kWh)"]
  );

  const sum2024 = portfolioRows.reduce((s, r) => s + r["2024년 연간 사용량(kWh)"], 0);
  const sum2025 = portfolioRows.reduce((s, r) => s + r["2025년 연간 사용량(kWh)"], 0);
  const peak24 = base24.length ? Math.max(...base24) : 0;
  const peak25 = base25.length ? Math.max(...base25) : 0;
  const usageDelta = sum2024 !== 0 ? sum2025 / sum2024 - 1 : 0;
  const peakDelta = peak25 / Math.max(peak24, 1e-9) - 1;

  root.append(
    metricGrid([
      { label: "2024 연간 합계", value: `${fmtNum1(sum2024 / 1000)}MWh` },
      {
        label: "2025 연간 합계",
        value: `${fmtNum1(sum2025 / 1000)}MWh`,
        delta: fmtPct(usageDelta),
        deltaDirection: usageDelta < 0 ? "down" : "up",
      },
      { label: "2024 대표일 피크", value: `${fmtNum1(peak24)}kW` },
      {
        label: "2025 대표일 피크",
        value: `${fmtNum1(peak25)}kW`,
        delta: fmtPct(peakDelta),
        deltaDirection: peakDelta < 0 ? "down" : "up",
      },
    ] as MetricSpec[])
  );

  const hourLabels = Array.from({ length: 24 }, (_, i) => i + 1);
  const kwFormat = (v: number) => `${fmtNum1(v)}kW`;
  root.append(
    lineChart({
      xLabels: hourLabels,
      series: [
        { name: "2024 제어 전", values: base24 },
        { name: "2025 제어 전", values: base25 },
      ],
      yFormat: kwFormat,
    })
  );

  // ── a,b = st.columns(2) : 변압기 목표 운전한도·직접제어 참여율 ──
  const limitControl = numberField(
    "변압기 목표 운전한도(제어 전 최대부하 대비, %)",
    limitPct,
    (v) => {
      limitPct = Math.min(Math.max(Math.round(v), 60), 110);
      renderTab6(root, ctx);
    },
    { min: 60, max: 110, step: 1 }
  );
  const participationControl = numberField(
    "직접제어 참여율(%)",
    participationPct,
    (v) => {
      participationPct = Math.min(Math.max(Math.round(v), 0), 100);
      renderTab6(root, ctx);
    },
    { min: 0, max: 100, step: 5 }
  );
  const limitCol = el("div", {}, [
    limitControl,
    progressWithCaption(Math.round(((limitPct - 60) / 50) * 100), `현재 설정: ${limitPct}%`),
  ]);
  const participationCol = el("div", {}, [
    participationControl,
    progressWithCaption(participationPct, `현재 설정: ${participationPct}%`),
  ]);
  root.append(controlsRow([limitCol, participationCol]));

  const base = targetYear === 2024 ? base24 : base25;
  const result = optimizeTransformerProfile(base, limitPct / 100, participationPct / 100);

  root.append(...subheading("변압기 목표 운전한도 대응 시뮬레이션"));

  // ── 핵심 결과 배너: 제어 시뮬레이션의 결론(피크 감축 효과)을 지표 카드보다 먼저 ──
  const peakReduction = result.peakBefore > 0 ? (result.peakBefore - result.peakAfter) / result.peakBefore : 0;
  const stillOverLimit = result.hoursAfter > 0;
  root.append(
    insightBanner({
      tone: stillOverLimit ? "gold" : "mint",
      headline: `직접제어 참여율 ${participationPct}%, 목표 운전한도 ${limitPct}% 설정 시 피크가 ${fmtNum1(
        result.peakBefore
      )}kW에서 ${fmtNum1(result.peakAfter)}kW로 ${(peakReduction * 100).toFixed(1)}% 감소합니다.`,
      detail: stillOverLimit
        ? `그래도 하루 중 ${result.hoursAfter}시간은 목표 운전한도를 초과합니다(제어 전 ${result.hoursBefore}시간).`
        : `목표 운전한도를 초과하는 시간이 ${result.hoursBefore}시간에서 0시간으로 모두 해소됩니다.`,
      stats: [
        { value: `${fmtNum1(result.shifted)}kWh`, label: "시간이동량" },
        { value: `${fmtNum1(result.reduced)}kWh`, label: "실제 감축량" },
      ],
    })
  );

  root.append(
    metricGrid([
      { label: "제어 전 피크", value: `${fmtNum1(result.peakBefore)}kW` },
      { label: "목표 운전한도", value: `${fmtNum1(result.limit)}kW` },
      { label: "제어 후 피크", value: `${fmtNum1(result.peakAfter)}kW` },
      { label: "한도 초과시간", value: `${result.hoursBefore}→${result.hoursAfter}시간` },
      { label: "시간이동량", value: `${fmtNum1(result.shifted)}kWh` },
      { label: "실제 감축량", value: `${fmtNum1(result.reduced)}kWh` },
    ] as MetricSpec[])
  );

  const control: ControlRow[] = hourLabels.map((h, i) => ({
    시간: h,
    "제어전(kW)": base[i],
    "시간이동출력(kW)": result.shiftOut[i],
    "실제감축출력(kW)": result.reduction[i],
    "이동유입(kW)": result.shiftIn[i],
    "제어후(kW)": result.after[i],
    "운전한도(kW)": result.limit,
  }));

  root.append(
    lineChart({
      xLabels: hourLabels,
      series: [
        { name: "제어 전", values: control.map((r) => r["제어전(kW)"]) },
        { name: "제어 후", values: control.map((r) => r["제어후(kW)"]) },
        { name: "운전한도", values: control.map((r) => r["운전한도(kW)"]), dashed: true },
      ],
      yFormat: kwFormat,
    })
  );

  root.append(...subheading("100가구 표본 고객목록"));
  const psColumns: ColumnSpec<PortfolioRow>[] = [
    { key: "고객ID", label: "고객ID", kind: "text" },
    { key: "2024년 연간 사용량(kWh)", label: "2024년 연간 사용량(kWh)", kind: "number" },
    { key: "2025년 연간 사용량(kWh)", label: "2025년 연간 사용량(kWh)", kind: "number" },
    { key: "연간사용량증감률(%)", label: "연간사용량증감률(%)", kind: "percent" },
    { key: "2024년 그룹 유형", label: "2024년 그룹 유형", kind: "text" },
    { key: "2025년 그룹 유형", label: "2025년 그룹 유형", kind: "text" },
  ];
  root.append(renderTable(psColumns, portfolioSorted, { height: 420 }));

  // ── 알려진 편차 2: ZIP 대신 CSV 2개(고객목록·변압기제어상세) ──
  const psCsvRows = portfolioSorted.map((r) => roundRow(r, psColumns));
  const controlColumns: ColumnSpec<ControlRow>[] = [
    { key: "시간", label: "시간", kind: "number" },
    { key: "제어전(kW)", label: "제어전(kW)", kind: "number" },
    { key: "시간이동출력(kW)", label: "시간이동출력(kW)", kind: "number" },
    { key: "실제감축출력(kW)", label: "실제감축출력(kW)", kind: "number" },
    { key: "이동유입(kW)", label: "이동유입(kW)", kind: "number" },
    { key: "제어후(kW)", label: "제어후(kW)", kind: "number" },
    { key: "운전한도(kW)", label: "운전한도(kW)", kind: "number" },
  ];
  const controlCsvRows = control.map((r) => roundRow(r, controlColumns));
  root.append(
    controlsRow([
      downloadCsvButton("100가구 고객목록 CSV", "100가구_고객목록.csv", psColumns, psCsvRows),
      downloadCsvButton("100가구 변압기제어상세 CSV", "100가구_변압기제어상세.csv", controlColumns, controlCsvRows),
    ])
  );
}
