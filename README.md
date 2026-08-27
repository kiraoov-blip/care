# care — CARE(J-CARE) GitHub 기반 이관 작업 저장소

이 저장소는 현재 Streamlit Community Cloud(`care-jeju-v30.streamlit.app`)에서 서비스 중인
CARE 시뮬레이터를, PRAS-DER처럼 GitHub Pages 기반 정적 사이트로 이관하기 위한 작업 공간입니다.

## 폴더 구조

```
site/     실제로 GitHub Pages에 배포되는 내용
legacy/   원본 파이썬 소스 + 데이터 사본 (배포되지 않음, 골든값 캡처 전용)
golden/   원본 계산 결과를 고정한 기준값 (이관 검증용)
lib/      TypeScript로 이관된 계산 로직 (Stage 1부터 여기에 쌓입니다)
tests/golden/  lib/*.ts 가 golden/care-reference.json 과 정확히 같은 값을 내는지 대조하는 테스트
```

### site/ — 지금 당장 배포되는 것

지금은 `care-jeju-v30.streamlit.app`을 그대로 iframe으로 감싸는 얇은 래퍼입니다.
실제 계산은 여전히 Streamlit 서버에서 돕니다. Stage 1~5 이관이 끝나면 이 폴더의 내용이
Next.js 정적 빌드(또는 순수 정적 HTML/JS)로 교체되어, PRAS-DER의 hp/ev/pv-ess 시뮬레이터처럼
브라우저에서 직접 계산하는 형태가 됩니다.

`.github/workflows/deploy-pages.yml`은 `site/` 안의 내용만 GitHub Pages에 올립니다.
`legacy/`의 12MB 데이터는 배포 대상이 아닙니다.

### legacy/ — 원본 소스 사본 (읽기 전용 취급)

`subscription-energy-optimizer` 저장소의 `streamlit_app_actual_tou_v30.py`(실제 서비스 중인
버전)와, 그 파일이 실제로 사용하는 데이터 파일 16개만 골라 복사했습니다. 원본 저장소에 있던
사용되지 않는 29개의 예전 버전 스크립트와 그에 딸린 데이터는 제외해서 32MB → 12MB로 줄었습니다.

이 폴더는 **배포되지 않고, 수정하지도 않습니다.** 오직 `golden_capture.py`가 계산 함수만 골라
읽어서 "원본이 실제로 무엇을 반환하는지" 고정값을 뽑아내는 데만 씁니다.

### golden/ — 이관 검증용 기준값

- `golden_capture.py`: `legacy/streamlit_app_actual_tou_v30.py`에서 UI 이전의 순수 계산 함수만
  실행해 요금·구독·군집·최적화 결과를 JSON으로 뽑아내는 스크립트.
