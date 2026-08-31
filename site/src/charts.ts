/**
 * SVG 기반 차트 3종(라인, 막대, 히트맵) — 원본의 plotly(px.line/px.bar/px.imshow/go.Scatter)를
 * 대체한다. 외부 차트 라이브러리 없이(정적 GitHub Pages 배포에 CDN 의존을 늘리지 않으려고)
 * 이 파일 안에서 직접 그린다. 색상·마크 규격은 dataviz 스킬 가이드를 따른다
 * (categorical 팔레트는 --chart-series-1..4 CSS 변수 — 스킬 기본 팔레트의 slot2/3/1/4에서
 * 가져와 검증됨, 얇은 2px 선, 끝점 라운드, 범례 필수, 호버 크로스헤어+툴팁).
 */

const NS = "http://www.w3.org/2000/svg";
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag) as SVGElementTagNameMap[K];
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function seriesColor(i: number): string {
  const vars = ["--chart-series-1", "--chart-series-2", "--chart-series-3", "--chart-series-4"];
  return `var(${vars[i % vars.length]})`;
}

export interface LineSeries {
  name: string;
  values: (number | null)[];
  colorIndex?: number;
  dashed?: boolean;
}
export interface LineChartOptions {
  xLabels: (string | number)[];
  series: LineSeries[];
  width?: number;
  height?: number;
  yFormat?: (v: number) => string;
  yLabel?: string;
  xTickEvery?: number;
  /** x축 눈금을 정해진 값들만 표시하고 싶을 때(예: 24시간 그래프에서 1·3·6·9·12·15·
   * 18·21·24시만). xLabels의 값과 정확히 일치하는 항목만 그린다 — 지정하면 xTickEvery는
   * 무시된다. */
  xTickValues?: (string | number)[];
  /** false면 선 위의 점 마커(원)를 그리지 않는다 — 점이 촘촘한 24시간 그래프처럼 마커가
   * 오히려 선을 가려 가독성을 해칠 때 쓴다. 기본값 true(기존과 동일). */
  showMarkers?: boolean;
}

/** 화면 폭에 따라 라인차트의 "설계 폭"(viewBox width)을 다르게 골라준다 — 모바일과
 * 1/2(절반) 창에서 차트가 좌우로 스크롤되는 문제를 없애 달라는 요청 때문이다.
 * svg.chart{width:100%}는 컨테이너 폭에 맞춰 뷰박스를 늘리거나 줄이는데, 컨테이너가
 * 뷰박스보다 좁으면 안의 글자·마크·점 간격까지 전부 같은 비율로 작아진다. 그래서
 * 화면 폭 구간별로 뷰박스 자체를 컨테이너에 맞춰 미리 좁혀 두면(예: 모바일은
 * 360, 데스크톱은 1000), min-width로 억지로 늘려 스크롤을 만들지 않고도 글자 크기가
 * 유지되면서 점 간격도 자연스럽게 좁아진다(요청하신 "그래프 간격을 좁혀 달라"는
 * 부분과 같은 원리). 640px/900px 두 지점은 이 앱의 다른 반응형 분기(사이드바
 * 드로어 등)와 같은 기준을 그대로 쓴다. */
function responsiveLineChartWidth(): number {
  if (typeof window === "undefined") return 1000;
  const vw = window.innerWidth;
  if (vw <= 640) return 360; // 휴대폰
  if (vw <= 900) return 640; // 절반 창·태블릿
  return 1000; // 데스크톱(기존과 동일)
}

/** yFormat이 반환하는 문자열(예: "994.9kWh")에서 숫자·콤마·소수점·부호를 뺀 나머지
 * (단위, 예: "kWh")만 뽑아낸다 — 축 눈금마다 단위를 반복하지 않고 축 맨 위에
 * 한 번만 보여 달라는 요청 때문이다. yFormat이 없거나 단위가 없으면 빈 문자열. */
function extractUnit(sampleFormatted: string): string {
  const m = sampleFormatted.match(/[^0-9,.\-]+$/);
  return m ? m[0] : "";
}

