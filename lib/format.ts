/**
 * 화면 표시용 포맷·라벨 함수(원본 L68~72, 274~293, 573~583)의 TypeScript 이관.
 * 계산 로직이 아니라 "숫자를 어떻게 문자열로 보여줄지"만 다루므로 골든 테스트
 * 대상이 아니다 — site/의 8개 탭이 공통으로 가져다 쓰는 표시 유틸이다.
 */

export function fmtWon(v: number): string {
  return `${Math.round(v).toLocaleString("ko-KR")}원`;
}

export function fmtKwh(v: number): string {
  return `${v.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}kWh`;
}

export function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** usage_pattern_label(원본 L274~282) — 패턴안정성점수 구간 라벨. */
export function usagePatternLabel(score: number): string {
  if (score >= 80) return "매우 일정";
  if (score >= 65) return "대체로 일정";
  if (score >= 45) return "변화 있음";
  return "변화 큼";
}

/** peak_management_label(원본 L285~293) — 수요관리우선점수 구간 라벨. */
export function peakManagementLabel(score: number): string {
  if (score >= 75) return "매우 높음";
  if (score >= 55) return "높음";
  if (score >= 35) return "보통";
  return "낮음";
}

/** is_money_column(원본 L581~583) — 열 이름으로 "금액 열"인지 판정(반올림 자리수 결정에 사용). */
export function isMoneyColumn(name: string): boolean {
  return ["(원)", "요금", "납부액", "절감액", "금액"].some((token) => name.includes(token));
}

/**
 * round_table(원본 L586~590)과 같은 규칙 — 화면 표에 숫자를 넣기 직전에 쓴다.
 * 금액 열은 정수로, 그 외 숫자열은 소수 1자리로 반올림한다. 계산 결과 자체를
 * 바꾸는 게 아니라 표시 직전의 반올림이라 원본 함수를 직접 값 단위로 이관했다
 * (원본은 DataFrame 전체를 훑지만, 여기서는 표를 그리는 쪽에서 컬럼명으로
 * isMoneyColumn을 판정해 개별 값에 적용하면 동일하다).
 */
export function roundForDisplay(value: number, columnName: string): number {
  const digits = isMoneyColumn(columnName) ? 0 : 1;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
