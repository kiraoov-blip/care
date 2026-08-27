/**
 * CARE(streamlit_app_actual_tou_v30.py) 요금 계산 함수의 TypeScript 이관.
 *
 * 원본: legacy/streamlit_app_actual_tou_v30.py (라인 403~571 부근)
 * 이관 원칙: 원본의 계산 순서·반올림/절사 규칙을 한 글자도 바꾸지 않고 그대로 옮긴다.
 *   - 기본요금·전력량요금·기후환경요금·연료비조정액: 원 미만 절사
 *   - 부가가치세: 원 미만 반올림(4사5입)
 *   - 전력산업기반기금 및 최종 청구액: 10원 미만 절사
 * 검증: tests/golden/billing.test.mjs 가 tests/golden/care-reference.local.json
 * (골든 캡처 결과)과 이 파일의 출력을 1:1 대조한다.
 */

// ── 원본 상단 상수 (streamlit_app_actual_tou_v30.py L54~59) ──────────────
export const FUEL_ADJUSTMENT_RATE = 5.0; // 원/kWh
export const CLIMATE_ENV_RATE = 9.0; // 원/kWh
export const VAT_RATE = 0.1; // 10%
export const POWER_FUND_RATE = 0.027; // 2.7%
export const TOU_CONTRACT_KW = 3.0; // 제주 TOU 계약전력 가정
export const SUPERUSER_RATE = 736.2; // 원/kWh

export const PLAN_DEFAULTS: Record<string, { fee: number; included: number }> = {
  기본형: { fee: 84_900.0, included: 450.0 },
  프리미엄형: { fee: 249_000.0, included: 1_000.0 },
};

// ── 반올림/절사 규칙 (L416~433) ───────────────────────────────────────
// 원본은 파이썬 math.floor(value + eps) 를 그대로 쓴다. JS Math.floor는
// 음의 0 이나 부동소수 오차 처리가 파이썬과 동일하므로 그대로 옮긴다.

export function roundHalfUp(value: number): number {
  // 양수의 4사5입 반올림.
  return Math.floor(value + 0.5);
}

export function truncateWon(value: number): number {
  // 원 미만 절사.
  return Math.floor(Math.max(value, 0.0) + 1e-9);
}

export function truncate10Won(value: number): number {
  // 청구금액의 10원 미만 절사.
  return Math.floor(Math.max(value, 0.0) / 10.0 + 1e-12) * 10;
}

export function billedKwh(kwh: number): number {
  // 전기요금 계산단위 1kWh에 맞춰 사용량을 반올림.
  return Math.max(roundHalfUp(Math.max(kwh, 0.0)), 0);
}

// ── 시간대 비중 → 정수 kWh 배분 (L436~451) ────────────────────────────
export function allocateIntegerKwh(totalKwh: number, shares: number[]): number[] {
  // 시간대 비중을 정수 kWh로 배분하면서 합계가 정확히 일치하도록 함.
  const total = Math.max(Math.trunc(totalKwh), 0);
  let arr = shares.map((v) => (Number.isFinite(v) && v > 0 ? v : 0.0));
  const sum = arr.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    const n = Math.max(arr.length, 1);
    arr = arr.map(() => 1.0 / n);
  } else {
    arr = arr.map((v) => v / sum);
  }
  const raw = arr.map((v) => v * total);
  const base = raw.map((v) => Math.floor(v));
  let remain = total - base.reduce((a, b) => a + b, 0);
  if (remain > 0) {
    // np.argsort(-(raw-base)) : 소수부가 큰 순서대로 1씩 더 배분.
    const frac = raw.map((v, i) => ({ i, f: v - base[i] }));
    frac.sort((a, b) => b.f - a.f);
    for (let k = 0; k < remain; k++) {
      base[frac[k].i] += 1;
    }
  }
  return base;
}

// ── 한전 청구 계산 순서 (L454~493) ────────────────────────────────────
export function finalizeElectricBill(baseFee: number, energyCharge: number, kwh: number): number {
  // 한전 계산순서에 따라 일반·TOU 최종 청구액을 계산함.
  // 기본요금·전력량요금·기후환경요금·연료비조정액은 원 미만 절사,
  // 부가가치세는 원 미만 반올림, 전력산업기반기금 및 최종 청구액은 10원 미만 절사함.
  const usage = billedKwh(kwh);
  const basic = truncateWon(baseFee);
  const energy = truncateWon(energyCharge);
  const fuel = truncateWon(usage * FUEL_ADJUSTMENT_RATE);
  const climate = truncateWon(usage * CLIMATE_ENV_RATE);
  const electricityCharge = basic + energy + fuel + climate;
  const vat = roundHalfUp(electricityCharge * VAT_RATE);
  const fund = truncate10Won(electricityCharge * POWER_FUND_RATE);
  return truncate10Won(electricityCharge + vat + fund);
}

export interface BillComponentBreakdown {
  "요금계산 사용량(kWh)": number;
  "기본요금(원)": number;
  "전력량요금(원)": number;
  "연료비조정액(원)": number;
  "기후환경요금(원)": number;
  "전기요금계(원)": number;
  "부가가치세(원)": number;
  "전력산업기반기금(원)": number;
  "최종 청구액(원)": number;
}