/** 여러 계열의 라인차트 + 범례 + 호버 크로스헤어/툴팁(마크 규격: 2px 선, 4px 라운드 끝점, 8px 마커).
 * width 기본값은 카드로 감싸지 않고 .main에 바로 놓이는 "화면 폭 전체" 차트를
 * 기준으로 잡았다(탭1·3·6의 라인차트가 모두 이 경우) — PRAS-DER의 요금/사용량 그래프
 * (.load-line-chart svg{width:100%})처럼 차트가 카드 폭을 그대로 채우게 하기 위함이다.
 * 명시적으로 width를 넘기지 않으면 화면 폭에 맞춰 반응형으로 고른다(위
 * responsiveLineChartWidth 참고). card-row 안에 절반 폭으로 들어가는 차트는
 * 호출부에서 width를 좁게 지정한다(이 경우는 반응형 계산을 쓰지 않는다). */
export function lineChart(opts: LineChartOptions): HTMLDivElement {
  const width = opts.width ?? responsiveLineChartWidth();
  const height = opts.height ?? 260;
  // y축 눈금에서 단위(kWh 등)를 빼고 숫자만 보여주므로(아래), "994.9" 정도만 들어갈
  // 여백이면 충분하다 — 단위까지 넣어야 했던 이전보다 왼쪽 여백을 다시 줄였다.
  const margin = { top: 22, right: 16, bottom: 28, left: 50 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const allValues = opts.series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const yMin = Math.min(0, ...allValues);
  const yMax = Math.max(1, ...allValues) * 1.08;
  const n = opts.xLabels.length;
  const xAt = (i: number) => margin.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => margin.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  // svg.chart{width:100%;height:auto}(styles.css)로 카드·본문 폭을 그대로 채운다.
  // width 자체를 화면 폭에 맞춰 미리 고르므로(위 responsiveLineChartWidth), 예전처럼
  // min-width로 뷰박스 폭을 강제해 스크롤을 만들 필요가 없다 — 다만 아주 좁은
  // 기기(320px 이하 구형 휴대폰 등) 대비 최소한의 안전판으로 .chart-block의
  // overflow-x:auto(styles.css)는 그대로 남겨 둔다.
  const svg = svgEl("svg", { class: "chart", viewBox: `0 0 ${width} ${height}`, style: `aspect-ratio:${width}/${height}` });

  // 단위를 축 맨 위에 한 번만 표시(요청 반영) — yFormat(0)에서 뽑아낸다.
  const unit = opts.yFormat ? extractUnit(opts.yFormat(0)) : "";
  if (unit) {
    const unitLabel = svgEl("text", { x: margin.left - 8, y: 12, "text-anchor": "end", "font-size": 11, fill: "var(--chart-text)" });
    unitLabel.textContent = unit;
    svg.append(unitLabel);
  }

  // 격자(recessive) + y축 눈금 — 숫자만 표시(단위는 위에서 한 번만).
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const v = yMin + ((yMax - yMin) * t) / ticks;
    const y = yAt(v);
    svg.append(svgEl("line", { x1: margin.left, x2: width - margin.right, y1: y, y2: y, stroke: "var(--chart-grid)", "stroke-width": 1 }));
    const formatted = opts.yFormat ? opts.yFormat(v) : v.toLocaleString("ko-KR");
    const label = svgEl("text", { x: margin.left - 8, y: y + 4, "text-anchor": "end", "font-size": 13, fill: "var(--chart-text)" });
    label.textContent = unit ? formatted.slice(0, formatted.length - unit.length) : formatted;
    svg.append(label);
  }
  // x축 라벨 — xTickValues가 있으면 그 값들만(예: 24시간 그래프의 1·3·6·9·12·15·18·
  // 21·24시), 없으면 기존처럼 xTickEvery 간격으로 표시한다.
  const tickValueSet = opts.xTickValues ? new Set(opts.xTickValues.map(String)) : null;
  const everyN = opts.xTickEvery ?? Math.max(1, Math.ceil(n / 12));
  opts.xLabels.forEach((lab, i) => {
    if (tickValueSet) {
      if (!tickValueSet.has(String(lab))) return;
    } else if (i % everyN !== 0 && i !== n - 1) {
      return;
    }
    const t = svgEl("text", { x: xAt(i), y: height - 8, "text-anchor": "middle", "font-size": 12, fill: "var(--chart-text)" });
    t.textContent = String(lab);
    svg.append(t);
  });

  // 계열 선 + 마커 — 마커(원)를 더 크게(반지름 3→5) 하고, 안쪽은 흰색으로 채워
  // 테두리(계열 색)만 색이 있는 "도넛" 형태로 바꿔 각 점의 위치가 더 뚜렷이 보이게 한다.
  opts.series.forEach((s, si) => {
    const color = seriesColor(s.colorIndex ?? si);
    let d = "";
    s.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) return;
      d += `${d ? "L" : "M"}${xAt(i).toFixed(2)},${yAt(v).toFixed(2)} `;
    });
    const path = svgEl("path", {
      d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round",
    });
    if (s.dashed) path.setAttribute("stroke-dasharray", "5 4");
    svg.append(path);
    if (opts.showMarkers !== false) {
      s.values.forEach((v, i) => {
        if (v === null || !Number.isFinite(v)) return;
        svg.append(svgEl("circle", { cx: xAt(i), cy: yAt(v), r: 5, fill: "#fff", stroke: color, "stroke-width": 2 }));
      });
    }
  });

  // 호버 크로스헤어 + 히트타겟
  const crosshair = svgEl("line", { class: "chart-crosshair", x1: margin.left, x2: margin.left, y1: margin.top, y2: margin.top + innerH });
  svg.append(crosshair);
  const hitLayer = svgEl("rect", {
    x: margin.left, y: margin.top, width: innerW, height: innerH, fill: "transparent",
  });
  svg.append(hitLayer);

  const wrap = document.createElement("div");
  wrap.style.position = "relative";
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  wrap.append(svg, tip);

  hitLayer.addEventListener("mousemove", (ev) => {
    const rect = svg.getBoundingClientRect();
    const scale = width / rect.width;
    const localX = (ev.clientX - rect.left) * scale;
    const idx = Math.round(((localX - margin.left) / innerW) * (n - 1));
    const clamped = Math.max(0, Math.min(n - 1, idx));
    crosshair.setAttribute("x1", String(xAt(clamped)));
    crosshair.setAttribute("x2", String(xAt(clamped)));
    crosshair.style.opacity = "1";
    const lines = opts.series
      .map((s) => {
        const v = s.values[clamped];
        if (v === null || v === undefined || !Number.isFinite(v)) return null;
        return `<div><b>${s.name}</b> ${opts.yFormat ? opts.yFormat(v) : v.toLocaleString("ko-KR")}</div>`;
      })
      .filter(Boolean)
      .join("");
    tip.innerHTML = `<div style="margin-bottom:2px;opacity:.75">${opts.xLabels[clamped]}${opts.yLabel ? " " + opts.yLabel : ""}</div>${lines}`;
    tip.style.left = `${(xAt(clamped) / width) * rect.width}px`;
    // 이전에는 툴팁을 차트 맨 위 여백(margin.top) 지점에 두고 CSS의
    // translate(-50%,-110%)로 그 위쪽에 띄웠는데, margin.top이 22px 밖에 안 돼
    // 툴팁 박스(2~3줄이면 40~60px)가 차트 영역 위로 넘치고, .chart-block의
    // overflow-x:auto가 (스펙상) overflow-y도 자동으로 clip 처리해서 툴팁 윗부분과
    // 크로스헤어 화살표가 잘려 보이는 문제가 있었다 — 툴팁을 차트 영역 "안쪽"에서
    // 크로스헤어를 살짝 덮듯 아래로 내려 그리도록 바꿔 항상 차트 상자 안에 들어가게
    // 한다(가로 위치는 그대로 마우스를 따라가고, 세로는 항상 위쪽 여백 바로
    // 아래 고정 지점).
    tip.style.top = `${((margin.top + 4) / height) * rect.height}px`;
    tip.classList.add("show");
  });
  hitLayer.addEventListener("mouseleave", () => {
    crosshair.style.opacity = "0";
    tip.classList.remove("show");
  });

  const container = document.createElement("div");
  container.className = "chart-block";
  if (opts.series.length >= 2) {
    const legend = document.createElement("div");
    legend.className = "legend-row";
    opts.series.forEach((s, i) => {
      const item = document.createElement("span");
      item.className = "legend-item";
      const sw = document.createElement("span");
      sw.className = "legend-swatch";
      sw.style.background = seriesColor(s.colorIndex ?? i);
      item.append(sw, document.createTextNode(s.name));
      legend.append(item);
    });
    container.append(legend);
  }
  container.append(wrap);
  return container;
}

