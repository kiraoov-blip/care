/**
 * 탭 8 "용어·문구 해설" — 원본 T8(streamlit_app_actual_tou_v30.py) 이관.
 * data/glossary.json(원본 build_glossary() 산출물, 정적 참조표)을 검색·필터링해 보여준다.
 */
import type { AppContext } from "../main.js";
import type { GlossaryRow } from "../data.js";
import {
  el,
  metricGrid,
  renderFullTextTable,
  controlsRow,
  selectField,
  downloadCsvButton,
  sectionTitle,
  alertBox,
  type ColumnSpec,
} from "../ui.js";

// GlossaryRow는 interface로 선언되어 있어 Record<string, unknown> 제약을 구조적으로
// 만족하지 못한다(ui.ts의 renderFullTextTable/downloadCsvButton은 T extends Record<string, unknown>).
// 인덱스 시그니처가 있는 로컬 type alias로 옮겨 사용한다.
type Row = {
  "화면 위치": string;
  구분: string;
  "용어·문구": string;
  "쉬운 설명": string;
  "계산·판단 기준·예시": string;
  유의사항: string;
  [key: string]: unknown;
};

function toRow(r: GlossaryRow): Row {
  return {
    "화면 위치": r["화면 위치"],
    구분: r["구분"],
    "용어·문구": r["용어·문구"],
    "쉬운 설명": r["쉬운 설명"],
    "계산·판단 기준·예시": r["계산·판단 기준·예시"],
    유의사항: r["유의사항"],
  };
}

const COLUMNS: ColumnSpec<Row>[] = [
  { key: "화면 위치", label: "화면 위치", kind: "text" },
  { key: "구분", label: "구분", kind: "text" },
  { key: "용어·문구", label: "용어·문구", kind: "text" },
  { key: "쉬운 설명", label: "쉬운 설명", kind: "text" },
  { key: "계산·판단 기준·예시", label: "계산·판단 기준·예시", kind: "text" },
  { key: "유의사항", label: "유의사항", kind: "text" },
];

// 원본 st.markdown("""1. ... 7. ...""")의 각 줄. **bold**는 정적 문구이므로 <b>로 안전하게 치환.
const RECOMMENDED_STEPS: string[] = [
  "<b>2024~2025년 사용량 분석</b>에서 전체 고객의 사용량 변화와 시간대 패턴을 확인합니다.",
  "<b>고객별 요금 모니터링</b>에서 분석기간·연도·월·조회일을 정하고 추천요금제를 확인합니다.",
  "<b>고객별 진단·제어</b>에서 특정 고객의 요금과 목표사용량, 행동권고 또는 직접제어 효과를 확인합니다.",
  "<b>고객 그룹 분석</b>에서 비슷한 사용패턴의 고객그룹과 그룹 이동을 확인합니다.",
  "<b>요금분석 및 추천</b>에서 월별·연간 추천요금제와 예측정확도를 검토합니다.",
  "<b>계통영향 분석 및 제어 시뮬레이션</b>에서 100가구 합산피크와 변압기 목표한도 대응 가능성을 시험합니다.",
  "결과를 해석할 때에는 반드시 <b>방법론·한계</b> 탭을 함께 확인합니다.",
];

// ── 탭-로컬 위젯 상태(원본 Streamlit 세션 상태에 대응) ──
let searchText = "";
let locationFilter = "전체";
let categoryFilter = "전체";

export function renderTab8(root: HTMLElement, ctx: AppContext): void {
  root.innerHTML = "";
  root.append(
    ...sectionTitle(
      "용어·문구 해설",
      "처음 사용하는 사람도 화면의 의미를 이해할 수 있도록, 현재 시뮬레이터에 표시되는 주요 설정값·지표·표 열·요금·예측·제어 용어를 탭별로 정리했습니다."
    )
  );

  const glossary: Row[] = ctx.raw.glossary.map(toRow);

  // ── q1,q2,q3 = st.columns([1.4,1,1]) ──
  const locationOptions = ["전체", ...Array.from(new Set(glossary.map((r) => r["화면 위치"]))).sort()];
  const categoryOptions = ["전체", ...Array.from(new Set(glossary.map((r) => r["구분"]))).sort()];
  if (!locationOptions.includes(locationFilter)) locationFilter = "전체";
  if (!categoryOptions.includes(categoryFilter)) categoryFilter = "전체";

  const searchInput = el("input", {
    type: "text",
    placeholder: "예: 분석 대상 고객, 직접제어 참여율, MAPE",
  }) as HTMLInputElement;
  searchInput.value = searchText;
  const searchControl = el("div", { className: "control" }, [
    el("label", { text: "용어 검색" }),
    searchInput,
  ]);

  const locationControl = selectField(
    "화면 위치",
    locationOptions.map((v) => ({ value: v, label: v })),
    locationFilter,
    (v) => {
      locationFilter = v;
      renderTab8(root, ctx);
    }
  );
  const categoryControl = selectField(
    "구분",
    categoryOptions.map((v) => ({ value: v, label: v })),
    categoryFilter,
    (v) => {
      categoryFilter = v;
      renderTab8(root, ctx);
    }
  );

  root.append(controlsRow([searchControl, locationControl, categoryControl]));

  // ── c1,c2,c3 = st.columns(3) : 지표 카드 + 표/다운로드 — 검색어 입력 시 이 부분만
  // (input을 다시 만들지 않고) 갱신해 검색창 포커스가 유지되도록 한다. ──
  const metricsHost = el("div");
  const resultsHost = el("div");
  root.append(metricsHost, resultsHost);

  const totalCount = glossary.length;
  const locationCount = locationOptions.length - 1; // "전체"를 제외한 화면 위치 종류 수(고정, 검색과 무관)

  function computeFiltered(): Row[] {
    let filtered = glossary;
    if (locationFilter !== "전체") filtered = filtered.filter((r) => r["화면 위치"] === locationFilter);
    if (categoryFilter !== "전체") filtered = filtered.filter((r) => r["구분"] === categoryFilter);
    const needle = searchText.trim().toLowerCase();
    if (needle) {
      filtered = filtered.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(needle)));
    }
    return filtered;
  }

  function paintResults(): void {
    const filtered = computeFiltered();

    metricsHost.innerHTML = "";
    metricsHost.append(
      metricGrid([
        { label: "전체 등록 용어", value: `${totalCount.toLocaleString("ko-KR")}개` },
        { label: "검색 결과", value: `${filtered.length.toLocaleString("ko-KR")}개` },
        { label: "화면 구분", value: `${locationCount.toLocaleString("ko-KR")}개` },
      ])
    );

    resultsHost.innerHTML = "";
    if (filtered.length === 0) {
      resultsHost.append(alertBox("warning", "검색조건에 맞는 용어가 없습니다. 검색어 또는 필터를 변경해 주세요."));
    } else {
      resultsHost.append(renderFullTextTable(COLUMNS, filtered));
      resultsHost.append(downloadCsvButton("용어·문구 해설 CSV", "v30_시뮬레이터_용어문구해설.csv", COLUMNS, filtered));
    }
  }

  searchInput.addEventListener("input", () => {
    searchText = searchInput.value;
    paintResults();
  });

  paintResults();

  // ── 처음 사용하는 사람을 위한 권장 순서 ──
  root.append(el("div", { className: "section-title", text: "처음 사용하는 사람을 위한 권장 순서" }));
  const ol = el("ol");
  for (const step of RECOMMENDED_STEPS) {
    ol.append(el("li", { html: step }));
  }
  root.append(ol);
}
