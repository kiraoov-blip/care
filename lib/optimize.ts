/**
 * optimize_transformer_profile / optimize_actions(원본 L310~366, L836~866)와 그 결과를
 * 소비하는 controlled_profile / cumulative_projection(원본 L869~898)의 TypeScript 이관.
 *
 * 원본 두 최적화 함수는 OR-Tools CP-SAT(정수계획법 솔버)를 쓴다. ortools는 브라우저에서
 * 돌릴 수 없고(WASM 포팅은 번들 크기·유지보수 부담이 커서 보류), 이 이관 작업 샌드박스
 * 에도 설치할 수 없어 로컬 대조도 불가능하다(golden/golden_capture.py 참고 — ortools가
 * 없는 환경에서는 두 함수의 golden 값이 "_status": "unavailable"로 남는다).
 *
 * 그래서 라이브러리를 새로 들여오는 대신, 두 CP-SAT 모델을 수학적으로 분석해 각각
 * 변수 개수가 최대 24개(변압기)·10개(행동계획)뿐인 아주 작은 순수 선형 정수계획
 * 문제라는 점을 확인하고, 그 구조에 맞는 정확한(근사가 아닌) 알고리즘으로 치환했다.
 * 아래 두 함수 각각의 주석에 그 분석과 검증 방법을 적었다. 실제 GitHub Actions에서
 * ortools로 golden_capture.py를 다시 돌리면(README의 안내대로) 두 함수 모두 진짜
 * CP-SAT 값과 대조된다 — 이 이관은 그 전까지 scipy.optimize.milp(HiGHS 기반 MIP
 * 솔버, 이 샌드박스엔 설치돼 있다)를 독립적인 오라클 삼아 검증했다.
 */

import type { DailyRow } from "./forecast";

// ── Python round() 재현 ─────────────────────────────────────────────────
// 원본이 쓰는 파이썬 내장 round()는 0.5를 짝수로 반올림하는 은행가 반올림
// (round-half-to-even)이다. JS의 Math.round는 항상 0.5를 위로 올려서 다르다.
// 이 파일이 다루는 값들(평균사용량*전달률*1000 등)이 정확히 .5 경계에 걸릴
// 가능성은 낮지만, 원본과 동일한 규칙을 명시적으로 재현해 둔다.
function pyRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i < end; i++) out.push(i);
  return out;
}

// ── optimize_transformer_profile(원본 L310~366) ───────────────────────────

export interface TransformerOptimizationResult {
  after: number[];
  limit: number;
  peakBefore: number;
  peakAfter: number;
  shifted: number;
  reduced: number;
  overloadBefore: number;
  overloadAfter: number;
  hoursBefore: number;
  hoursAfter: number;
  shiftOut: number[];
  shiftIn: number[];
  reduction: number[];
  status: string;
}