export interface BarDatum {
  label: string;
  value: number;
}
export interface BarChartOptions {
  data: BarDatum[];
  width?: number;
  height?: number;
  valueFormat?: (v: number) => string;
  colorIndex?: number;
  /** true면 값이 가장 큰 막대만 다른 색(--amber, 노란색 계열)으로 강조한다 — "가장 많은
   * 분포에 해당하는 막대를 구분해 달라"는 탭5(요금분석 및 추천) 요청 전용 옵션이다.
   * 지정하지 않으면 기존처럼 전부 같은 계열색을 쓴다. */
  highlightMax?: boolean;
}

/** width를 명시하지 않은 호출(현재는 탭5의 카드-2열 분포 막대차트)에 한해 화면 폭에 맞는
 * 기본 폭을 골라준다 — lineChart/heatmap과 같은 이유. card-row 두 카드가 데스크톱·절반
 * 창에서는 나란히, 모바일에서는 세로로 쌓이므로(styles.css .card-row 모바일 분기) 폭
 * 기준도 그에 맞춘다. width를 직접 지정하는 호출(탭1의 증감률 분포 등)에는 영향이 없다. */
function responsiveBarChartWidth(): number {
  if (typeof window === "undefined") return 560;
  const vw = window.innerWidth;
  if (vw <= 640) return 340; // 휴대폰: 카드가 세로로 쌓여 화면 폭 전체를 거의 그대로 차지
  if (vw <= 900) return 300; // 절반 창: 카드 두 개가 나란히라 카드 하나당 폭이 좁음
  return 460; // 데스크톱: 카드 두 개가 나란히 들어가는 실제 폭에 맞춤(기존 560보다 근접)
}

