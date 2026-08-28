/**
 * 앱 부트스트랩 — 사이드바(그룹 수·요금 가정·부가요금세금) + 상단 탭 8개를 구성하고,
 * lib/*.ts + data/*.json으로 계산한 상태(AppContext)를 각 탭 렌더 함수에 넘긴다.
 * 사이드바 값이 바뀌면(원본과 동일하게) enrichScores/dynamicTariffAnalysis를 다시 돌리고,
 * 현재 활성 탭만 즉시 다시 그린다(비활성 탭은 dirty 표시만 해 뒀다가 다음에 열릴 때 그린다).
 */

import { loadRawData, computeDerivedState, type RawData, type DerivedState } from "./data.js";
import type { FeeParams } from "../../lib/tariff-monitor.js";
import { el, numberField, selectField } from "./ui.js";

import { renderTab1 } from "./tabs/tab1.js";
import { renderTab2 } from "./tabs/tab2.js";
import { renderTab3 } from "./tabs/tab3.js";
import { renderTab4 } from "./tabs/tab4.js";
import { renderTab5 } from "./tabs/tab5.js";
import { renderTab6 } from "./tabs/tab6.js";
import { renderTab7 } from "./tabs/tab7.js";
import { renderTab8 } from "./tabs/tab8.js";

export interface AppContext {
  raw: RawData;
  state: DerivedState;
}

const TABS = [
  { id: "t1", label: "2024~2025년 사용량 분석", render: renderTab1 },
  { id: "t2", label: "고객별 요금 모니터링", render: renderTab2 },
  { id: "t3", label: "고객별 진단·제어", render: renderTab3 },
  { id: "t4", label: "고객 그룹 분석", render: renderTab4 },
  { id: "t5", label: "요금분석 및 추천", render: renderTab5 },
  { id: "t6", label: "계통영향 분석 및 제어 시뮬레이션", render: renderTab6 },
  { id: "t7", label: "방법론·한계", render: renderTab7 },
  { id: "t8", label: "용어·문구 해설", render: renderTab8 },
] as const;