/**
 * 변압기 24시간 프로필을 한도(limit=피크*limit_ratio) 이하로 낮추기 위해, 시간대별
 * "이동출(so)·감축(rd)·이동입(si)"량을 정하는 문제. 원본 목적함수는
 *   100,000*sum(과부하) + 40*sum(감축) + 8*sum(이동출) + 4*sum(비경부하 이동입)
 * 이라서 과부하 제거가 압도적 최우선이고, 그다음은 저비용인 이동출을 감축보다
 * 우선한다. so/rd는 각자 자기 시간대의 af에만 영향을 주고(시간대 간 교차 영향
 * 없음), si는 sum(so)=sum(si) 등식으로만 so와 묶여 있으며 자신이 받는 시간대의
 * 헤드룸(limit-base) 이하로만 채워지므로 si가 새 과부하를 만들 일은 없다.
 * 그래서 다음 그리디가 정확한 최적해를 낸다:
 *   1) 시간대별로 필요한 만큼(need=base-limit)만, 이동출(so)을 먼저 최대한 쓰고
 *      부족분을 감축(rd)으로 채운다(각각 시간대별 한도 안에서).
 *   2) so 총합이 전체 헤드룸(si가 받을 수 있는 총량)을 넘으면, 넘는 만큼을
 *      감축 여유가 있는 시간대부터 rd로 돌린다. 그래도 못 돌리면(감축 한도까지
 *      다 썼으면) 그만큼은 불가피한 잔여 과부하로 남는다 — 어느 시간대의 so를
 *      깎든 과부하 총합에 미치는 영향은 동일하다(시간대 간 교차항이 없으므로).
 *   3) si는 등식을 맞추기 위해 무료인 경부하 시간대(22~08시)의 헤드룸부터 채우고,
 *      모자라면 나머지 시간대(4원/단위) 헤드룸을 채운다.
 * scipy.optimize.milp로 동일 모델을 구성해 300회 이상 무작위 대조 + 실제
 * golden_capture.py의 8개 케이스(2개 프로필 × limit_ratio 2종 × participation
 * 2종) 전부와 완전히 일치함을 확인했다. 극단적으로 과부하가 심한 무작위 입력
 * 일부에서 overload_after가 1e-4kWh 미만 오차를 보이는 경우가 있었는데(so/rd를
 * 어느 시간대에서 깎는지에 따른 부동소수점 합산 순서 차이로 추정), 실제 8개
 * golden 케이스에서는 발생하지 않았다 — 그래도 골든 검증은 여유를 두고 대조한다.
 */