/** 라벨이 칸(slot) 폭보다 넓을 때 공백 지점에서 최대 2줄로 나눈다(표 헤더의
 * keep-all 줄바꿈과 같은 발상) — "일반 주택용(저압)"처럼 긴 카테고리 이름이 옆
 * 막대 라벨과 겹쳐 붙어 보이는 문제를 막는다. maxChars는 slot 폭에서 역산한
 * "한 줄에 들어갈 대략적인 글자 수"다. */
function wrapBarLabel(label: string, maxChars: number): string[] {
  if (label.length <= maxChars) return [label];
  const words = label.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines.slice(0, 2) : [label];
}

/** 단일 계열 막대차트 — 막대 위 직접 라벨(원본 px.bar(text=...) 대응), 인접 막대 사이 2px 갭.
 * width 기본값(820)은 lineChart와 같은 이유로 .main에 바로 놓이는 화면 폭 전체 차트
 * 기준이다(탭5의 요금제 분포 막대). card-row 절반 폭에 들어가는 차트(탭1의 증감률
 * 분포)는 호출부에서 width:560을 명시로 지정한다. */
export function barChart(opts: BarChartOptions): HTMLDivElement {
  const width = opts.width ?? responsiveBarChartWidth();
  const n = opts.data.length;
  // 축 숫자·카테고리 라벨 가독성이 떨어진다는 요청으로 값 라벨 11→13px, 하단 카테고리
  // 라벨 10.5→12.5px로 키웠다. margin.left/right는 라벨 줄바꿈과 무관하게 고정이므로
  // slot(막대 하나당 폭)을 먼저 계산해, 카테고리 라벨이 이 폭보다 넓으면 최대 2줄로
  // 접어(wrapBarLabel) 옆 막대 라벨과 겹쳐 붙어 보이지 않게 한다.
  const margin0 = { top: 24, right: 16, left: 46 };
  const innerW = width - margin0.left - margin0.right;
  const slot = innerW / Math.max(n, 1);
  const barW = Math.max(6, slot - 10);
  const xFontSize = 12.5;
  const maxChars = Math.max(3, Math.floor(slot / (xFontSize * 0.82)));
  const wrappedLabels = opts.data.map((d) => wrapBarLabel(d.label, maxChars));
  const xLineCount = Math.max(1, ...wrappedLabels.map((ls) => ls.length));
  // 여러 줄이 되면(대개 2줄) 그만큼 아래 여백(margin.bottom)도 늘려, 하단 축 글자가
  // 카드 밑변에 바짝 붙어 보이지 않게 한다(기존 34px → 기본 40px + 줄당 14px 추가).
  const margin = { ...margin0, bottom: 40 + (xLineCount - 1) * 14 };
  const height = opts.height ?? 240 + (xLineCount - 1) * 14;
  const innerH = height - margin.top - margin.bottom;
  const maxV = Math.max(1, ...opts.data.map((d) => d.value)) * 1.18;
  const color = seriesColor(opts.colorIndex ?? 0);
  // highlightMax: 값이 가장 큰 막대의 인덱스(동률이면 맨 앞)만 --amber로 강조한다.
  const maxRawV = Math.max(...opts.data.map((d) => d.value));
  const maxIdx = opts.highlightMax ? opts.data.findIndex((d) => d.value === maxRawV) : -1;

  // svg.chart{width:100%;height:auto}로 카드 폭을 채운다(라인차트와 같은 이유 — 위 주석 참고).
  const svg = svgEl("svg", { class: "chart", viewBox: `0 0 ${width} ${height}`, style: `aspect-ratio:${width}/${height}` });
  svg.append(svgEl("line", { x1: margin.left, x2: width - margin.right, y1: margin.top + innerH, y2: margin.top + innerH, stroke: "var(--chart-grid)", "stroke-width": 1 }));

  opts.data.forEach((d, i) => {
    const h = (d.value / maxV) * innerH;
    const x = margin.left + i * slot + (slot - barW) / 2;
    const y = margin.top + innerH - h;
    const fill = i === maxIdx ? "var(--amber)" : color;
    svg.append(svgEl("rect", { x, y, width: barW, height: Math.max(h, 0), rx: 4, fill }));
    const label = svgEl("text", { x: x + barW / 2, y: y - 7, "text-anchor": "middle", "font-size": 13, fill: "var(--chart-text)", "font-weight": 700 });
    label.textContent = opts.valueFormat ? opts.valueFormat(d.value) : d.value.toLocaleString("ko-KR");
    svg.append(label);
    wrappedLabels[i].forEach((line, li) => {
      const xt = svgEl("text", {
        x: x + barW / 2, y: margin.top + innerH + 19 + li * 14, "text-anchor": "middle", "font-size": xFontSize, fill: "var(--chart-text)",
      });
      xt.textContent = line;
      svg.append(xt);
    });
  });
  const wrap = document.createElement("div");
  wrap.className = "chart-block";
  wrap.append(svg);
  return wrap;
}

