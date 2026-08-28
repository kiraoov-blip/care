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
}

/** 여러 계열의 라인차트 + 범례 + 호버 크로스헤어/툴팁(마크 규격: 2px 선, 4px 라운드 끝점, 8px 마커).
 * width 기본값(1000)은 카드로 감싸지 않고 .main에 바로 놓이는 "화면 폭 전체" 차트를
 * 기준으로 잡았다(탭1·3·6의 라인차트가 모두 이 경우) — PRAS-DER의 요금/사용량 그래프
 * (.load-line-chart svg{width:100%})처럼 차트가 카드 폭을 그대로 채우게 하기 위함이다.
 * card-row 안에 절반 폭으로 들어가는 차트는 호출부에서 width를 좁게 지정한다. */
export function lineChart(opts: LineChartOptions): HTMLDivElement {
  const width = opts.width ?? 1000;
  const height = opts.height ?? 260;
  const margin = { top: 12, right: 16, bottom: 28, left: 52 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const allValues = opts.series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const yMin = Math.min(0, ...allValues);
  const yMax = Math.max(1, ...allValues) * 1.08;
  const n = opts.xLabels.length;
  const xAt = (i: number) => margin.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => margin.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  // svg.chart{width:100%;height:auto}(styles.css)로 카드·본문 폭을 그대로 채운다 —
  // 예전에는 여기 max-width를 별도로 박아 뒀지만, 그러면 폭이 넓은 카드에서 차트
  // 옆에 빈 여백이 남았다. 이제 페이지 전체 폭이 PRAS-DER와 같은 1480px로 상한이
  // 걸려 있으므로(전체 레이아웃 섹션 참고) 차트에 별도 상한을 두지 않아도 무한정
  // 커지지 않는다.
  const svg = svgEl("svg", { class: "chart", viewBox: `0 0 ${width} ${height}` });

  // 격자(recessive) + y축 눈금
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const v = yMin + ((yMax - yMin) * t) / ticks;
    const y = yAt(v);
    svg.append(svgEl("line", { x1: margin.left, x2: width - margin.right, y1: y, y2: y, stroke: "var(--chart-grid)", "stroke-width": 1 }));
    const label = svgEl("text", { x: margin.left - 8, y: y + 3, "text-anchor": "end", "font-size": 10, fill: "var(--chart-text)" });
    label.textContent = opts.yFormat ? opts.yFormat(v) : v.toLocaleString("ko-KR");
    svg.append(label);
  }
  // x축 라벨
  const everyN = opts.xTickEvery ?? Math.max(1, Math.ceil(n / 12));
  opts.xLabels.forEach((lab, i) => {
    if (i % everyN !== 0 && i !== n - 1) return;
    const t = svgEl("text", { x: xAt(i), y: height - 8, "text-anchor": "middle", "font-size": 10, fill: "var(--chart-text)" });
    t.textContent = String(lab);
    svg.append(t);
  });

  // 계열 선 + 마커
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
    s.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) return;
      svg.append(svgEl("circle", { cx: xAt(i), cy: yAt(v), r: 3, fill: color }));
    });
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
    tip.style.top = `${(margin.top / height) * rect.height}px`;
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
}

/** 단일 계열 막대차트 — 막대 위 직접 라벨(원본 px.bar(text=...) 대응), 인접 막대 사이 2px 갭.
 * width 기본값(820)은 lineChart와 같은 이유로 .main에 바로 놓이는 화면 폭 전체 차트
 * 기준이다(탭5의 요금제 분포 막대). card-row 절반 폭에 들어가는 차트(탭1의 증감률
 * 분포)는 호출부에서 width:560을 명시로 지정한다. */
