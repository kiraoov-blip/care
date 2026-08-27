/**
 * data/daily.json · data/profiles.json(둘 다 scripts/export_data.py가 압축 인코딩해
 * 내보낸 정적 데이터)을 원래 형태로 복원하는 디코더 + 그 위에서 동작하는
 * profile_for_customer / aggregate_portfolio_profile(원본 L296~307)의 TypeScript 이관.
 *
 * 원본 daily/profiles 테이블은 둘 다 빈 칸 없는 격자다: daily는 고객마다 정확히
 * 2024-01-01~2025-12-31의 731일이 하루도 안 빠지고 있고, profiles는 고객마다
 * 정확히 2개년×12개월×2일유형×24시간=1,152행이 있다(export_data.py에서 전수
 * 검증). 그래서 "고객ID·날짜/연·월·일유형·시간"을 매 행 반복 저장하는 대신 그
 * 축을 한 번만 저장하고, 고객별로는 그 축 순서에 맞춘 숫자 배열 하나만 저장했다.
 * 이 파일은 그 배열을 다시 원래 행 형태(DailyRow[] / 시간대별 평균)로 펼친다.
 *
 * daily.json의 "일유형"은 export_data.py가 원본 52만행 전체에서 확인한 대로
 * "주말" 하나뿐인 상수라 배열에 안 넣고 dayTypeConst로 한 번만 온다 —
 * decodeCustomerDaily가 모든 행에 이 값을 그대로 채워 넣는다.
 *
 * profiles.json의 평균사용량_kWh는 원본이 pandas mean()으로 만든 배정밀도
 * 실수를 소수 3자리(0.001kWh=1Wh)로 반올림해 저장했다(그대로 실으면 profiles.json이
 * 3배 가까이 커진다 — 자세한 이유는 scripts/export_data.py 주석 참고). 그래서
 * profileForCustomer/aggregatePortfolioProfile의 계절 평균은 "반올림 안 된 원본
 * 평균"과 완전히 같지는 않다 — 최대 오차는 반올림 폭의 절반(0.0005)을 넘지 않고,
 * tests/golden/timeseries.test.ts 가 이 오차 한도 안에서 골든값과 대조한다.
 */

import type { DailyRow } from "./forecast";

export interface DailyDataset {
  dates: string[]; // "YYYY-MM-DD", 오름차순, 모든 고객이 공유하는 공통 축
  dayTypeConst: string; // 이 데이터셋 전체에서 "일유형"이 갖는 유일한 값(원본 데이터 자체의 특성)
  customers: Record<string, number[]>; // 고객ID -> dates와 같은 길이의 일사용량_kWh
}

export interface ProfilesDataset {
  years: number[];
  months: number[];
  dayTypes: string[];
  hours: number[];
  // 고객ID -> years.length*months.length*dayTypes.length*hours.length 길이 배열
  // (인덱스 = ((연도idx*월수+월idx)*일유형수+일유형idx)*시간수+시간idx)
  customers: Record<string, number[]>;
}

function parseIsoDate(s: string): { 연도: number; 월: number; 일: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { 연도: y, 월: m, 일: d };
}

/** 고객 한 명의 daily.json 배열을 DailyRow[]로 복원한다(forecastMonthLongitudinal 등의 입력 형태). */
export function decodeCustomerDaily(dataset: DailyDataset, customerId: string): DailyRow[] {
  const usage = dataset.customers[customerId];
  if (!usage) return [];
  return dataset.dates.map((dateStr, i) => {
    const { 연도, 월 } = parseIsoDate(dateStr);
    return { 연도, 월, 일: parseIsoDate(dateStr).일, 일유형: dataset.dayTypeConst, 일사용량_kWh: usage[i] };
  });
}

/** 전체 고객의 daily.json을 한 번에 복원한다(buildMonthlyMonitor의 customerDaily 입력용). */
export function decodeAllCustomerDaily(dataset: DailyDataset): Map<string, DailyRow[]> {
  const out = new Map<string, DailyRow[]>();
  for (const cid of Object.keys(dataset.customers)) out.set(cid, decodeCustomerDaily(dataset, cid));
  return out;
}

// ── SEASON_MONTHS (원본 L58~62) ─────────────────────────────────────────
export const SEASON_MONTHS: Record<string, number[]> = {
  봄가을: [3, 4, 5, 9, 10],
  여름: [6, 7, 8],
  겨울: [1, 2, 11, 12],
};
export type Season = keyof typeof SEASON_MONTHS;

function profileIndex(dataset: ProfilesDataset, year: number, month: number, dayType: string, hour: number): number {
  const yi = dataset.years.indexOf(year);
  const mi = dataset.months.indexOf(month);
  const di = dataset.dayTypes.indexOf(dayType);
  const hi = dataset.hours.indexOf(hour);
  if (yi < 0 || mi < 0 || di < 0 || hi < 0) return -1;
  return ((yi * dataset.months.length + mi) * dataset.dayTypes.length + di) * dataset.hours.length + hi;
}

export interface HourlyProfilePoint {
  시간: number;
  평균사용량_kWh: number;
}

/**
 * profile_for_customer(profiles, cid, year, season, daytype) 이관 (원본 L296~299).
 * season에 속한 달들에 걸쳐 시간대별 평균을 낸다 — 이미 월평균인 값들을 계절
 * 단위로 다시 평균하는 것과 같다. pandas `groupby("시간", as_index=False).mean()`과
 * 동일하게 시간 오름차순으로 반환한다.
 */
export function profileForCustomer(
  dataset: ProfilesDataset,
  customerId: string,
  year: number,
  season: Season,
  dayType: string
): HourlyProfilePoint[] {
  const arr = dataset.customers[customerId];
  if (!arr) return [];
  const months = SEASON_MONTHS[season];
  return dataset.hours.map((hour) => {
    let sum = 0;
    let n = 0;
    for (const month of months) {
      const idx = profileIndex(dataset, year, month, dayType, hour);
      if (idx >= 0) {
        sum += arr[idx];
        n++;
      }
    }
    return { 시간: hour, 평균사용량_kWh: n ? sum / n : 0 };
  });
}

/**
 * aggregate_portfolio_profile(profiles, ids, year, season, daytype) 이관 (원본 L302~307).
 * 고객별로 먼저 계절 평균(profileForCustomer와 동일)을 낸 뒤, 시간대별로 그
 * 고객들의 값을 합산해 포트폴리오 곡선을 만든다. `hours` 순서 그대로 반환한다
 * (원본의 `reindex(range(1,25), fill_value=0.0)`과 동치 — 이 데이터셋은 항상
 * 1~24시가 전부 존재하므로 fill_value가 실제로 쓰일 일은 없다).
 */
export function aggregatePortfolioProfile(
  dataset: ProfilesDataset,
  customerIds: string[],
  year: number,
  season: Season,
  dayType: string
): number[] {
  const totals = new Array<number>(dataset.hours.length).fill(0);
  for (const cid of customerIds) {
    const perCustomer = profileForCustomer(dataset, cid, year, season, dayType);
    for (let i = 0; i < perCustomer.length; i++) totals[i] += perCustomer[i].평균사용량_kWh;
  }
  return totals;
}
