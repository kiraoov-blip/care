/**
 * CARE 고객별 패턴안정성점수·수요관리우선점수·구조변화신호(enrich_scores)의
 * TypeScript 이관.
 *
 * 원본: legacy/streamlit_app_actual_tou_v30.py 라인 242~271.
 *
 * 군집분석(joint_dynamic_clusters → kmeans_numpy, 라인 137~239)은 이관하지
 * 않았다. kmeans_numpy는 np.random.default_rng(42)(numpy의 PCG64 비트제너레이터)
 * 로 초기 중심을 뽑는데, 이걸 JS에서 비트 단위로 재현하려면 PCG64 전체와
 * numpy Generator.integers/choice의 표본추출 알고리즘까지 그대로 옮겨야 한다.
 * 반면 712명의 원본 데이터는 바뀌지 않으므로 군집 결과도 항상 동일하다 —
 * 브라우저에서 매번 다시 클러스터링할 이유가 없다. 그래서 이 결과는
 * scripts/export_data.py 가 Python에서 "한 번" 계산해 data/clusters.json 으로
 * 내보내고, enrichScores는 그 결과(ClusterWideRow[])를 입력으로 받아 나머지
 * 순수 산술 계산만 수행한다. (자세한 근거는 golden/golden_capture.py 의
 * clustering_and_enrich_full 주석 참고.)
 */

export interface ClusterWideRow {
  고객ID: string;
  "2024군집": string;
  "2025군집": string;
  군집유지여부: "유지" | "이동";
}

export interface CustomerRow {
  고객ID: string;
  연간사용량증감률: number;
  경부하비중_증감: number;
  중간부하비중_증감: number;
  최대부하비중_증감: number;
  주말주중비_증감: number;
  부하율_증감: number;
  "2025_최대시간사용량_kWh": number;
  "2025_최대부하비중": number;
  "2025_연간사용량_kWh": number;
  "2025_하계민감도": number;
  "2025_동계민감도": number;
  "20일예측_MAPE": number;
  추천요금제유지여부: "유지" | "변경";
  [key: string]: unknown;
}

export interface EnrichedCustomer extends CustomerRow {
  "2024군집": string;
  "2025군집": string;
  군집유지여부_동적: "유지" | "이동";
  패턴안정성점수: number;
  수요관리우선점수: number;
  구조변화신호: string;
}

function clip(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// pandas Series.rank(pct=True) 기본값(method="average", na_option="keep")과
// 동일: 동률은 순위 평균, 결측(NaN)은 순위도 NaN(→ 호출부에서 0.5로 대체).
function percentileRank(values: number[]): number[] {
  const n = values.length;
  const validIdx = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(values[i])) validIdx.push(i);
  const sortedValid = [...validIdx].sort((a, b) => values[a] - values[b]);
  const ranks = new Array<number>(n).fill(NaN);
  let i = 0;
  while (i < sortedValid.length) {
    let j = i;
    while (j + 1 < sortedValid.length && values[sortedValid[j + 1]] === values[sortedValid[i]]) j++;
    const avgRank = (i + 1 + (j + 1)) / 2; // 1-based, 동률 구간 평균
    for (let k = i; k <= j; k++) ranks[sortedValid[k]] = avgRank;
    i = j + 1;
  }
  const validCount = validIdx.length;
  return ranks.map((r) => (Number.isNaN(r) ? NaN : r / validCount));
}

function pct(values: number[]): number[] {
  return percentileRank(values).map((v) => (Number.isNaN(v) ? 0.5 : v));
}

// pandas DataFrame[[a,b]].max(axis=1, skipna=True 기본값)과 동일:
// 한쪽만 NaN이면 나머지 값, 둘 다 NaN이면 NaN.
function rowMax(a: number, b: number): number {
  const aFinite = Number.isFinite(a);
  const bFinite = Number.isFinite(b);
  if (aFinite && bFinite) return Math.max(a, b);
  if (aFinite) return a;
  if (bFinite) return b;
  return NaN;
}

export function enrichScores(customers: CustomerRow[], clusterWide: ClusterWideRow[]): EnrichedCustomer[] {
  const wideByCustomer = new Map<string, ClusterWideRow>();
  for (const w of clusterWide) wideByCustomer.set(w.고객ID, w);

  const n = customers.length;
  const usageChange = new Array<number>(n);
  const touChange = new Array<number>(n);
  const weekendChange = new Array<number>(n);
  const loadChange = new Array<number>(n);
  const maxTimeUsage2025 = new Array<number>(n);
  const maxLoadShare2025 = new Array<number>(n);
  const annualUsage2025 = new Array<number>(n);
  const seasonSensitivityMax = new Array<number>(n);
  const mape20 = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const c = customers[i];
    usageChange[i] = clip(Math.abs(c.연간사용량증감률) / 0.5, 0, 1);
    touChange[i] = clip(
      (Math.abs(c.경부하비중_증감) + Math.abs(c.중간부하비중_증감) + Math.abs(c.최대부하비중_증감)) / 0.3,
      0,
      1
    );
    weekendChange[i] = clip(Math.abs(c.주말주중비_증감) / 0.5, 0, 1);
    loadChange[i] = clip(Math.abs(c.부하율_증감) / 0.1, 0, 1);
    maxTimeUsage2025[i] = c["2025_최대시간사용량_kWh"];
    maxLoadShare2025[i] = c["2025_최대부하비중"];
    annualUsage2025[i] = c["2025_연간사용량_kWh"];
    seasonSensitivityMax[i] = rowMax(c["2025_하계민감도"], c["2025_동계민감도"]);
    mape20[i] = c["20일예측_MAPE"];
  }

  const pctMaxTimeUsage = pct(maxTimeUsage2025);
  const pctMaxLoadShare = pct(maxLoadShare2025);
  const pctAnnualUsage = pct(annualUsage2025);
  const pctSeasonSensitivity = pct(seasonSensitivityMax);
  const pctMape = pct(mape20);

  return customers.map((c, i) => {
    const w = wideByCustomer.get(c.고객ID);
    const cluster2024 = w?.["2024군집"] ?? "";
    const cluster2025 = w?.["2025군집"] ?? "";
    const clusterMoved = (w?.군집유지여부 ?? "유지") === "이동";

    let patternStability =
      100 * (1 - (0.45 * usageChange[i] + 0.25 * touChange[i] + 0.15 * weekendChange[i] + 0.15 * loadChange[i]));
    patternStability = clip(patternStability, 0, 100);

    const demandPriority =
      100 *
      (0.3 * pctMaxTimeUsage[i] +
        0.25 * pctMaxLoadShare[i] +
        0.2 * pctAnnualUsage[i] +
        0.15 * pctSeasonSensitivity[i] +
        0.1 * (1 - pctMape[i]));

    const planChanged = c.추천요금제유지여부 === "변경";
    let structuralSignal: string;
    if (c.연간사용량증감률 >= 0.2) structuralSignal = "사용량 20% 이상 증가";
    else if (c.연간사용량증감률 <= -0.2) structuralSignal = "사용량 20% 이상 감소";
    else if (clusterMoved && planChanged) structuralSignal = "그룹·요금제 동시변경";
    else if (clusterMoved) structuralSignal = "사용패턴 그룹 이동";
    else if (planChanged) structuralSignal = "추천요금제 변경";
    else structuralSignal = "안정";

    return {
      ...c,
      "2024군집": cluster2024,
      "2025군집": cluster2025,
      군집유지여부_동적: clusterMoved ? "이동" : "유지",
      패턴안정성점수: patternStability,
      수요관리우선점수: demandPriority,
      구조변화신호: structuralSignal,
    };
  });
}