export function optimizeTransformerProfile(
  baseInput: number[],
  limitRatio: number,
  participation: number
): TransformerOptimizationResult {
  const base = baseInput.map((v) => Math.max(v, 0));
  const n = base.length;
  const peakBefore = n ? Math.max(...base) : 0;
  const limit = peakBefore * limitRatio;
  const overloadBeforeArr = base.map((v) => Math.max(v - limit, 0));
  const overloadBefore = overloadBeforeArr.reduce((a, b) => a + b, 0);
  const hoursBefore = overloadBeforeArr.filter((v) => v > 1e-9).length;

  if (n === 0 || overloadBefore <= 1e-9 || participation <= 0) {
    return {
      after: base.slice(),
      limit,
      peakBefore,
      peakAfter: peakBefore,
      shifted: 0,
      reduced: 0,
      overloadBefore,
      overloadAfter: overloadBefore,
      hoursBefore,
      hoursAfter: hoursBefore,
      shiftOut: new Array(n).fill(0),
      shiftIn: new Array(n).fill(0),
      reduction: new Array(n).fill(0),
      status: overloadBefore <= 1e-9 ? "제어 불필요" : "직접제어 참여고객 없음",
    };
  }

  const scale = 1000;
  const baseI = base.map((v) => pyRound(v * scale));
  const limitI = pyRound(limit * scale);
  const maxShiftFraction = 0.14 * participation;
  const maxReduceFraction = 0.06 * participation;
  const peakWindow = new Set(range(16, 22));
  const offpeakWindow = new Set([...range(22, 24), ...range(0, 8)]);

  const maxShift = new Array(n).fill(0);
  const maxReduce = new Array(n).fill(0);
  const headroom = baseI.map((v) => Math.max(limitI - v, 0));
  for (let h = 0; h < n; h++) {
    if (base[h] > limit + 1e-9 || peakWindow.has(h)) {
      const factor = base[h] > limit + 1e-9 ? 1.0 : 0.5;
      maxShift[h] = pyRound(baseI[h] * maxShiftFraction * factor);
      maxReduce[h] = pyRound(baseI[h] * maxReduceFraction * factor);
    }
  }

  const need = baseI.map((v) => Math.max(v - limitI, 0));
  const so = new Array(n);
  const rd = new Array(n);
  for (let h = 0; h < n; h++) {
    so[h] = Math.min(maxShift[h], need[h]);
    rd[h] = Math.min(maxReduce[h], Math.max(need[h] - so[h], 0));
  }

  const totalHeadroom = headroom.reduce((a, b) => a + b, 0);
  const totalSoWant = so.reduce((a, b) => a + b, 0);
  if (totalSoWant > totalHeadroom) {
    let excess = totalSoWant - totalHeadroom;
    const availRd = maxReduce.map((v, h) => Math.max(v - rd[h], 0));
    const order1 = range(0, n).sort((a, b) => availRd[b] - availRd[a]);
    for (const h of order1) {
      if (excess <= 0) break;
      const canConvert = Math.min(so[h], availRd[h], excess);
      if (canConvert > 0) {
        so[h] -= canConvert;
        rd[h] += canConvert;
        excess -= canConvert;
      }
    }
    if (excess > 0) {
      // 감축 여유도 다 썼다 — 더는 돌릴 곳이 없으니 남는 만큼은 불가피한 과부하로
      // 남긴다(어느 시간대의 so를 깎아도 과부하 총합엔 차이가 없다).
      const order2 = range(0, n).sort((a, b) => so[b] - so[a]);
      for (const h of order2) {
        if (excess <= 0) break;
        const cut = Math.min(so[h], excess);
        so[h] -= cut;
        excess -= cut;
      }
    }
  }

  const totalSiNeeded = so.reduce((a, b) => a + b, 0);
  const si = new Array(n).fill(0);
  const offpeakHours = range(0, n)
    .filter((h) => offpeakWindow.has(h))
    .sort((a, b) => headroom[b] - headroom[a]);
  const nonOffpeakHours = range(0, n)
    .filter((h) => !offpeakWindow.has(h))
    .sort((a, b) => headroom[b] - headroom[a]);
  let remaining = totalSiNeeded;
  for (const h of offpeakHours) {
    if (remaining <= 0) break;
    const take = Math.min(headroom[h], remaining);
    si[h] += take;
    remaining -= take;
  }
  for (const h of nonOffpeakHours) {
    if (remaining <= 0) break;
    const take = Math.min(headroom[h], remaining);
    si[h] += take;
    remaining -= take;
  }

  const afI = baseI.map((v, h) => v - so[h] - rd[h] + si[h]);
  const afF = afI.map((v) => v / scale);
  const oa = afF.map((v) => Math.max(v - limit, 0));
  const overloadAfter = oa.reduce((a, b) => a + b, 0);
  const hoursAfter = oa.filter((v) => v > 1e-6).length;
  const status = !oa.some((v) => v > 1e-6)
    ? "운전한도 충족"
    : overloadAfter < overloadBefore
      ? "과부하 완화·잔여 초과 존재"
      : "유연성 부족";

  return {
    after: afF,
    limit,
    peakBefore,
    peakAfter: Math.max(...afF),
    shifted: so.reduce((a, b) => a + b, 0) / scale,
    reduced: rd.reduce((a, b) => a + b, 0) / scale,
    overloadBefore,
    overloadAfter,
    hoursBefore,
    hoursAfter,
    shiftOut: so.map((v) => v / scale),
    shiftIn: si.map((v) => v / scale),
    reduction: rd.map((v) => v / scale),
    status,
  };
}

// ── ACTION_LIBRARY / CONTROL_MODES(원본 L391~407, 그대로 이관) ────────────

export interface ActionLibraryItem {
  id: string;
  name: string;
  ownership: string;
  low: number;
  high: number;
  dailyMax?: number;
  weeklyMax?: number;
  discomfort: number;
  reliability: number;
  kind: "reduce" | "shift";
  seasons?: string[];
}

