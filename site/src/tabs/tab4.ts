/**
 * 탭 4 "고객 그룹 분석" — 원본 L(with T4: 블록) 이관.
 * 그룹별 요약표 → 그룹 유지율 지표 카드 3개 → 2024→2025 그룹 이동 히트맵 → 이동 상세표.
 * 사이드바의 그룹 수(ctx.state.clusterCount)를 그대로 반영할 뿐, 이 탭 자체에는
 * 로컬 위젯이 없다(원본에도 T4 안에는 st.selectbox/st.radio 등이 없음).
 */

import type { AppContext } from "../main.js";
import { clear, metricGrid, type MetricSpec, renderTable, type ColumnSpec, sectionTitle } from "../ui.js";
import { heatmap } from "../charts.js";
import type { ClusterSummaryRow, ClusterTransitionRow } from "../data.js";
import { fmtPct } from "../../../lib/format.js";

/** source_col → display_col(원본 percentage_map, L~) 순서 그대로. */
const PERCENTAGE_MAP: [keyof ClusterSummaryRow, string][] = [
  ["주말주중비", "주중 대비 주말 사용량 비중(%)"],
  ["경부하비중", "경부하 비중(%)"],
  ["중간부하비중", "중간부하 비중(%)"],
  ["최대부하비중", "최대부하 비중(%)"],
  ["월변동계수", "월 변동계수(%)"],
  ["부하율", "부하율(%)"],
  ["하계민감도", "하계 민감도(%)"],
  ["동계민감도", "동계 민감도(%)"],
];

export function renderTab4(root: HTMLElement, ctx: AppContext): void {
  clear(root);
  const { state } = ctx;
  const { clusters, clusterCount } = state;

  root.append(...sectionTitle(`공통 기준 ${clusterCount}개 그룹과 2024→2025 이동`));

  root.append(clusterSummaryTable(clusters.summary));

  const stability =
    clusters.wide.length > 0 ? clusters.wide.filter((w) => w.군집유지여부 === "유지").length / clusters.wide.length : 0;
  const movedCount = clusters.wide.filter((w) => w.군집유지여부 === "이동").length;
  const metrics: MetricSpec[] = [
    { label: "동일 그룹 유지율", value: fmtPct(stability) },
    { label: "그룹 이동 고객", value: `${movedCount.toLocaleString("ko-KR")}명` },
    { label: "그룹 수", value: `${clusterCount}개` },
  ];
  root.append(metricGrid(metrics));

  root.append(transitionHeatmap(clusters.transition));

  root.append(transitionDetailTable(clusters.transition));
}

/** cs(원본 cluster_summary 가공) — 그룹별 연도별 요약표. */
function clusterSummaryTable(summary: ClusterSummaryRow[]): HTMLDivElement {
  type Row = {
    그룹: string;
    연도: string;
    고객수: number;
    "비중(%)": number;
    "연간 사용량(kWh)": number;
    "최대시간 사용량(kWh)": number;
    [displayCol: string]: unknown;
  };
  const rows: Row[] = summary.map((r) => {
    const row: Row = {
      그룹: r.군집,
      연도: String(r.연도),
      고객수: r.고객수,
      "비중(%)": r.비중 * 100,
      "연간 사용량(kWh)": r.연간사용량_kWh,
      "최대시간 사용량(kWh)": r.최대시간사용량_kWh,
    };
    for (const [sourceCol, displayCol] of PERCENTAGE_MAP) {
      row[displayCol] = (r[sourceCol] as number) * 100;
    }
    return row;
  });
  rows.sort((a, b) => {
    const yearDiff = Number(a.연도) - Number(b.연도);
    if (yearDiff !== 0) return yearDiff;
    return b.고객수 - a.고객수;
  });

  const columns: ColumnSpec<Row>[] = [
    { key: "그룹", label: "그룹", kind: "text" },
    { key: "연도", label: "연도", kind: "text" },
    { key: "고객수", label: "고객수", kind: "count" },
    { key: "비중(%)", label: "비중(%)", kind: "percent" },
    { key: "연간 사용량(kWh)", label: "연간 사용량(kWh)", kind: "number" },
    { key: "최대시간 사용량(kWh)", label: "최대시간 사용량(kWh)", kind: "number" },
    ...PERCENTAGE_MAP.map(([, displayCol]) => ({ key: displayCol, label: displayCol, kind: "percent" as const })),
  ];
  return renderTable(columns, rows);
}

/** matrix(원본 cluster_transition.pivot(...)) → 히트맵. */
function transitionHeatmap(transition: ClusterTransitionRow[]): HTMLDivElement {
  const rowLabels = Array.from(new Set(transition.map((t) => t["2024군집"]))).sort();
  const colLabels = Array.from(new Set(transition.map((t) => t["2025군집"]))).sort();
  const matrix: number[][] = rowLabels.map((rowLabel) =>
    colLabels.map((colLabel) => {
      const found = transition.find((t) => t["2024군집"] === rowLabel && t["2025군집"] === colLabel);
      return found ? found.고객수 : 0;
    })
  );
  return heatmap({ rowLabels, colLabels, matrix, valueFormat: (v) => v.toLocaleString("ko-KR") });
}

/** tt(원본 cluster_transition 가공) — 이동 상세표. */
function transitionDetailTable(transition: ClusterTransitionRow[]): HTMLDivElement {
  type Row = {
    "2024년 그룹": string;
    "2025년 그룹": string;
    "고객수(명)": number;
    "2024년 그룹 내 비중(%)": number;
  };
  const rows: Row[] = transition.map((t) => ({
    "2024년 그룹": t["2024군집"],
    "2025년 그룹": t["2025군집"],
    "고객수(명)": t.고객수,
    "2024년 그룹 내 비중(%)": t["2024군집내비중"] * 100,
  }));
  const columns: ColumnSpec<Row>[] = [
    { key: "2024년 그룹", label: "2024년 그룹", kind: "text" },
    { key: "2025년 그룹", label: "2025년 그룹", kind: "text" },
    { key: "고객수(명)", label: "고객수(명)", kind: "count" },
    { key: "2024년 그룹 내 비중(%)", label: "2024년 그룹 내 비중(%)", kind: "percent" },
  ];
  return renderTable(columns, rows);
}