export interface HeatmapOptions {
  rowLabels: string[];
  colLabels: string[];
  matrix: number[][]; // matrix[row][col]
  valueFormat?: (v: number) => string;
  /** 히트맵을 채워 넣을 컨테이너의 대략적인 폭(px)을 강제 지정하고 싶을 때만 쓴다.
   * 지정하지 않으면 responsiveHeatmapFit()이 화면 폭(모바일/절반창/데스크톱)에 맞는
   * 폭과 칸 크기 범위를 자동으로 고른다 — 모바일·1/2 화면에서 스크롤 없이 한 화면에
   * 들어오게 해 달라는 요청 때문이다. */
  fitWidth?: number;
}

/** 화면 폭에 따라 히트맵의 "설계 폭"(viewBox width)과 칸(cell) 크기 허용 범위를
 * 함께 고른다. lineChart의 responsiveLineChartWidth와 같은 취지 — 컨테이너보다
 * 뷰박스가 넓으면 svg.chart{width:100%}가 전체를 축소해 글자까지 작아지고, 반대로
 * 강제로 최소 폭을 지키면 옆으로 스크롤이 생긴다. 화면 구간별로 폭과 함께 칸
 * 최소 크기도 낮춰 줘야(모바일 30px, 데스크톱 46px) 그룹 수가 많아도(최대 8x8)
 * 실제로 한 화면 폭 안에 다 들어간다.
 * heightRatio: 칸의 세로/가로 비율 — 모바일·절반 창은 1(정사각형)을 유지해 달라는
 * 요청이지만, 전체 웹 화면(데스크톱)은 그룹 수가 늘어날수록(최대 8x8) 세로로 너무
 * 길어져 한 화면에 안 들어온다는 요청으로 정사각형 대신 더 낮은 직사각형(0.62)으로
 * 눌러, 가로 폭은 넉넉히 쓰되 세로 길이는 압축한다. */