- `care-reference.json`: 그 결과 (저장소에 이미 있는 파일이며, 이번 업데이트에는 포함하지
  않았습니다 — `.github/workflows/care-golden-capture.yml`을 GitHub Actions에서 한 번 실행해
  ortools 최적화 2개 함수까지 포함한 완전한 버전으로 이미 갱신해두셨다면, 그 파일을 그대로
  두시면 됩니다. 이 파일이 곧 이관의 "정답지"입니다.

### lib/ + tests/golden/ — Stage 1: 요금·구독 계산 함수 TypeScript 이관

`lib/tariff.ts` 에 다음 함수들을 원본과 계산 순서·반올림 규칙을 그대로 유지해 포팅했습니다.

- `residentialBill` / `residentialBaseEnergy` — 주택용전력 저압 요금
- `touBill` / `touBaseEnergy` — 제주 주택용 계시별(TOU) 요금
- `subscriptionBill` / `inverseSubscriptionBill` — 구독형 요금·역산
- `billComponentBreakdown`, `finalizeElectricBill` — 청구액 구성요소 계산
- `roundHalfUp`, `truncateWon`, `truncate10Won`, `billedKwh`, `allocateIntegerKwh` — 반올림·절사·시간대 배분 유틸

`tests/golden/billing.test.ts`가 `golden/care-reference.json`에 들어있는 요금·구독·역산·구성요소·
반올림 케이스(총 320건)를 이 TS 함수들의 출력과 하나하나 대조합니다.

### lib/tariff-monitor.ts + lib/forecast.ts — Stage 2: 요금 모니터링·사용량 예측 이관

`monthly`(고객×연도×월 사용량) 테이블을 다루는 함수들을 포팅했습니다.

- `monthlyBillMap` / `annualBillMap` — 월별·연간 4개 요금제 동시 계산
- `billForPlan` / `inverseBillForPlan` — 특정 요금제 청구액·역산(이분탐색 70회, 원본과 동일)
- `tariffComparisonTable` — 요금제 비교표(현재 적용/추천/비교 판정)
- `dynamicTariffAnalysis` — 전체 고객의 월별·연간 추천요금제, 요금제별 평균/중앙값, 연도간
  전이표, 안정성 지표까지 한 번에 재계산 (원본이 pandas groupby/pivot으로 하는 것을 그대로 이관)
- `forecastMonthLongitudinal` — 조회일까지의 실측치 + 전년 동월 패턴으로 월말 사용량 예측
- `alertLevel` — 예측 사용량 기준 알림단계(정상/관심/주의/경고/긴급) 판정

`tests/golden/tariff-monitor.test.ts`가 위 함수들을 `golden/care-reference.json`의 Stage 2
섹션(요금 모니터링 228건 + 예측 7건 + `dynamic_tariff_analysis`의 17,088행 전체 재계산 대조)과
비교해 총 548건을 검증합니다.

**이관하지 않은 것**: `build_tariff_monitor`(원본 L800~833, 화면에 뿌리는 최종 테이블 조립 함수)는
"그룹"·패턴안정성점수·수요관리우선점수 컬럼이 Stage 3(군집분석 이관)의 산출물이라 아직 존재하지
않아 보류했습니다. Stage 3 완료 후 바로 이어서 포팅합니다. 또한 `daily`/`profiles`(각 52만·82만
행, 압축 안 하면 20MB 이상)는 아직 브라우저용 JSON으로 변환하지 않았습니다 — `forecastMonthLongitudinal`의
로직 자체는 이미 실제 고객 데이터로 검증됐지만, 이 큰 두 테이블을 어떻게 압축 인코딩할지는 별도
작업으로 남겨뒀습니다(고객ID·날짜를 반복 저장하지 않는 컬럼형 인코딩이 필요합니다).

### 로컬 검증

```bash
npm install
npm run test:golden   # billing(320건) + tariff-monitor(548건) 전부 일치해야 통과
npm run typecheck
```

`.github/workflows/golden.yml`이 `main` 브랜치에 push/PR 될 때마다 이 검증을 자동으로 돌립니다.

## 원본(`subscription-energy-optimizer`)과의 관계

**이 저장소의 `legacy/`는 원본의 사본이며, 원본 저장소는 그대로 둡니다.**

`subscription-energy-optimizer`는 현재 `care-jeju-v30.streamlit.app`의 실제 서비스 소스입니다.
Streamlit Community Cloud는 특정 저장소+브랜치+파일에 직접 연결되어 있어서, 그 파일을 지우거나
옮기면 재연결 설정을 하기 전까지 서비스가 즉시 멈춥니다.

그래서 "통째로 이동"을 원본을 지우는 방식으로 하지 않고, 계산 로직과 필요한 데이터만 복사해
이 저장소로 가져왔습니다. 이관(TS 포팅)이 끝나고 `site/`가 실제로 브라우저에서 계산하는
버전으로 교체되어 검증까지 마치면, 그 시점에 원한다면:

1. Streamlit Cloud 앱을 내리거나
2. `subscription-energy-optimizer` 저장소를 정리(archive/삭제)

하는 것을 GitHub·Streamlit Cloud 대시보드에서 직접 진행하시면 됩니다. 이 두 가지는 계정 설정
변경이라 제가 대신 실행할 수 없고, 안내는 언제든 도와드릴 수 있습니다.

## 다음 단계 (이관 5단계)

1. ~~요금·구독 계산 함수 → TypeScript 포팅~~ — **완료** (`lib/tariff.ts`, 320건 전부 일치)
2. ~~pandas 요금 모니터링 로직 → TypeScript 포팅~~ — **완료** (`lib/tariff-monitor.ts`, `lib/forecast.ts`, 548건 전부 일치). 단, `daily`/`profiles` 원본 CSV의 JSON 압축 인코딩과 `build_tariff_monitor`는 Stage 3 이후로 이월
3. 군집분석(k-means) → TypeScript 포팅 (`joint_dynamic_clusters`, `enrich_scores`) — 완료되면 위에서 미룬 `build_tariff_monitor`도 마저 포팅
4. 변압기·행동계획 최적화(OR-Tools) → 브라우저용 WASM MIP 솔버로 교체
5. 최종 UI 구현 (8개 탭, 18개 입력, 12개 차트)

지금은 Stage 0(골든값 캡처, ortools 포함 완료) + Stage 1(요금·구독 계산 이관) + Stage 2(요금
모니터링·사용량 예측 이관) 까지 완료된 상태입니다.
