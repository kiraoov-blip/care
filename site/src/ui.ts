/**
 * 8개 탭이 공통으로 쓰는 DOM 구성 유틸 — 표·지표카드·필터 컨트롤·배지·경고박스·CSV 다운로드.
 * Streamlit의 st.dataframe/st.metric/st.selectbox/st.download_button 등에 대응한다.
 */

import { isMoneyColumn, roundForDisplay } from "../../lib/format.js";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string; text?: string; html?: string } = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { className, text, html, ...rest } = props as Record<string, unknown>;
  if (className) node.className = className as string;
  if (text !== undefined) node.textContent = text as string;
  if (html !== undefined) (node as HTMLElement).innerHTML = html as string;
  Object.assign(node, rest);
  for (const c of children) node.append(c);
  return node;
}

export function clear(container: HTMLElement): void {
  container.replaceChildren();
}

// ── 지표 카드(st.metric) ────────────────────────────────────────────────
export interface MetricSpec {
  label: string;
  value: string;
  delta?: string;
  deltaDirection?: "up" | "down";
  help?: string;
}
export function metricGrid(items: MetricSpec[]): HTMLDivElement {
  const grid = el("div", { className: "metric-grid" });
  for (const m of items) {
    const card = el("div", { className: "metric-card" }, [
      el("div", { className: "label", text: m.label, title: m.help ?? "" }),
      el("div", { className: "value", text: m.value }),
    ]);
    if (m.delta) {
      card.append(el("div", { className: `delta ${m.deltaDirection ?? ""}`.trim(), text: m.delta }));
    }
    grid.append(card);
  }
  return grid;
}

// ── 표(st.dataframe) ───────────────────────────────────────────────────
export type ColumnKind = "text" | "number" | "money" | "manwon" | "percent" | "count";
export interface ColumnSpec<T> {
  key: string;
  label: string;
  kind?: ColumnKind;
  get?: (row: T) => unknown;
}
function inferKind(name: string): ColumnKind {
  if (name.includes("(%)") || name.includes("%p")) return "percent";
  if (name.includes("(만원)")) return "manwon";
  if (isMoneyColumn(name)) return "money";
  if (name.includes("(명)") || name.includes("고객수") || name.includes("고객 수")) return "count";
  return "number";
}
function formatCell(value: unknown, kind: ColumnKind): string {
  if (value === null || value === undefined || (typeof value === "number" && Number.isNaN(value))) return "";
  if (typeof value !== "number") return String(value);
  switch (kind) {
    case "percent":
      return `${value.toFixed(1)}%`;
    case "money":
      return `₩${Math.round(value).toLocaleString("ko-KR")}`;
    case "manwon":
      // 원 단위 그대로 쓰면 표 폭이 넓어져 좌우 스크롤이 잘 생긴다 — 만원 단위(소수
      // 1자리)로 줄여서 자리수를 크게 줄인다(예: 1,640,820원 → 164.1만원).
      return `${(value / 10000).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}만원`;
    case "count":
      return Math.round(value).toLocaleString("ko-KR");
    case "number":
      return value.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    default:
      return String(value);
  }
}

