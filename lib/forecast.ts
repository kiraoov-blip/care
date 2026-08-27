/**
 * CARE 당월 사용량 예측(forecast_month_longitudinal) + 알림단계(alert_level)의
 * TypeScript 이관.
 *
 * 원본: legacy/streamlit_app_actual_tou_v30.py 라인 630~664.
 * 조회일(cutoff_day)까지의 실측치와 전년 동월 패턴을 가중합(alpha)해
 * 월말 사용량을 예측한다. daily.일사용량_kWh 의 모집단 표준편차(ddof=0)로
 * 예측 구간(lower/upper)의 불확실성을 추정한다.
 */

export interface DailyRow {
  연도: number;
  월: number;
  일: number;
  일유형: string;
  일사용량_kWh: number;
}

export interface ForecastResult {
  current: number;
  forecast: number;
  lower: number;
  upper: number;
  actual: number;
  remaining_days: number;
  observed_days: number;
  days_in_month: number;
}

function sumBy(rows: DailyRow[]): number {
  return rows.reduce((s, r) => s + r.일사용량_kWh, 0);
}

function meanBy(rows: DailyRow[]): number {
  return rows.length ? sumBy(rows) / rows.length : 0;
}

// pandas groupby("일유형")["일사용량_kWh"].mean().to_dict() 와 동일.
function groupMeans(rows: DailyRow[]): Map<string, number> {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const e = sums.get(r.일유형) ?? { sum: 0, n: 0 };
    e.sum += r.일사용량_kWh;
    e.n += 1;
    sums.set(r.일유형, e);
  }
  const out = new Map<string, number>();
  for (const [k, v] of sums) out.set(k, v.sum / v.n);
  return out;
}

// pandas .std(ddof=0) = 모집단 표준편차 (N으로 나눔, N-1 아님).
function populationStd(rows: DailyRow[]): number {
  const n = rows.length;
  const m = meanBy(rows);
  const variance = rows.reduce((s, r) => s + (r.일사용량_kWh - m) ** 2, 0) / n;
  return Math.sqrt(variance);
}

export function forecastMonthLongitudinal(
  customerDaily: DailyRow[],
  year: number,
  month: number,
  cutoffDay: number
): ForecastResult {
  const dm = customerDaily
    .filter((r) => r.연도 === year && r.월 === month)
    .sort((a, b) => a.일 - b.일);
  const observed = dm.filter((r) => r.일 <= cutoffDay);
  const remaining = dm.filter((r) => r.일 > cutoffDay);
  const actual = sumBy(dm);
  const current = sumBy(observed);
  const currentMeans = groupMeans(observed);
  const currentOverall = observed.length ? meanBy(observed) : 0.0;

  const prev = customerDaily.filter((r) => r.연도 === year - 1 && r.월 === month);
  const prevMeans = groupMeans(prev);
  const prevOverall = prev.length ? meanBy(prev) : currentOverall;

  const alpha = prev.length
    ? Math.min(0.85, Math.max(0.55, observed.length / Math.max(cutoffDay, 1)))
    : 1.0;

  let predRemaining = 0.0;
  for (const r of remaining) {
    const cur = currentMeans.get(r.일유형) ?? currentOverall;
    const prv = prevMeans.get(r.일유형) ?? prevOverall;
    predRemaining += alpha * cur + (1 - alpha) * prv;
  }
  const forecast = current + predRemaining;

  const stdParts: number[] = [];
  if (observed.length > 1) stdParts.push(populationStd(observed));
  if (prev.length > 1) stdParts.push(populationStd(prev));
  const dailyStd = stdParts.length ? stdParts.reduce((a, b) => a + b, 0) / stdParts.length : 0.0;
  const uncertainty = 1.28 * dailyStd * Math.sqrt(Math.max(remaining.length, 1));

  return {
    current,
    forecast,
    lower: Math.max(current, forecast - uncertainty),
    upper: forecast + uncertainty,
    actual,
    remaining_days: remaining.length,
    observed_days: observed.length,
    days_in_month: dm.length,
  };
}

// ── alert_level (L658~664) ─────────────────────────────────────────────
export function alertLevel(current: number, forecast: number, included: number): string {
  const used = current / Math.max(included, 1e-9);
  const projected = forecast / Math.max(included, 1e-9);
  if (current >= included || used >= 0.95 || projected >= 1.25) return "긴급";
  if (used >= 0.85 || projected >= 1.1) return "경고";
  if (used >= 0.7 || projected > 1.0) return "주의";
  if (used >= 0.5 || projected >= 0.9) return "관심";
  return "정상";
}
