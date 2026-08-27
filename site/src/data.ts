/**
 * data/*.json 정적 데이터를 fetch로 불러와 lib/*.ts 함수들이 바로 쓸 수 있는 타입으로
 * 노출한다. 원본 Streamlit의 `D=load_data()`(전역에서 한 번 로드) + `customers=enrich_scores(...)`
 * + `tariff_dynamic=dynamic_tariff_analysis(...)`(사이드바 값이 바뀔 때마다 재계산)에
 * 대응하는 앱 상태를 여기서 구성한다.
 */

import type { CustomerRow, ClusterWideRow, EnrichedCustomer } from "../../lib/enrich.js";
import { enrichScores } from "../../lib/enrich.js";
import type { MonthlyRow, FeeParams, DynamicTariffResult } from "../../lib/tariff-monitor.js";
import { dynamicTariffAnalysis } from "../../lib/tariff-monitor.js";
import type { DailyDataset, ProfilesDataset } from "../../lib/timeseries.js";
import { decodeAllCustomerDaily } from "../../lib/timeseries.js";
import type { DailyRow } from "../../lib/forecast.js";

export interface ClusterSummaryRow {
  군집: string;
  연도: number;
  고객수: number;
  비중: number;
  연간사용량_kWh: number;
  최대시간사용량_kWh: number;
  주말주중비: number;
  경부하비중: number;
  중간부하비중: number;
  최대부하비중: number;
  월변동계수: number;
  부하율: number;
  하계민감도: number;
  동계민감도: number;
  [key: string]: unknown;
}
export interface ClusterTransitionRow {
  "2024군집": string;
  "2025군집": string;
  고객수: number;
  "2024군집내비중": number;
}
export interface ClustersPayload {
  wide: ClusterWideRow[];
  summary: ClusterSummaryRow[];
  transition: ClusterTransitionRow[];
}