export function billComponentBreakdown(
  baseFee: number,
  energyCharge: number,
  kwh: number
): BillComponentBreakdown {
  // 화면 검증용 요금 구성요소.
  const usage = billedKwh(kwh);
  const basic = truncateWon(baseFee);
  const energy = truncateWon(energyCharge);
  const fuel = truncateWon(usage * FUEL_ADJUSTMENT_RATE);
  const climate = truncateWon(usage * CLIMATE_ENV_RATE);
  const electricityCharge = basic + energy + fuel + climate;
  const vat = roundHalfUp(electricityCharge * VAT_RATE);
  const fund = truncate10Won(electricityCharge * POWER_FUND_RATE);
  const total = truncate10Won(electricityCharge + vat + fund);
  return {
    "요금계산 사용량(kWh)": usage,
    "기본요금(원)": basic,
    "전력량요금(원)": energy,
    "연료비조정액(원)": fuel,
    "기후환경요금(원)": climate,
    "전기요금계(원)": electricityCharge,
    "부가가치세(원)": vat,
    "전력산업기반기금(원)": fund,
    "최종 청구액(원)": total,
  };
}

// ── 주택용전력 저압 (L496~525) ────────────────────────────────────────
export function residentialBaseEnergy(
  kwh: number,
  month: number
): { basic: number; energy: number; u: number } {
  // 주택용전력 저압의 기본요금·전력량요금.
  // 저압 단가: 120.0 / 214.6 / 307.3원/kWh.
  // 하계(7~8월)는 300·450kWh, 기타계절은 200·400kWh 구간을 사용함.
  // 하계 및 동계(12~2월) 1,000kWh 초과분에는 736.2원/kWh를 적용함.
  const u = billedKwh(kwh);
  const summer = month === 7 || month === 8;
  const [t1, t2] = summer ? [300, 450] : [200, 400];
  const basic = u <= t1 ? 910 : u <= t2 ? 1600 : 7300;
  const first = Math.min(u, t1);
  const second = Math.min(Math.max(u - t1, 0), t2 - t1);
  const third = Math.max(u - t2, 0);
  const superMonth = [7, 8, 12, 1, 2].includes(month);
  let energy: number;
  if (superMonth && u > 1000) {
    const normalThird = Math.max(1000 - t2, 0);
    const excess = u - 1000;
    energy = first * 120.0 + second * 214.6 + normalThird * 307.3 + excess * SUPERUSER_RATE;
  } else {
    energy = first * 120.0 + second * 214.6 + third * 307.3;
  }
  return { basic, energy, u };
}

export function residentialBill(kwh: number, month: number): number {
  const { basic, energy, u } = residentialBaseEnergy(kwh, month);
  return finalizeElectricBill(basic, energy, u);
}

// ── 제주 주택용 계시별(TOU) 요금 (L528~545) ───────────────────────────
export function touBaseEnergy(
  kwh: number,
  month: number,
  offShare: number,
  midShare: number,
  peakShare: number,
  contractKw: number | null = null
): { basic: number; energy: number; u: number; buckets: number[] } {
  // 제주 주택용 계시별 요금의 기본요금·전력량요금.
  const u = billedKwh(kwh);
  const ck = contractKw === null ? TOU_CONTRACT_KW : contractKw;
  const rates: [number, number, number] = [3, 4, 5, 9, 10].includes(month)
    ? [125.8, 153.8, 172.4]
    : [138.7, 184.7, 220.5];
  const buckets = allocateIntegerKwh(u, [offShare, midShare, peakShare]);
  const superMonth = [6, 7, 8, 11, 12, 1, 2].includes(month);
  let energy: number;
  if (superMonth && u > 1000) {
    const firstBuckets = allocateIntegerKwh(1000, [offShare, midShare, peakShare]);
    energy =
      firstBuckets.reduce((acc, v, i) => acc + v * rates[i], 0) + (u - 1000) * SUPERUSER_RATE;
  } else {
    energy = buckets.reduce((acc, v, i) => acc + v * rates[i], 0);
  }
  return { basic: 4310.0 * ck, energy, u, buckets };
}

export function touBill(
  kwh: number,
  month: number,
  offShare: number,
  midShare: number,
  peakShare: number,
  contractKw: number | null = null
): number {
  const { basic, energy, u } = touBaseEnergy(kwh, month, offShare, midShare, peakShare, contractKw);
  return finalizeElectricBill(basic, energy, u);
}

// ── 구독형 요금 (L547~571) ─────────────────────────────────────────────
export function subscriptionBill(
  kwh: number,
  fee: number,
  included: number,
  overage: number
): number {
  // 구독료와 초과단가를 모든 부가요금·세금이 포함된 최종 소비자가격으로 계산함.
  // 제공량 이내에서는 고객 청구액이 월 구독료로 고정되고, 제공량을 초과한 사용량에만
  // 최종 초과단가를 곱하여 더함.
  const usage = Math.max(kwh, 0.0);
  const finalFee = Math.max(fee, 0.0);
  const excess = Math.max(usage - Math.max(included, 0.0), 0.0);
  const finalOverage = Math.max(overage, 0.0);
  return roundHalfUp(finalFee + excess * finalOverage);
}

export function inverseSubscriptionBill(
  targetBill: number,
  fee: number,
  included: number,
  overage: number
): number {
  // 최종 납부목표 아래에서 사용할 수 있는 최대 사용량을 역산함.
  const finalFee = Math.max(fee, 0.0);
  const allowance = Math.max(included, 0.0);
  const finalOverage = Math.max(overage, 0.0);
  if (targetBill < finalFee) return 0.0;
  if (finalOverage <= 1e-12) return allowance;
  return allowance + (targetBill - finalFee) / finalOverage;
}