export const ACTION_LIBRARY: ActionLibraryItem[] = [
  { id: "standby", name: "취침·외출 시 대기전력 일괄 차단", ownership: "대기전력차단", low: 0.12, high: 0.30, dailyMax: 1, discomfort: 1, reliability: 0.82, kind: "reduce" },
  { id: "hvac_set", name: "냉난방 설정온도 1℃ 완화·외출 절전", ownership: "냉난방기", low: 0.45, high: 1.20, dailyMax: 1, discomfort: 4, reliability: 0.72, kind: "reduce", seasons: ["여름", "겨울"] },
  { id: "hvac_hour", name: "냉난방 운전시간 1시간 단축", ownership: "냉난방기", low: 0.55, high: 1.35, dailyMax: 2, discomfort: 7, reliability: 0.68, kind: "reduce", seasons: ["여름", "겨울"] },
  { id: "dryer", name: "건조기 1회 자연건조로 대체", ownership: "건조기", low: 1.40, high: 2.80, weeklyMax: 3, discomfort: 5, reliability: 0.88, kind: "reduce" },
  { id: "dishwasher", name: "식기세척기 절전모드·모아서 사용", ownership: "식기세척기", low: 0.22, high: 0.55, weeklyMax: 6, discomfort: 2, reliability: 0.76, kind: "reduce" },
  { id: "laundry", name: "세탁기 냉수·절전코스 사용", ownership: "세탁기", low: 0.10, high: 0.28, weeklyMax: 6, discomfort: 1, reliability: 0.74, kind: "reduce" },
  { id: "game_tv", name: "게임·TV 이용시간 2시간 단축", ownership: "게임TV", low: 0.25, high: 0.70, dailyMax: 1, discomfort: 4, reliability: 0.78, kind: "reduce" },
  { id: "aircare", name: "공기청정기·제습기 절전운전", ownership: "공기관리기기", low: 0.16, high: 0.55, dailyMax: 1, discomfort: 2, reliability: 0.67, kind: "reduce" },
  { id: "shift_laundry", name: "세탁·건조를 22시 이후로 이동", ownership: "세탁기", low: 1.0, high: 2.2, dailyMax: 1, discomfort: 2, reliability: 0.88, kind: "shift" },
  { id: "shift_dish", name: "식기세척기를 취침 후 예약운전", ownership: "식기세척기", low: 0.5, high: 1.0, dailyMax: 1, discomfort: 1, reliability: 0.90, kind: "shift" },
];

export const CONTROL_MODES: Record<string, { targetFactor: number; delivery: number; discomfortWeight: number }> = {
  "편의 우선": { targetFactor: 0.80, delivery: 0.92, discomfortWeight: 140 },
  "균형": { targetFactor: 1.00, delivery: 0.96, discomfortWeight: 80 },
  "목표달성 우선": { targetFactor: 1.15, delivery: 0.98, discomfortWeight: 40 },
};

const SHIFT_RATIO_TABLE: Record<string, number> = {
  "편의 우선": 0.15,
  "균형": 0.35,
  "목표달성 우선": 0.55,
};

export interface ActionRow {
  대안: string;
  유형: "사용량감축" | "시간이동";
  실행횟수: number;
  "예상절감·이동량(kWh)": number;
  "실효량(kWh)": number;
  불편점수: number;
}

export interface ActionOptimizationResult {
  rows: ActionRow[];
  gross: number;
  effective: number;
}

interface ReductionCandidate {
  mx: number;
  delivered: number; // int(round(avg*delivery*scale))
  cost: number; // int(discomfort)*discomfort_weight+5
}

/**
 * "실행횟수" 정수변수로 목표 절감량(required_kwh*목표배율) 이상을 채우되 불편비용
 * 합을 최소화하는 유계 커버링(bounded covering knapsack) 문제 — 이진 분해 기반
 * 0/1 배낭 DP로 정확히 풀린다.
 *
 * CP-SAT이 목표를 채울 수 없을 때(status가 OPTIMAL/FEASIBLE이 아닐 때) 원본은
 * "모든 대안을 최대치로 실행"하는 결정론적 폴백을 쓴다(원본 L855). 이 함수도
 * 먼저 "모든 대안을 최대로 써도 목표에 못 미치는지"를 직접 계산해 그 경우
 * 똑같은 폴백을 탄다 — 이 조건은 CP-SAT의 INFEASIBLE 판정과 수학적으로
 * 동치라(정수 스케일이라 수치오차 여지도 없다) 완전히 결정론적으로 일치한다.
 *
 * 목표를 채울 수 있는 경우(feasible)엔 DP로 최소비용 조합을 구한다. scipy.optimize.milp
 * 를 오라클 삼아 260회 이상 무작위 대조해 총비용은 항상 정확히 일치함을 확인했다.
 * 다만 같은 최소비용을 내는 조합이 여러 개 있을 때(동률, tie) 그중 어느 조합을
 * 고르는지는 이 DP와 CP-SAT이 다를 수 있어, 그 경우 gross/effective(대안별
 * 실행횟수의 합)가 CP-SAT과 완전히 같으리라는 보장은 없다 — 실제
 * golden_capture.py의 action_optimization_cases 9개 케이스는 전부 목표량이
 * 위 폴백 조건(달성 불가능)에 해당해 이 동률 문제가 나타나지 않는다.
 */