async function boot(): Promise<void> {
  const root = document.getElementById("app")!;
  root.innerHTML = "";
  const loading = el("div", { className: "empty-note", text: "데이터를 불러오는 중입니다..." });
  root.append(loading);

  let raw: RawData;
  try {
    raw = await loadRawData();
  } catch (err) {
    loading.textContent = `데이터를 불러오지 못했습니다: ${(err as Error).message}`;
    return;
  }
  loading.remove();

  let clusterCount = 8;
  let fee: FeeParams = {
    basicFee: 84_900,
    basicInc: 450,
    premiumFee: 249_000,
    premiumInc: 1_000,
    overage: 300,
    contractKw: 3.0,
    surchargeRates: { fuel: 5.0, climate: 9.0, vat: 0.1, fund: 0.027 },
  };
  let state = computeDerivedState(raw, clusterCount, fee);
  const ctx: AppContext = { raw, state };

  const dirty = new Set<string>(TABS.map((t) => t.id));
  let activeTabId: string = TABS[0].id;

  // ── 상단 바 ──
  const tablist = el("div", { className: "tablist" });
  const panelsHost = el("div", { className: "main" });
  const panels = new Map<string, HTMLDivElement>();
  for (const tab of TABS) {
    const btn = el("button", { className: "tab-btn", type: "button", text: tab.label });
    btn.addEventListener("click", () => setActiveTab(tab.id));
    btn.dataset.tabId = tab.id;
    tablist.append(btn);
    const panel = el("div", { className: "tab-panel" });
    panels.set(tab.id, panel);
    panelsHost.append(panel);
  }

  function refreshTabButtons() {
    tablist.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tabId === activeTabId);
    });
  }

  function renderIfNeeded(tabId: string) {
    if (!dirty.has(tabId)) return;
    const tab = TABS.find((t) => t.id === tabId)!;
    const panel = panels.get(tabId)!;
    panel.innerHTML = "";
    try {
      tab.render(panel, ctx);
    } catch (err) {
      console.error(err);
      panel.append(el("div", { className: "alert-box warning", text: `이 탭을 그리는 중 오류가 발생했습니다: ${(err as Error).message}` }));
    }
    dirty.delete(tabId);
  }

  function setActiveTab(tabId: string) {
    activeTabId = tabId;
    panels.forEach((p, id) => p.classList.toggle("active", id === tabId));
    refreshTabButtons();
    renderIfNeeded(tabId);
  }

  function onStateChanged() {
    state = computeDerivedState(raw, clusterCount, fee);
    ctx.state = state;
    TABS.forEach((t) => dirty.add(t.id));
    renderIfNeeded(activeTabId);
  }

  const menuBtn = el("button", { className: "menu-btn", type: "button", text: "☰" });
  // 도메인 루트(허브: PRAS-DER/CARE-Jeju 선택 화면)로 돌아가는 버튼. 이 앱은 basePath
  // 개념이 없는 정적 페이지이고 /care/ 아래에서 서비스되므로, href="/"는 그대로
  // 실제 도메인 루트를 가리킨다(별도 우회 불필요).
  const homeBtn = el("a", {
    className: "site-home-btn",
    href: "/",
    html:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.6 11.4 12 4.4l8.4 7"/><path d="M5.7 10.2V19a1 1 0 0 0 1 1H9.6v-5.3h4.8V20h2.9a1 1 0 0 0 1-1v-8.8"/></svg><span>처음으로</span>',
  });
  homeBtn.setAttribute("aria-label", "처음 화면으로");

  // ── 상단 2단 구조(PRAS-DER와 통일) ──
  // PRAS는 (1) 얇은 다크 네비게이션 바 + (2) 그 아래 큰 그라디언트 히어로 배너(제목·부제)
  // 로 이루어진 2단 헤더를 쓴다(app/globals.css .site-nav + .hero). CARE는 지금까지
  // 이 둘을 하나의 52px 바에 욱여넣고 있었다 — 브랜드 텍스트가 작고 탭과 나란히 있어
  // 페이지 정체성이 잘 드러나지 않았다. 아래에서 PRAS와 동일한 2단 구조로 나눈다
  // (색만 CARE 고유 팔레트를 쓰고, 배치·크기·여백은 그대로 맞춘다).
  const brandLogo = el("a", { className: "site-brand", href: "/care/" }, [
    document.createTextNode("CARE"),
    el("span", { text: "JEJU" }),
  ]);
  const nav = el("div", { className: "topbar" }, [brandLogo, tablist, homeBtn, menuBtn]);

  const hero = el("div", { className: "hero" }, [
    el("div", { className: "hero-inner" }, [
      el("h1", { text: "제주 TOU 요금·에너지관리 시뮬레이터(CARE - Jeju)" }),
      el("p", {
        text: "Customer Analytics, Rate Recommendation & Energy Management - 제주 TOU 요금·에너지관리",
      }),
    ]),
  ]);

  // ── 사이드바 ──
  const sidebar = el("div", { className: "sidebar" });
  function buildSidebar() {
    sidebar.innerHTML = "";
    sidebar.append(el("h3", { text: "분석 설정" }));
    const clusterField = el("div", { className: "field" }, [
      el("label", { text: `공통 그룹 수: ${clusterCount}개` }),
      (() => {
        const input = el("input", { type: "range", min: "3", max: "8", step: "1", value: String(clusterCount) }) as HTMLInputElement;
        input.addEventListener("input", () => {
          (clusterField.querySelector("label") as HTMLElement).textContent = `공통 그룹 수: ${input.value}개`;
        });
        input.addEventListener("change", () => {
          clusterCount = Number(input.value);
          onStateChanged();
        });
        return input;
      })(),
    ]);
    sidebar.append(clusterField);

    sidebar.append(el("h3", { text: "요금 가정" }));
    const feeFields: [string, keyof FeeParams, number][] = [
      ["기본형 월 구독료(최종 납부액, 원)", "basicFee", 1000],
      ["기본형 제공량(kWh)", "basicInc", 10],
      ["프리미엄형 월 구독료(최종 납부액, 원)", "premiumFee", 1000],
      ["프리미엄형 제공량(kWh)", "premiumInc", 10],
    ];
    for (const [label, key, step] of feeFields) {
      sidebar.append(
        wrapField(
          numberField(label, fee[key] as number, (v) => {
            fee = { ...fee, [key]: v };
            onStateChanged();
          }, { step, min: 0 })
        )
      );
    }
    sidebar.append(
      wrapField(
        selectField(
          "최종 초과단가(원/kWh, 부가요금·세금 포함)",
          [200, 300, 307.3, 400].map((v) => ({ value: String(v), label: String(v) })),
          String(fee.overage),
          (v) => {
            fee = { ...fee, overage: Number(v) };
            onStateChanged();
          }
        )
      )
    );
    sidebar.append(
      wrapField(
        numberField("제주 TOU 계약전력 가정(kW)", fee.contractKw ?? 3, (v) => {
          fee = { ...fee, contractKw: v };
          onStateChanged();
        }, { step: 1, min: 1, max: 30 })
      )
    );

    sidebar.append(el("h3", { text: "부가요금·세금" }));
    const rateFields: [string, keyof NonNullable<FeeParams["surchargeRates"]>, number][] = [
      ["연료비조정단가(원/kWh)", "fuel", 0.5],
      ["기후환경요금단가(원/kWh)", "climate", 0.5],
    ];
    for (const [label, key, step] of rateFields) {
      sidebar.append(
        wrapField(
          numberField(label, fee.surchargeRates![key], (v) => {
            fee = { ...fee, surchargeRates: { ...fee.surchargeRates!, [key]: v } };
            onStateChanged();
          }, { step })
        )
      );
    }
    sidebar.append(
      wrapField(
        numberField("부가가치세율(%)", (fee.surchargeRates!.vat) * 100, (v) => {
          fee = { ...fee, surchargeRates: { ...fee.surchargeRates!, vat: v / 100 } };
          onStateChanged();
        }, { step: 0.1, min: 0, max: 20 })
      )
    );
    sidebar.append(
      wrapField(
        numberField("전력산업기반기금 요율(%)", (fee.surchargeRates!.fund) * 100, (v) => {
          fee = { ...fee, surchargeRates: { ...fee.surchargeRates!, fund: v / 100 } };
          onStateChanged();
        }, { step: 0.1, min: 0, max: 10 })
      )
    );

    sidebar.append(
      el("div", {
        className: "callout",
        text:
          "일반 주택용(저압)과 제주 TOU에는 연료비조정액·기후환경요금·부가가치세·전력산업기반기금을 별도 반영합니다. 구독 기본형·프리미엄형은 표시된 월 구독료와 초과단가가 모든 부가요금·세금을 포함한 최종 소비자가격입니다.",
      })
    );
    sidebar.append(
      el("div", {
        className: "callout muted",
        text: "2026년 6월 요금표를 2024·2025년 사용량에 동일 적용합니다. 일반 주택용은 저압 요율, 제주 TOU는 별도 계시별 요율과 설정한 계약전력을 적용합니다.",
      })
    );
  }
  function wrapField(control: HTMLDivElement): HTMLDivElement {
    // numberField/selectField는 .control(가로 필터용)을 반환하므로, 세로 사이드바 폭에 맞춰 감싼다.
    control.className = "field";
    return control;
  }
  buildSidebar();

  menuBtn.addEventListener("click", () => sidebar.classList.toggle("open"));

  const shell = el("div", { className: "app-shell" }, [sidebar, panelsHost]);
  const footer = el("footer", {
    className: "app-footer",
    text: "CARE-Jeju 시뮬레이터는 개념검증·내부 의사결정 지원도구이며, 실제 요금상품 출시나 배전계통 운전명령에 직접 사용하는 운영시스템이 아닙니다. 자세한 한계는 «방법론·한계» 탭을 참고하세요.",
  });
  root.append(nav, hero, shell, footer);

  setActiveTab(TABS[0].id);
}

boot();