export interface StatsPayload {
  전체2024고객수: number;
  전체2025고객수: number;
  일치고객수: number;
  "2개년핵심고객수": number;
  "2024연평균kWh": number;
  "2025연평균kWh": number;
  연평균증감률: number;
  군집유지율: number;
  추천요금제유지율: number;
  [key: string]: unknown;
}
export interface OverallMonthlyRow {
  연도: number;
  월: number;
  고객당평균_kWh: number;
  고객당중앙값_kWh: number;
  전체_MWh: number;
  경부하비중: number;
  중간부하비중: number;
  최대부하비중: number;
}
export interface MonthlyChangeRow {
  월: number;
  "2024고객당평균_kWh": number;
  "2025고객당평균_kWh": number;
  증감_kWh: number;
  증감률: number;
  "2024경부하비중": number;
  "2025경부하비중": number;
  경부하비중증감p: number;
  "2024최대부하비중": number;
  "2025최대부하비중": number;
  최대부하비중증감p: number;
}
export interface OverallProfileRow {
  연도: number;
  계절: string;
  일유형: string;
  시간: number;
  고객당평균_kWh: number;
}
export interface GlossaryRow {
  "화면 위치": string;
  구분: string;
  "용어·문구": string;
  "쉬운 설명": string;
  "계산·판단 기준·예시": string;
  유의사항: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다: ${path} (${res.status})`);
  return (await res.json()) as T;
}

export interface RawData {
  customers: CustomerRow[];
  monthly: MonthlyRow[];
  stats: StatsPayload;
  overallMonthly: OverallMonthlyRow[];
  monthlyChange: MonthlyChangeRow[];
  overallProfiles: OverallProfileRow[];
  dailyDataset: DailyDataset;
  profilesDataset: ProfilesDataset;
  glossary: GlossaryRow[];
  clustersByK: Map<number, ClustersPayload>;
}

const CLUSTER_KS = [3, 4, 5, 6, 7, 8];

/**
 * DATA_BASE는 site/index.html이 있는 위치를 기준으로 한 상대경로다.
 *
 * GitHub Pages에는 저장소 전체가 아니라 site/ 폴더 하나만 업로드된다
 * (.github/workflows/deploy-pages.yml의 upload-pages-artifact가 `path: ./site`).
 * data/ 는 site/ 바깥(저장소 루트)에 있는 폴더라 "../data"로는 실제 배포본에서
 * 절대 찾을 수 없다 — 배포 루트보다 한 단계 위로 나가버리기 때문이다(404 원인).
 * 그래서 배포 워크플로가 업로드 직전에 data/ 를 site/data/ 로 복사해 두고,
 * 여기서는 site/ 안에 있는 그 복사본을 "./data"로 가리킨다. 로컬에서 미리보기할
 * 때도 마찬가지로 site/data/ 가 있어야 하므로, README의 로컬 검증 절차를 따르면
 * (scripts/copy-data-for-preview.sh) 자동으로 준비된다.
 */
const DATA_BASE = "./data";

let rawDataPromise: Promise<RawData> | null = null;

export function loadRawData(): Promise<RawData> {
  if (!rawDataPromise) {
    rawDataPromise = (async () => {
      const [
        customers,
        monthly,
        stats,
        overallMonthly,
        monthlyChange,
        overallProfiles,
        dailyDataset,
        profilesDataset,
        glossary,
        ...clusterPayloads
      ] = await Promise.all([
        getJson<CustomerRow[]>(`${DATA_BASE}/customers.json`),
        getJson<MonthlyRow[]>(`${DATA_BASE}/monthly.json`),
        getJson<StatsPayload>(`${DATA_BASE}/stats.json`),
        getJson<OverallMonthlyRow[]>(`${DATA_BASE}/overall-monthly.json`),
        getJson<MonthlyChangeRow[]>(`${DATA_BASE}/monthly-change.json`),
        getJson<OverallProfileRow[]>(`${DATA_BASE}/overall-profiles.json`),
        getJson<DailyDataset>(`${DATA_BASE}/daily.json`),
        getJson<ProfilesDataset>(`${DATA_BASE}/profiles.json`),
        getJson<GlossaryRow[]>(`${DATA_BASE}/glossary.json`),
        ...CLUSTER_KS.map((k) =>
          getJson<ClustersPayload>(`${DATA_BASE}/${k === 8 ? "clusters.json" : `clusters-${k}.json`}`)
        ),
      ]);
      const clustersByK = new Map<number, ClustersPayload>();
      CLUSTER_KS.forEach((k, i) => clustersByK.set(k, clusterPayloads[i] as ClustersPayload));
      return {
        customers,
        monthly,
        stats,
        overallMonthly,
        monthlyChange,
        overallProfiles,
        dailyDataset,
        profilesDataset,
        glossary,
        clustersByK,
      };
    })();
  }
  return rawDataPromise;
}

export interface DerivedState {
  clusterCount: number;
  fee: FeeParams;
  clusters: ClustersPayload;
  enriched: EnrichedCustomer[];
  enrichedByCid: Map<string, EnrichedCustomer>;
  tariffDynamic: DynamicTariffResult;
  customerDaily: Map<string, DailyRow[]>;
}

const customerDailyCache = new WeakMap<DailyDataset, Map<string, DailyRow[]>>();

/** 사이드바 값(그룹 수·요금 가정)이 바뀔 때마다 다시 계산한다(원본의 재계산 흐름과 동일). */
export function computeDerivedState(raw: RawData, clusterCount: number, fee: FeeParams): DerivedState {
  const clusters = raw.clustersByK.get(clusterCount);
  if (!clusters) throw new Error(`clusters-${clusterCount}.json 이 없습니다`);
  const enriched = enrichScores(raw.customers, clusters.wide);
  const enrichedByCid = new Map(enriched.map((e) => [e.고객ID, e]));
  const tariffDynamic = dynamicTariffAnalysis(raw.monthly, fee);
  let customerDaily = customerDailyCache.get(raw.dailyDataset);
  if (!customerDaily) {
    customerDaily = decodeAllCustomerDaily(raw.dailyDataset);
    customerDailyCache.set(raw.dailyDataset, customerDaily);
  }
  return { clusterCount, fee, clusters, enriched, enrichedByCid, tariffDynamic, customerDaily };
}

/** cluster_col(원본 L1356) — enrichScores 산출물의 그룹 컬럼명은 항상 `${year}군집`. */
export function clusterColKey(year: 2024 | 2025): "2024군집" | "2025군집" {
  return `${year}군집` as "2024군집" | "2025군집";
}