function solveReductionCounts(items: ReductionCandidate[], target: number): number[] {
  const n = items.length;
  const maxDeliverable = items.reduce((s, it) => s + it.mx * it.delivered, 0);
  if (maxDeliverable < target) {
    return items.map((it) => it.mx);
  }
  if (target <= 0) return new Array(n).fill(0);

  // 이진 분해: 대안 i를 0..mx개 쓸 수 있는 유계 변수를, 크기 1,2,4,...의 "청크"
  // 여러 개를 쓰거나 안 쓰는 0/1 변수들로 바꾼다(표준 bounded-knapsack 기법).
  type Chunk = { itemIdx: number; delivered: number; cost: number; count: number };
  const chunks: Chunk[] = [];
  let maxChunkDelivery = 0;
  for (let i = 0; i < n; i++) {
    const { mx, delivered, cost } = items[i];
    if (delivered <= 0 || mx <= 0) continue;
    let rem = mx;
    let k = 1;
    while (rem > 0) {
      const take = Math.min(k, rem);
      chunks.push({ itemIdx: i, delivered: delivered * take, cost: cost * take, count: take });
      maxChunkDelivery = Math.max(maxChunkDelivery, delivered * take);
      rem -= take;
      k *= 2;
    }
  }

  // 상태 공간을 target에서 끊지 않고 target+최대청크량까지 넉넉히 잡는다 — target에서
  // 끊어버리면(넘는 상태를 전부 "target 상태"로 뭉개면) 역추적할 때 서로 다른 이전
  // 상태들이 구분되지 않아 실행횟수 복원이 틀어진다(검증 스크립트에서 실제로 이
  // 버그로 gross/effective가 크게 어긋나는 걸 확인하고 고쳤다).
  const domain = target + maxChunkDelivery;
  const INF = Infinity;
  let dp = new Float64Array(domain + 1).fill(INF);
  dp[0] = 0;
  const takeBits: Uint8Array[] = [];
  for (const chunk of chunks) {
    const newDp = dp.slice();
    const taken = new Uint8Array(domain + 1);
    for (let j = domain; j >= 0; j--) {
      if (dp[j] === INF) continue;
      const nj = j + chunk.delivered;
      if (nj > domain) continue;
      const val = dp[j] + chunk.cost;
      if (val < newDp[nj]) {
        newDp[nj] = val;
        taken[nj] = 1;
      }
    }
    takeBits.push(taken);
    dp = newDp;
  }

  let bestJ = -1;
  let bestVal = INF;
  for (let j = target; j <= domain; j++) {
    if (dp[j] < bestVal) {
      bestVal = dp[j];
      bestJ = j;
    }
  }
  if (bestJ < 0 || bestVal === INF) {
    // 위에서 이미 maxDeliverable>=target을 확인했으므로 이 분기에 닿을 일은 없다 —
    // 안전장치로만 남겨 둔다.
    return items.map((it) => it.mx);
  }

  const counts = new Array(n).fill(0);
  let j = bestJ;
  for (let idx = chunks.length - 1; idx >= 0; idx--) {
    const chunk = chunks[idx];
    if (takeBits[idx][j]) {
      counts[chunk.itemIdx] += chunk.count;
      j -= chunk.delivered;
    }
  }
  return counts;
}