function responsiveHeatmapFit(): { width: number; cellMin: number; cellMax: number; heightRatio: number } {
  if (typeof window === "undefined") return { width: 1000, cellMin: 46, cellMax: 92, heightRatio: 0.62 };
  const vw = window.innerWidth;
  if (vw <= 640) return { width: 360, cellMin: 30, cellMax: 60, heightRatio: 1 }; // 휴대폰: 정사각형 유지
  if (vw <= 900) return { width: 640, cellMin: 38, cellMax: 76, heightRatio: 1 }; // 절반 창·태블릿: 정사각형 유지
  return { width: 1000, cellMin: 46, cellMax: 92, heightRatio: 0.62 }; // 데스크톱: 직사각형으로 눌러 세로 길이 절약
}

/** 순차(sequential) 색상 히트맵 — --chart-seq-100/400/700 세 단계를 보간해 쓴다. */
export function heatmap(opts: HeatmapOptions): HTMLDivElement {
  const fit = opts.fitWidth
    ? { width: opts.fitWidth, cellMin: 46, cellMax: 92, heightRatio: 1 }
    : responsiveHeatmapFit();
  // 행 라벨을 "그룹 1"처럼 짧게 통일했으므로(호출부 tab4.ts), 왼쪽 여백도 그만큼
  // 줄어든다 — 예전(전체 그룹 설명 문구, char당 9px)에는 최소 96px을 깔아야 했지만,
  // 이제는 실제 짧은 라벨 길이만큼만(char당 11px, 최소 40px) 확보하면 된다.
  const margin = { top: 10, right: 8, bottom: 8, left: Math.max(40, ...opts.rowLabels.map((r) => r.length * 11)) };
  // 칸 가로 폭을 fit.width에 맞춰 늘리거나 줄인다(fit.cellMin~fit.cellMax 사이) —
  // 카드는 넓은데 히트맵만 작게 그려져 여백이 남거나, 반대로 칸이 화면보다 넓어져
  // 스크롤이 생기는 문제를 함께 해결한다. 세로 칸 높이(cellH)는 가로 폭에
  // heightRatio를 곱해 구한다 — 데스크톱은 1보다 작아 정사각형이 아닌 납작한
  // 직사각형 칸이 되고, 모바일·절반 창은 1이라 기존과 같은 정사각형을 유지한다.
  const cellW = Math.max(fit.cellMin, Math.min(fit.cellMax, (fit.width - margin.left - margin.right) / Math.max(1, opts.colLabels.length)));
  const cellH = cellW * fit.heightRatio;
  const width = margin.left + margin.right + opts.colLabels.length * cellW;
  const height = margin.top + margin.bottom + opts.rowLabels.length * cellH + 26;
  const maxV = Math.max(1, ...opts.matrix.flat());
  // 칸(cell)이 좁아지는 모바일에서는 "그룹 1"·"그룹 2"처럼 짧아진 라벨이라도 13px
  // 그대로 쓰면 옆 칸 라벨과 글자가 겹쳐 붙어 보인다 — 칸 크기에 맞춰 라벨·칸 안
  // 숫자 폰트도 함께 줄인다(칸이 넓은 데스크톱 등은 기존 13/15px 그대로 유지).
  const minCell = Math.min(cellW, cellH);
  const axisFontSize = minCell < 45 ? 11 : 13;
  const valueFontSize = minCell < 45 ? 12 : 15;

  // width 자체를 화면 폭에 맞춰 미리 고르므로(위 responsiveHeatmapFit), lineChart와
  // 동일하게 svg.chart{width:100%;height:auto}(styles.css 공통 규칙)에 맡겨 컨테이너에
  // 꼭 맞게 스케일되게 한다 — 고정 px 폭을 강제하지 않아 좌우 스크롤이 생기지 않는다.
  const svg = svgEl("svg", { class: "chart", viewBox: `0 0 ${width} ${height}`, style: `aspect-ratio:${width}/${height}` });
  // 축 라벨(그룹 이름)·칸 안 숫자 모두 가독성이 떨어진다는 요청으로 10px→13px,
  // 11px→15px(굵게)로 키웠다.
  opts.colLabels.forEach((c, ci) => {
    const t = svgEl("text", {
      x: margin.left + ci * cellW + cellW / 2, y: margin.top + 14, "text-anchor": "middle", "font-size": axisFontSize, "font-weight": 600, fill: "var(--chart-text)",
    });
    t.textContent = c;
    svg.append(t);
  });
  opts.rowLabels.forEach((r, ri) => {
    const t = svgEl("text", {
      x: margin.left - 8, y: margin.top + 26 + ri * cellH + cellH / 2 + 3, "text-anchor": "end", "font-size": axisFontSize, "font-weight": 600, fill: "var(--chart-text)",
    });
    t.textContent = r;
    svg.append(t);
    opts.colLabels.forEach((_c, ci) => {
      const v = opts.matrix[ri]?.[ci] ?? 0;
      const t01 = Math.min(1, v / maxV);
      const fill = mixSequential(t01);
      const x = margin.left + ci * cellW;
      const y = margin.top + 26 + ri * cellH;
      svg.append(svgEl("rect", { x: x + 1, y: y + 1, width: cellW - 2, height: cellH - 2, rx: 4, fill }));
      const label = svgEl("text", {
        x: x + cellW / 2, y: y + cellH / 2 + 5, "text-anchor": "middle", "font-size": valueFontSize, "font-weight": 700,
        fill: t01 > 0.55 ? "#fff" : "var(--ink)",
      });
      label.textContent = opts.valueFormat ? opts.valueFormat(v) : String(Math.round(v));
      svg.append(label);
    });
  });
  const wrap = document.createElement("div");
  wrap.className = "chart-block";
  wrap.style.overflowX = "auto";
  wrap.append(svg);
  return wrap;
}

function mixSequential(t: number): string {
  // --chart-seq-100(연함) -> 400 -> 700(짙음) 3단 보간. CSS 변수는 브라우저가 계산 못 하므로
  // getComputedStyle로 실제 hex를 읽어 온다.
  const root = getComputedStyle(document.documentElement);
  const c100 = root.getPropertyValue("--chart-seq-100").trim() || "#cde2fb";
  const c400 = root.getPropertyValue("--chart-seq-400").trim() || "#3987e5";
  const c700 = root.getPropertyValue("--chart-seq-700").trim() || "#0d366b";
  const [a, b, tt] = t < 0.5 ? [c100, c400, t / 0.5] : [c400, c700, (t - 0.5) / 0.5];
  return lerpHex(a, b, tt);
}
function lerpHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${g},${bl})`;
}
function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