export function barChart(opts: BarChartOptions): HTMLDivElement {
  const width = opts.width ?? 820;
  const height = opts.height ?? 240;
  const margin = { top: 22, right: 16, bottom: 34, left: 46 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const n = opts.data.length;
  const maxV = Math.max(1, ...opts.data.map((d) => d.value)) * 1.18;
  const slot = innerW / Math.max(n, 1);
  const barW = Math.max(6, slot - 10);
  const color = seriesColor(opts.colorIndex ?? 0);

  // svg.chart{width:100%;height:auto}로 카드 폭을 채운다(라인차트와 같은 이유 — 위 주석 참고).
  const svg = svgEl("svg", { class: "chart", viewBox: `0 0 ${width} ${height}` });
  svg.append(svgEl("line", { x1: margin.left, x2: width - margin.right, y1: margin.top + innerH, y2: margin.top + innerH, stroke: "var(--chart-grid)", "stroke-width": 1 }));

  opts.data.forEach((d, i) => {
    const h = (d.value / maxV) * innerH;
    const x = margin.left + i * slot + (slot - barW) / 2;
    const y = margin.top + innerH - h;
    svg.append(svgEl("rect", { x, y, width: barW, height: Math.max(h, 0), rx: 4, fill: color }));
    const label = svgEl("text", { x: x + barW / 2, y: y - 6, "text-anchor": "middle", "font-size": 11, fill: "var(--chart-text)", "font-weight": 700 });
    label.textContent = opts.valueFormat ? opts.valueFormat(d.value) : d.value.toLocaleString("ko-KR");
    svg.append(label);
    const xt = svgEl("text", { x: x + barW / 2, y: margin.top + innerH + 16, "text-anchor": "middle", "font-size": 10.5, fill: "var(--chart-text)" });
    xt.textContent = d.label;
    svg.append(xt);
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
  /** 히트맵을 채워 넣을 컨테이너의 대략적인 폭(px) — 지정하면 칸(cell) 크기를 이 폭에
   * 맞춰 키운다(46~92px 사이로 제한). 지정하지 않으면 기존처럼 46px 고정 칸으로 그린다
   * (칸이 곧 격자 의미를 가지는 표라, 다른 차트처럼 무제한으로 늘리지는 않는다). */
  fitWidth?: number;
}

/** 순차(sequential) 색상 히트맵 — --chart-seq-100/400/700 세 단계를 보간해 쓴다. */
export function heatmap(opts: HeatmapOptions): HTMLDivElement {
  const margin = { top: 8, right: 8, bottom: 8, left: Math.max(90, ...opts.rowLabels.map((r) => r.length * 7)) };
  // fitWidth가 있으면 칸 크기를 늘려 카드 폭을 채운다 — 카드는 넓은데 히트맵만 작게
  // 그려져 좌우에 빈 여백이 크게 남던 문제(46px 고정 칸)를 해결한다. 너무 커지면
  // 오히려 칸 하나의 의미가 옅어지므로 92px에서 상한을 둔다.
  const cell = opts.fitWidth
    ? Math.max(46, Math.min(92, (opts.fitWidth - margin.left - margin.right) / Math.max(1, opts.colLabels.length)))
    : 46;
  const width = margin.left + margin.right + opts.colLabels.length * cell;
  const height = margin.top + margin.bottom + opts.rowLabels.length * cell + 24;
  const maxV = Math.max(1, ...opts.matrix.flat());

  // 히트맵은 칸(cell) 하나하나의 크기가 의미를 가지므로(격자) 다른 차트처럼
  // width:100%로 컨테이너 폭까지 무제한으로 늘리지 않는다 — 위에서 계산한 실제
  // 크기 그대로 그리고, 화면이 좁을 때만 wrap의 overflow-x:auto로 가로 스크롤을 허용한다.
  const svg = svgEl("svg", { class: "chart", viewBox: `0 0 ${width} ${height}`, style: `width:${width}px;max-width:${width}px` });
  opts.colLabels.forEach((c, ci) => {
    const t = svgEl("text", {
      x: margin.left + ci * cell + cell / 2, y: margin.top + 12, "text-anchor": "middle", "font-size": 10, fill: "var(--chart-text)",
    });
    t.textContent = c;
    svg.append(t);
  });
  opts.rowLabels.forEach((r, ri) => {
    const t = svgEl("text", {
      x: margin.left - 8, y: margin.top + 24 + ri * cell + cell / 2 + 3, "text-anchor": "end", "font-size": 10, fill: "var(--chart-text)",
    });
    t.textContent = r;
    svg.append(t);
    opts.colLabels.forEach((_c, ci) => {
      const v = opts.matrix[ri]?.[ci] ?? 0;
      const t01 = Math.min(1, v / maxV);
      const fill = mixSequential(t01);
      const x = margin.left + ci * cell;
      const y = margin.top + 24 + ri * cell;
      svg.append(svgEl("rect", { x: x + 1, y: y + 1, width: cell - 2, height: cell - 2, rx: 4, fill }));
      const label = svgEl("text", {
        x: x + cell / 2, y: y + cell / 2 + 4, "text-anchor": "middle", "font-size": 11, "font-weight": 700,
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