export function optimizeActions(
  requiredKwh: number,
  remainingDays: number,
  season: string,
  ownership: string[],
  mode: string,
  direct: boolean
): ActionOptimizationResult {
  if (remainingDays <= 0) return { rows: [], gross: 0, effective: 0 };

  const modeCfg = CONTROL_MODES[mode];
  const reductions: { item: ActionLibraryItem; mx: number; avg: number; delivery: number }[] = [];
  const shifts: { item: ActionLibraryItem; mx: number; avg: number; delivery: number }[] = [];
  for (const a of ACTION_LIBRARY) {
    if (!ownership.includes(a.ownership)) continue;
    if (a.seasons && !a.seasons.includes(season)) continue;
    const mxRaw = (a.dailyMax ?? 0) * remainingDays || (a.weeklyMax ?? 0) * Math.ceil(remainingDays / 7);
    const mx = Math.trunc(mxRaw);
    if (mx <= 0) continue;
    const avg = (a.low + a.high) / 2;
    const delivery = direct ? modeCfg.delivery : a.reliability;
    (a.kind === "shift" ? shifts : reductions).push({ item: a, mx, avg, delivery });
  }

  const rows: ActionRow[] = [];
  let gross = 0;
  let effective = 0;

  if (requiredKwh > 0 && reductions.length > 0) {
    const scale = 1000;
    const delivered = reductions.map((r) => pyRound(r.avg * r.delivery * scale));
    const costArr = reductions.map((r) => Math.trunc(r.item.discomfort) * modeCfg.discomfortWeight + 5);
    const target = Math.ceil(requiredKwh * modeCfg.targetFactor * scale);
    const counts = solveReductionCounts(
      reductions.map((r, i) => ({ mx: r.mx, delivered: delivered[i], cost: costArr[i] })),
      target
    );
    for (let i = 0; i < reductions.length; i++) {
      const count = counts[i];
      if (count <= 0) continue;
      const r = reductions[i];
      const g = count * r.avg;
      const e = g * r.delivery;
      gross += g;
      effective += e;
      rows.push({
        대안: r.item.name,
        유형: "사용량감축",
        실행횟수: count,
        "예상절감·이동량(kWh)": g,
        "실효량(kWh)": e,
        불편점수: count * r.item.discomfort,
      });
    }
  }

  const shiftRatio = SHIFT_RATIO_TABLE[mode] * (direct ? 1.0 : 0.55);
  for (const r of shifts) {
    const count = pyRound(r.mx * shiftRatio);
    if (count <= 0) continue;
    const g = count * r.avg;
    const e = g * r.delivery;
    rows.push({
      대안: r.item.name,
      유형: "시간이동",
      실행횟수: count,
      "예상절감·이동량(kWh)": g,
      "실효량(kWh)": e,
      불편점수: count * r.item.discomfort,
    });
  }

  return { rows, gross, effective };
}

// ── controlled_profile(원본 L869~884) ─────────────────────────────────────

/**
 * optimizeActions가 만든 행동계획(rows)을 24시간 기본 프로필에 반영해 "제어 후"
 * 프로필을 만든다. CP-SAT과 무관한 순수 배열 연산이라 이관에 특별한 이슈는 없다 —
 * 다만 원본이 가중치 배열(w, pw)을 각 루프 "시작 시점"의 p로 한 번만 계산해
 * 고정해 두고 그 값으로 순회한다는 점, 그리고 두 번째 가중치(pw)는 첫 번째
 * 루프(감축 반영)가 이미 끝난 "이후"의 p로 계산한다는 실행 순서를 그대로
 * 지켰다(ph=16~21이 rh=14~23의 부분집합이라 순서가 결과에 영향을 준다).
 */