export interface TableOptions {
  height?: number; // px, 지정하면 세로 스크롤 표(원본 st.dataframe height=)
}
export function renderTable<T extends Record<string, unknown>>(
  columns: ColumnSpec<T>[],
  rows: T[],
  opts: TableOptions = {}
): HTMLDivElement {
  const wrap = el("div", { className: "table-wrap" });
  const scroller = el("div", { className: opts.height ? "table-scroll" : "" });
  if (opts.height) scroller.style.maxHeight = `${opts.height}px`;
  const table = el("table", { className: "data-table" });
  const thead = el("thead");
  const headRow = el("tr");
  for (const c of columns) {
    const kind = c.kind ?? inferKind(c.label);
    headRow.append(el("th", { className: kind === "text" ? "" : "num", text: c.label }));
  }
  thead.append(headRow);
  const tbody = el("tbody");
  for (const row of rows) {
    const tr = el("tr");
    for (const c of columns) {
      const kind = c.kind ?? inferKind(c.label);
      const raw = c.get ? c.get(row) : row[c.key];
      const display = kind === "text" ? String(raw ?? "") : formatCell(raw, kind);
      tr.append(el("td", { className: kind === "text" ? "" : "num", text: display }));
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  scroller.append(table);
  wrap.append(scroller);
  return wrap;
}

/** display_full_text_table(원본) — 말줄임표 없이 줄바꿈하는 표. renderTable과 시각 스타일은
 * 같지만(.data-table 재사용) white-space를 normal로 둔다(긴 문구가 있는 진단 화면용). */
export function renderFullTextTable<T extends Record<string, unknown>>(
  columns: ColumnSpec<T>[],
  rows: T[]
): HTMLDivElement {
  const wrap = renderTable(columns, rows);
  wrap.querySelectorAll("th, td").forEach((n) => ((n as HTMLElement).style.whiteSpace = "normal"));
  return wrap;
}

// ── 배지·경고박스 ───────────────────────────────────────────────────────
export function alertPill(level: string): HTMLSpanElement {
  return el("span", { className: `pill alert-${level}`, text: level });
}
export function alertBox(kind: "success" | "info" | "warning", html: string): HTMLDivElement {
  return el("div", { className: `alert-box ${kind}`, html });
}

// ── 필터 컨트롤 ─────────────────────────────────────────────────────────
export function selectField(
  label: string,
  options: { value: string; label: string }[],
  value: string,
  onChange: (v: string) => void
): HTMLDivElement {
  const select = el("select", { value }) as HTMLSelectElement;
  for (const o of options) select.append(el("option", { value: o.value, text: o.label }));
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  return el("div", { className: "control" }, [el("label", { text: label }), select]);
}

export function numberField(
  label: string,
  value: number,
  onChange: (v: number) => void,
  opts: { min?: number; max?: number; step?: number } = {}
): HTMLDivElement {
  const input = el("input", { type: "number", value: String(value) }) as HTMLInputElement;
  if (opts.min !== undefined) input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  if (opts.step !== undefined) input.step = String(opts.step);
  input.addEventListener("change", () => onChange(Number(input.value)));
  return el("div", { className: "control" }, [el("label", { text: label }), input]);
}

export function radioField(
  label: string,
  options: { value: string; label: string }[],
  value: string,
  onChange: (v: string) => void
): HTMLDivElement {
  const row = el("div", { className: "radio-row" });
  const name = `radio-${Math.random().toString(36).slice(2)}`;
  function refresh() {
    row.querySelectorAll("label").forEach((l, i) => l.classList.toggle("checked", options[i].value === value));
  }
  for (const o of options) {
    const input = el("input", { type: "radio", name, value: o.value }) as HTMLInputElement;
    input.checked = o.value === value;
    input.addEventListener("change", () => {
      onChange(o.value);
    });
    row.append(el("label", {}, [input, document.createTextNode(o.label)]));
  }
  refresh();
  return el("div", { className: "control" }, [el("label", { text: label }), row]);
}

export function checkboxGroupField(
  label: string,
  options: string[],
  selected: Set<string>,
  onChange: (selected: Set<string>) => void
): HTMLDivElement {
  const grid = el("div", { className: "checkbox-grid" });
  for (const o of options) {
    const input = el("input", { type: "checkbox" }) as HTMLInputElement;
    input.checked = selected.has(o);
    const wrap = el("label", { className: selected.has(o) ? "checked" : "" }, [
      input,
      document.createTextNode(o),
    ]);
    input.addEventListener("change", () => {
      if (input.checked) selected.add(o);
      else selected.delete(o);
      wrap.classList.toggle("checked", input.checked);
      onChange(selected);
    });
    grid.append(wrap);
  }
  return el("div", { className: "control" }, [el("label", { text: label }), grid]);
}

export function controlsRow(controls: HTMLElement[]): HTMLDivElement {
  return el("div", { className: "controls-row" }, controls);
}

// ── CSV 다운로드(st.download_button) ────────────────────────────────────
function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv<T extends Record<string, unknown>>(columns: { key: string; label: string }[], rows: T[]): string {
  const header = columns.map((c) => csvEscape(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c.key])).join(",")).join("\n");
  return `﻿${header}\n${body}`;
}
export function downloadCsvButton<T extends Record<string, unknown>>(
  label: string,
  filename: string,
  columns: { key: string; label: string }[],
  rows: T[]
): HTMLButtonElement {
  const btn = el("button", { className: "download-btn", type: "button", text: `⭳ ${label}` }) as HTMLButtonElement;
  btn.addEventListener("click", () => {
    const csv = toCsv(columns, rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename }) as HTMLAnchorElement;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
  return btn;
}

export function sectionCard(title: string | null, children: (Node | string)[]): HTMLDivElement {
  const card = el("div", { className: "section-card" });
  if (title) card.append(el("h4", { text: title }));
  card.append(...children);
  return card;
}
export function cardRow(cards: HTMLElement[]): HTMLDivElement {
  return el("div", { className: "card-row" }, cards);
}
export function sectionTitle(text: string, sub?: string): (Node)[] {
  const nodes: Node[] = [el("div", { className: "section-title", text })];
  if (sub) nodes.push(el("div", { className: "section-sub", text: sub }));
  return nodes;
}
/** 탭 안에서 여러 분석 블록을 나눌 때 쓰는 하위 제목(원본 곳곳의 el("h3"/"h4", {text})를
 * 대체) — sectionTitle(탭 최상단, 1회)보다 한 단계 작고, section-card 안 h4보다 크다.
 * 번호(step)를 주면 "1. 연간 추천 요금제"처럼 순서가 있는 분석 절차를 시각적으로도
 * 드러낸다(장식이 아니라 실제 순서 정보가 있을 때만 사용). */
export function subheading(text: string, opts: { step?: number; sub?: string } = {}): (Node)[] {
  const nodes: Node[] = [
    el("div", { className: "subheading" }, [
      ...(opts.step !== undefined ? [el("span", { className: "subheading-step", text: String(opts.step) })] : []),
      el("span", { text }),
    ]),
  ];
  if (opts.sub) nodes.push(el("div", { className: "section-sub", text: opts.sub }));
  return nodes;
}
export function emptyNote(text: string): HTMLDivElement {
  return el("div", { className: "empty-note", text });
}

/** 클릭해야만 펼쳐지는 절 — subheading과 같은 자리에 쓰되, 본문(children)이 항상
 * 화면에 붙박여 있지 않고 접힌 채로 시작한다(예: 탭4의 "그룹 이동 상세"처럼 표가
 * 길어 항상 펼쳐 두면 화면을 많이 차지하는 보조 정보용). 네이티브 <details>/<summary>를
 * 써서 키보드·스크린리더 접근성을 별도 JS 없이 확보한다. */
export function collapsibleSection(
  title: string,
  children: (Node | string)[],
  opts: { step?: number; sub?: string; open?: boolean } = {}
): HTMLDetailsElement {
  const details = el("details", { className: "collapsible", open: opts.open ?? false }) as HTMLDetailsElement;
  const summary = el("summary", { className: "subheading" }, [
    ...(opts.step !== undefined ? [el("span", { className: "subheading-step", text: String(opts.step) })] : []),
    el("span", { text: title }),
    el("span", { className: "collapsible-caret", text: "▾" }),
  ]);
  details.append(summary);
  if (opts.sub) details.append(el("div", { className: "section-sub", text: opts.sub }));
  details.append(...children);
  return details;
}

// ── 핵심 결과 배너("분석 결과가 잘 드러나는" 화면을 위한 핵심 컴포넌트) ──────────
// 각 탭 최상단, 지표 카드보다도 먼저 "이 화면에서 가장 중요한 결론 한 문장"을
// 굵고 크게 보여준다. Streamlit 원본에는 없던 요소이지만, 표·차트를 직접 읽어야만
// 알 수 있던 결론을 첫눈에 보이도록 하는 것이 이번 재구성의 핵심 목표다.
export type InsightTone = "brand" | "mint" | "gold" | "red";
export interface InsightStat {
  label: string;
  value: string;
}
export interface InsightSpec {
  tone?: InsightTone; // 결론의 성격(개선=mint, 주의=brand/gold, 경고=red). 기본값 brand.
  headline: string; // 핵심 결론 한 문장(구체적 수치 포함, 예: "...전년 대비 3.2% 감소했습니다")
  detail?: string; // 보조 설명 한 문장(선택)
  stats?: InsightStat[]; // 헤드라인을 뒷받침하는 소수의 숫자 칩(2~4개 권장)
}
export function insightBanner(spec: InsightSpec): HTMLDivElement {
  const tone = spec.tone ?? "brand";
  const banner = el("div", { className: `insight-banner tone-${tone}` });
  const body = el("div", { className: "insight-body" }, [
    el("div", { className: "insight-headline", text: spec.headline }),
    ...(spec.detail ? [el("div", { className: "insight-detail", text: spec.detail })] : []),
  ]);
  banner.append(body);
  if (spec.stats && spec.stats.length) {
    const statRow = el(
      "div",
      { className: "insight-stats" },
      spec.stats.map((s) =>
        el("div", { className: "insight-stat" }, [
          el("span", { className: "insight-stat-value", text: s.value }),
          el("span", { className: "insight-stat-label", text: s.label }),
        ])
      )
    );
    banner.append(statRow);
  }
  return banner;
}

export { roundForDisplay };