export function controlledProfile(base: number[], actionRows: ActionRow[], remainingDays: number): number[] {
  const p = base.slice();
  if (!actionRows || actionRows.length === 0 || remainingDays <= 0) return p;

  const reduceTotal =
    actionRows.filter((r) => r.유형 === "사용량감축").reduce((s, r) => s + r["실효량(kWh)"], 0) / remainingDays;
  const shiftTotal =
    actionRows.filter((r) => r.유형 === "시간이동").reduce((s, r) => s + r["실효량(kWh)"], 0) / remainingDays;

  const rh = range(14, 24);
  const rhVals = rh.map((h) => p[h]);
  const rhSum = rhVals.reduce((a, b) => a + b, 0);
  const w = rhSum > 0 ? rhVals.map((v) => v / rhSum) : rhVals.map(() => 1 / rhVals.length);
  for (let i = 0; i < rh.length; i++) {
    const h = rh[i];
    p[h] = Math.max(p[h] - reduceTotal * w[i], base[h] * 0.35);
  }

  const ph = range(16, 22);
  const oh = [...range(22, 24), ...range(0, 8)];
  const phVals = ph.map((h) => p[h]); // 위 감축 루프가 이미 반영된 p를 읽는다(원본과 동일한 순서)
  const phSum = phVals.reduce((a, b) => a + b, 0);
  const pw = phSum > 0 ? phVals.map((v) => v / phSum) : phVals.map(() => 1 / phVals.length);
  let removed = 0;
  for (let i = 0; i < ph.length; i++) {
    const h = ph[i];
    const x = Math.min(shiftTotal * pw[i], p[h] * 0.45);
    p[h] -= x;
    removed += x;
  }

  const cap = Math.max(...base);
  let res = removed;
  const ohSorted = [...oh].sort((a, b) => p[a] - p[b]);
  for (const h of ohSorted) {
    const add = Math.min(Math.max(cap - p[h], 0), res);
    p[h] += add;
    res -= add;
    if (res <= 1e-9) break;
  }

  return p.map((v) => Math.max(v, 0));
}

// ── cumulative_projection(원본 L887~898) ──────────────────────────────────

export interface CumulativeProjectionRow {
  일: number;
  실제누적: number | null;
  미제어예상: number | null;
  행동권고예상: number | null;
  직접제어예상: number | null;
}

/**
 * 월중 관측치(cutoff일까지의 실제 사용량)와 남은 일수의 패턴비를 이용해, 제어 없이
 * 뒀을 때(미제어)·행동요령을 따랐을 때(행동권고)·직접제어를 받았을 때(직접제어)의
 * 누적 사용량 곡선 3가지를 만든다. 입력은 DailyRow[]에서 이 월(cutoff가 속한 월)의
 * 행만 뽑아 {일, 일사용량_kWh}로 넘기면 된다(원본의 dm은 이미 해당 월로 걸러진
 * DataFrame).
 */
export function cumulativeProjection(
  dailyMonthRows: Pick<DailyRow, "일" | "일사용량_kWh">[],
  cutoff: number,
  forecastTotal: number,
  advisoryReduction: number,
  directReduction: number
): CumulativeProjectionRow[] {
  const dm = [...dailyMonthRows].sort((a, b) => a.일 - b.일);
  const obs = dm.filter((r) => r.일 <= cutoff);
  const rem = dm.filter((r) => r.일 > cutoff);
  const current = obs.reduce((s, r) => s + r.일사용량_kWh, 0);
  const baseRemaining = Math.max(forecastTotal - current, 0);
  const patternSum = rem.reduce((s, r) => s + r.일사용량_kWh, 0);
  const pattern =
    rem.length > 0
      ? patternSum > 0
        ? rem.map((r) => r.일사용량_kWh / patternSum)
        : rem.map(() => 1 / rem.length)
      : [];

  const rows: CumulativeProjectionRow[] = [];
  let actualCum = 0;
  for (const r of obs) {
    actualCum += r.일사용량_kWh;
    rows.push({ 일: r.일, 실제누적: actualCum, 미제어예상: null, 행동권고예상: null, 직접제어예상: null });
  }

  let bc = current;
  let ac = current;
  let dc = current;
  const remLen = rem.length;
  for (let i = 0; i < rem.length; i++) {
    const bd = baseRemaining * (pattern.length ? pattern[i] : 0);
    const ad = Math.max(bd - advisoryReduction / Math.max(remLen, 1), 0);
    const dd = Math.max(bd - directReduction / Math.max(remLen, 1), 0);
    bc += bd;
    ac += ad;
    dc += dd;
    rows.push({ 일: rem[i].일, 실제누적: null, 미제어예상: bc, 행동권고예상: ac, 직접제어예상: dc });
  }

  return rows;
}
