# care — CARE(J-CARE) GitHub 기반 이관 작업 저장소

이 저장소는 현재 Streamlit Community Cloud(`care-jeju-v30.streamlit.app`)에서 서비스 중인
CARE 시뮬레이터를, PRAS-DER처럼 GitHub Pages 기반 정적 사이트로 이관하기 위한 작업 공간입니다.

## 폴더 구조

```
site/     실제로 GitHub Pages에 배포되는 내용
legacy/   원본 파이썬 소스 + 데이터 사본 (배포되지 않음, 골든값 캡처 전용)
golden/   원본 계산 결과를 고정한 기준값 (이관 검증용)
data/     legacy/를 한 번 계산해 브라우저용으로 내보낸 정적 JSON (scripts/export_data.py 산출물)
scripts/  legacy/ → data/ 변환 스크립트
lib/      TypeScript로 이관된 계산 로직 (Stage 1부터 여기에 쌓입니다)
tests/golden/  lib/*.ts 가 golden/care-reference.json 과 정확히 같은 값을 내는지 대조하는 테스트
design/   Stage 5 UI에 쓸 색상 팔레트 등 디자인 참고 문서
```

### site/ — 지금 당장 배포되는 것

Stage 5(최종 UI)까지 끝나서, 더 이상 `care-jeju-v30.streamlit.app`을 iframe으로 감싸지
않습니다. `site/`는 이제 그 자체로 완결된 정적 사이트이고, 브라우저에서 `lib/*.ts`(TS→JS로
컴파일된 것)를 직접 실행해 모든 계산을 수행합니다 — Streamlit 서버는 더 이상 필요 없습니다.
PRAS-DER처럼 프레임워크 없는 순수 TypeScript + 브라우저 네이티브 ES 모듈 + 손으로 짠 SVG
차트로 만들었습니다(자세한 구조는 아래 "Stage 5" 절 참고).

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

**당시 이관하지 않았던 것**: `build_tariff_monitor`(원본 L800~833, 화면에 뿌리는 최종 테이블 조립
함수)는 "그룹"·패턴안정성점수·수요관리우선점수 컬럼이 Stage 3(군집분석 이관)의 산출물이라 이
시점엔 아직 존재하지 않아 보류했었습니다 — Stage 3 완료 후 이관했고, 아래 별도 절에 정리했습니다.
또한 `daily`/`profiles`(각 52만·82만 행, 압축 안 하면 20MB 이상)는 아직 브라우저용 JSON으로
변환하지 않았습니다 — `forecastMonthLongitudinal`의 로직 자체는 이미 실제 고객 데이터로
검증됐지만, 이 큰 두 테이블을 어떻게 압축 인코딩할지는 별도 작업으로 남겨뒀습니다(고객ID·날짜를
반복 저장하지 않는 컬럼형 인코딩이 필요합니다).

### data/ + lib/enrich.ts — Stage 3: 군집분석 결과 반영 + 패턴안정성·수요관리우선점수 이관

`joint_dynamic_clusters`(kmeans 군집분석)는 TypeScript로 옮기지 않았습니다. 이 함수가 쓰는
`np.random.default_rng(42)`는 numpy의 PCG64 비트제너레이터인데, 이걸 JS에서 비트 단위로
그대로 재현하려면 PCG64 알고리즘 전체와 numpy 고유의 표본추출 방식까지 옮겨야 합니다. 그런데
712명의 원본 데이터는 바뀌지 않으니 군집 결과도 항상 같습니다 — 브라우저에서 매번 다시
클러스터링할 이유가 없다는 뜻이라, 대신 **`scripts/export_data.py`가 Python에서 한 번 계산해
`data/clusters.json`으로 내보내고**, 그 결과를 입력받는 `enrich_scores`만 TypeScript로 이관했습니다
(자세한 판단 근거는 `golden/golden_capture.py`의 `clustering_and_enrich_full` 주석 참고).

- `scripts/export_data.py`: `customers`/`monthly`/군집분석 결과를 브라우저용 정적 JSON으로 내보내는
  스크립트 (PRAS의 `scripts/extract-reference-data.py`와 같은 역할). 이번 업데이트에 이 스크립트가
  만든 `data/customers.json`(712명 전체 컬럼), `data/monthly.json`(17,088행), `data/clusters.json`
  (군집 배정·요약·전이표)도 함께 들어있습니다 — Stage 2에서 미뤄뒀던 "실제 배포용 JSON 데이터"가
  이제 마련된 것입니다.
- `lib/enrich.ts`의 `enrichScores`: `연간사용량증감률`·시간대별 비중 변화 등으로 **패턴안정성점수**를,
  2025년 최대시간사용량·최대부하비중·연간사용량·계절민감도·예측오차의 백분위 순위(`percentileRank`,
  pandas `rank(pct=True)`와 동일한 동률 평균 규칙)로 **수요관리우선점수**를, 군집 이동·요금제 변경
  여부로 **구조변화신호**(안정/사용량 급증/급감/그룹 이동/요금제 변경/동시변경)를 계산합니다.

`tests/golden/enrich.test.ts`가 `data/customers.json` + `data/clusters.json`을 실제 입력으로 넣어
`enrichScores`를 돌리고, 712명 전원의 패턴안정성점수·수요관리우선점수·구조변화신호를
`golden/care-reference.json`의 `clustering_and_enrich_full`(원본을 Python에서 그대로 돌린 712명
전체 결과)과 하나하나 대조합니다 — 총 4,275건.

### lib/tariff-monitor.ts (buildAnnualMonitor/buildMonthlyMonitor) — Stage 3 후속: build_tariff_monitor 이관

`build_tariff_monitor`(원본 L800~833)까지 마저 이관했습니다. 원본은 "연간 전체"/"월중
모니터링" 두 기간에 따라 완전히 다른 표를 만드는 하나의 함수였는데, TypeScript에서는
`buildAnnualMonitor`/`buildMonthlyMonitor` 두 함수로 나눴습니다 — 원본의 두 분기와
1:1 대응하고 계산 로직은 동일합니다.

- `buildAnnualMonitor`: `data/monthly.json` + `enrichScores` 결과만으로 계산 가능해,
  712명 전원 × 2024/2025 두 해를 전부 골든 대조합니다.
- `buildMonthlyMonitor`: 조회일까지의 실측 + `forecastMonthLongitudinal` 예측으로
  당월 요금·알림단계까지 계산합니다. 아래 `data/daily.json`이 나오면서 712명 전원 ×
  2개 요금제(기본형/프리미엄형)를 전부 골든 대조합니다.

`tests/golden/build-tariff-monitor.test.ts`가 위 두 함수를 대조해 총 2,854건을 검증합니다.

### data/daily.json · data/profiles.json · lib/timeseries.ts — daily/profiles 압축 인코딩

Stage 2·3에서 미뤄뒀던 `daily`(52만행)·`profiles`(82만행) 압축 인코딩을 마쳤습니다.
원본 두 테이블은 둘 다 빈 칸 없이 꽉 찬 격자입니다 — `daily`는 고객마다 정확히
2024-01-01~2025-12-31의 731일이 하루도 안 빠지고 있고, `profiles`는 고객마다 정확히
2개년×12개월×2일유형×24시간=1,152행이 있습니다(`scripts/export_data.py`에서 전수
검증). 그래서 "고객ID·날짜/연·월·일유형·시간"을 매 행 반복 저장하는 대신, 그 축을
한 번만 저장하고 고객별로는 그 축 순서에 맞춘 숫자 배열 하나만 저장했습니다 —
`data/profiles.json`은 이 인코딩만으로 12.5MB → 4.8MB, `data/daily.json`은 (원본
52만행을 naive하게 행 객체로 저장했다면 20MB를 넘었을 것을) 3.4MB로 나왔습니다.

- `daily`의 "일유형" 컬럼은 원본 52만행 전체에서 예외 없이 "주말" 한 값뿐이었습니다
  (데이터 자체의 특성이지 이관 중에 바꾼 값이 아닙니다 — `scripts/export_data.py`가
  이 사실을 매번 다시 검증하고, 만약 미래에 원본 데이터가 바뀌어 더 이상 상수가
  아니게 되면 export 스크립트가 assert로 실패하도록 해뒀습니다). 그래서 `data/daily.json`은
  이 값을 행마다 넣지 않고 `dayTypeConst`로 한 번만 싣고, `lib/timeseries.ts`의
  `decodeCustomerDaily`가 복원할 때 모든 행에 그대로 채워 넣습니다.
- `profiles`의 평균사용량_kWh는 pandas `mean()`이 만든 배정밀도 실수라, 그대로 실으면
  파일이 3배 가까이 커져서 소수 3자리(0.001kWh=1Wh 단위, 화면 표시엔 충분한 정밀도)로
  반올림해 저장했습니다.
- `lib/timeseries.ts`의 `profileForCustomer`/`aggregatePortfolioProfile`(원본 L296~307)도
  함께 이관했습니다 — 고객 상세 화면의 시간대별 부하곡선, 포트폴리오 곡선에 쓰입니다.

`tests/golden/timeseries.test.ts`가 (1) 디코더가 압축 인코딩을 원본과 정확히 같은 값으로
복원하는지, (2) `forecastMonthLongitudinal`이 이 디코더를 통해서도 Stage 2와 같은 결과를
내는지, (3) `profileForCustomer`/`aggregatePortfolioProfile`이 골든값과 일치하는지를
검증해 총 84건을 확인합니다(2·3번은 소수 3자리 반올림으로 인한 최대 0.0005 오차를
반올림 폭 안에서만 허용합니다 — 코드 주석 참고).

### lib/optimize.ts — Stage 4: 변압기·행동계획 최적화(OR-Tools CP-SAT) 이관

`optimize_transformer_profile`(원본 L310~366)·`optimize_actions`(원본 L836~866)를
이관했습니다. 둘 다 원본은 OR-Tools CP-SAT(정수계획법 솔버)를 쓰는데, ortools는
브라우저에서 돌릴 수 없어(WASM 포팅은 번들 크기·유지보수 부담이 커서 보류) 애초
로드맵의 "브라우저용 WASM MIP 솔버로 교체" 대신, **두 CP-SAT 모델을 수학적으로
분석해 정확한(근사가 아닌) 알고리즘으로 직접 치환**하는 쪽을 택했습니다 — 둘 다
변수 개수가 최대 24개(변압기)·10개(행동계획)뿐인 아주 작은 순수 선형 정수계획
문제라 이 방식이 가능했습니다. 판단 근거·검증 방법은 `lib/optimize.ts` 파일
상단과 각 함수 주석에 자세히 적었습니다. 요약하면:

- `optimizeTransformerProfile`: 시간대별 이동출·감축·이동입량을 정하는 문제로,
  과부하 제거가 목적함수에서 압도적 최우선(가중치 100,000)이라는 구조를 이용해
  "필요한 만큼만 이동출 우선, 부족분은 감축, 이동입 총량이 부족하면 감축으로
  전환"하는 그리디로 정확히 풀립니다.
- `optimizeActions`: "실행횟수" 정수변수로 목표 절감량을 채우는 유계 커버링
  문제로, 이진 분해 기반 0/1 배낭 DP로 정확히 풀립니다. CP-SAT이 목표를 채울 수
  없을 때(infeasible) 원본이 쓰는 "모든 대안을 최대치로 실행" 폴백도 그대로
  옮겼습니다.
- `controlledProfile`/`cumulativeProjection`(원본 L869~898, 위 최적화 결과를
  소비해 제어 후 프로필·누적 사용량 곡선을 만드는 함수)도 CP-SAT과 무관한 순수
  배열 연산이라 함께 이관해, 행동계획 최적화 기능 전체를 끝까지 완성했습니다.

두 CP-SAT 모델은 이 이관 작업 샌드박스에도 ortools를 설치할 수 없어(정책상 차단)
로컬에서는 실제 원본과 대조할 수 없었습니다 — 대신 scipy.optimize.milp(HiGHS
기반 MIP 솔버, 이 샌드박스엔 설치돼 있음)로 CP-SAT과 동일한 모델을 독립적으로
구성해 수백 회 무작위 대조했고, `tests/golden/optimize.test.ts`는 지금은
"골든값 없음(ortools 미설치) — 건너뜀"으로 표시되는 두 구간(실제 CP-SAT 대조)을
빼고도, 자체 결정론성·경계조건(제어 불필요/참여고객 없음/목표 달성 불가 폴백 등)
62건을 검증합니다. **GitHub Actions에서 "CARE 골든 기준값 캡처"를 다시 돌리면**
(ortools가 설치돼 있으므로) 두 함수의 실제 CP-SAT 대조까지 채워집니다 — 이번에는
`golden_capture.py` 자체는 바뀌지 않았지만, 이 두 함수의 golden 값이 이 저장소
역사상 처음으로 "unavailable"이 아닌 실제 값으로 채워지는 것이므로 반드시
한 번 다시 돌려주셔야 완전한 대조가 됩니다.

### site/src/ — Stage 5: 최종 UI (8개 탭)

`lib/*.ts`가 계산을, `site/src/*.ts`가 화면을 맡습니다. React/Vue 같은 프레임워크나 차트
라이브러리(Chart.js/Plotly 등)는 전혀 쓰지 않았습니다 — Next.js는 이 이관 샌드박스에
설치할 수 없었고, 배포된 정적 GitHub Pages 사이트는 CDN 스크립트를 쓸 수는 있었지만(이
샌드박스의 설치 제한과는 별개 문제) 배포본을 CDN 하나 없이 완전히 자기 완결적으로
유지하려고 일부러 쓰지 않았습니다. 대신 `tsc`로 컴파일한 순수 TS → 브라우저 네이티브
`<script type="module">`와, 이 파일 안에서 직접 그리는 SVG 차트 3종(라인·막대·히트맵)만
씁니다.

- **`site/src/main.ts`**: 앱 부트스트랩. 사이드바(공통 그룹 수 슬라이더 + 요금 가정 6개
  입력 + 부가요금·세금 4개 입력)와 상단 탭 8개를 구성하고, `data.ts`가 로드·계산한 상태를
  `AppContext`로 각 탭에 넘깁니다. 사이드바 값이 바뀌면 `enrichScores`/`dynamicTariffAnalysis`를
  다시 돌리고, 현재 활성 탭만 즉시 다시 그리며(비활성 탭은 dirty 표시만 해 뒀다가 다음에
  열릴 때 그리는 지연 재렌더) — Streamlit의 "위젯 바뀌면 전체 자동 재실행" 모델을
  React 없이 흉내 낸 것입니다.
- **`site/src/data.ts`**: `data/*.json` 정적 데이터를 fetch로 불러와 `lib/*.ts` 함수가 바로
  쓸 수 있는 타입으로 노출(`loadRawData`)하고, 사이드바 값이 바뀔 때마다 다시 계산해야 하는
  파생 상태(`computeDerivedState` — enrichScores/dynamicTariffAnalysis/daily 디코딩)를
  구성합니다.
- **`site/src/ui.ts`** / **`site/src/charts.ts`**: 8개 탭이 공통으로 쓰는 DOM 유틸(표·지표
  카드·필터 컨트롤·배지·경고박스·CSV 다운로드)과 SVG 차트 3종(라인/막대/히트맵 — 색상은
  `dataviz` 스킬의 기본 팔레트 slot 1~4를 `scripts/validate_palette.js`로 검증해 그대로
  사용, CARE 자체 5단계 경고색과는 분리해서 씀).
- **`site/src/tabs/tab1.ts` ~ `tab8.ts`**: 원본의 8개 탭(`T1`~`T8`, 원본 L1363~1852)을
  1:1로 옮겼습니다. 탭 자체는 계산을 하지 않고 전부 `lib/*.ts` 함수 호출 결과를 그릴
  뿐입니다. 각 탭 파일의 위젯(고객 선택, 연도/월/조회일, 계절/일유형, 필터 등)은 원본의
  Streamlit 세션 상태에 대응해 모듈 스코프 `let` 변수로 유지하고, 값이 바뀌면 그 탭
  함수를 다시 호출해 처음부터 다시 그리는 방식(멱등 전체 재렌더)으로 구현했습니다.

**원본과 다른 점(모두 의도적이고, 아래 세 가지뿐입니다):**

1. **탭6의 "100가구 무작위 추출"**: 원본은 `np.random.default_rng(seed)`(numpy PCG64)로
   712명 중 100명을 뽑는데, 이 비트제너레이터를 JS에서 그대로 재현할 수 없습니다(Stage 3의
   군집분석과 같은 이유). 이 브라우저 세션 안에서만 결정론적인 자체 seeded PRNG(mulberry32)로
   대체했고, 화면에도 "표본추출번호가 같아도 원본 파이썬과 100가구 구성이 100% 동일하지는
   않다"는 안내문을 넣었습니다.
2. **탭6의 ZIP 다운로드**: zip 라이브러리를 쓸 수 없어, "100가구 분석결과 ZIP" 버튼 하나
   대신 CSV 다운로드 버튼 2개(고객목록/변압기제어상세)로 나눴습니다 — 내용은 원본이 zip에
   담았을 두 CSV와 동일합니다.
3. **탭2/탭3의 "공통 그룹 수" 슬라이더**: 원본은 슬라이더를 움직일 때마다
   `joint_dynamic_clusters`를 다시 돌리는데, 이 역시 numpy RNG라 브라우저에서 재현할 수
   없습니다. 대신 `scripts/export_data.py`가 3~8 여섯 개 값 전부를 미리 Python에서 계산해
   `data/clusters-{3..7}.json` + `data/clusters.json`(k=8)로 내보냈고, 슬라이더는 그 중
   하나를 골라 보여주는 방식으로 실제로 동작합니다(고정값이 아닙니다).

이 세 가지 외에는 텍스트·수치·판정 로직 전부 원본과 동일합니다(계산은 이미 골든
테스트로 검증된 `lib/*.ts`를 그대로 호출하기 때문입니다).

**빌드**는 2단계입니다 — `lib/*.ts`의 기존 확장자 없는 상대 임포트(`from "./tariff"`)는
`tsx`로 테스트를 돌릴 땐 문제없지만, 브라우저 네이티브 ES 모듈은 상대 경로에 `.js` 확장자를
요구합니다. 그렇다고 이미 골든 검증까지 끝난 `lib/*.ts` 원본을 고치고 싶지는 않아서:

```bash
npm run build:site
# = tsc -p tsconfig.site.json          (lib/**/*.ts + site/src/**/*.ts → site/dist/, 임포트 문자열은 그대로 보존)
#   && python3 scripts/fix-esm-extensions.py   (컴파일된 .js 안의 확장자 없는 상대 import에만 .js를 붙임)
```

두 번째 단계는 컴파일된 **출력**(`site/dist/**/*.js`)만 고치고 `lib/*.ts` 소스 파일은
전혀 건드리지 않습니다. `site/src/*.ts`는 처음부터 명시적 `.js` 확장자로 작성해서
대부분의 파일에는 이 후처리가 사실 아무 일도 하지 않습니다(실측: `lib/tariff-monitor.js`
1개 파일만 실제로 고쳐졌습니다 — 나머지 lib 파일의 확장자 없는 임포트는 전부 타입 전용
`import type`이라 컴파일 시 아예 사라집니다).

로컬에서 헤드리스 Chromium(Playwright)으로 8개 탭 전부 클릭해 실데이터로 그려지는지,
콘솔 에러가 없는지 확인했습니다(유일한 콘솔 에러는 이 샌드박스의 네트워크 제한으로 인한
Pretendard 폰트 CDN 로드 실패뿐이며, 실제 GitHub Pages 배포 환경에서는 발생하지 않습니다).

**`.github/workflows/deploy-pages.yml`도 이번에 함께 고쳤습니다.** `site/dist/`는 빌드
산출물이라 저장소에 커밋하지 않는데(`.gitignore`에 추가), 예전 워크플로는 `site/` 폴더를
빌드 없이 그대로 GitHub Pages에 올리기만 했습니다 — 그대로 두면 배포된 사이트가
`site/dist/site/src/main.js`를 찾지 못해 빈 화면만 뜹니다. 그래서 배포 스텝 앞에
`npm install` + `npm run build:site`를 추가해, push될 때마다 항상 새로 빌드한 뒤 올리도록
바꿨습니다.

**실제 배포 후 발견된 버그 하나를 더 고쳤습니다**: `upload-pages-artifact`가 `path: ./site`로
`site/` 폴더 하나만 GitHub Pages에 올리는데, `data/`(customers.json 등 실제 데이터)는
저장소 루트에 있고 `site/` 안에는 없습니다. `site/src/data.ts`가 원래 `"../data"`(site/index.html
기준 한 단계 위)로 그 데이터를 가리켰는데, 로컬 샌드박스에서는 저장소 루트째로 서버를
띄워 테스트했기 때문에 이 문제를 못 잡았습니다 — 실제 GitHub Pages에는 `site/`만 올라가니
`../data`가 배포 루트보다 한 단계 더 위로 나가버려 `customers.json (404)`로 실패했습니다.
고친 내용:

- `site/src/data.ts`의 `DATA_BASE`를 `"../data"` → `"./data"`로 변경(site/ 안에서 찾도록).
- `deploy-pages.yml`에 `cp -r data site/data` 스텝을 빌드 다음·업로드 전에 추가해, 배포
  직전에 `data/`를 `site/data/`로 복사해 넣습니다(이 복사본은 커밋하지 않음 — `.gitignore`에
  `site/data/` 추가).
- 로컬에서도 실제 배포와 동일한 구조로 미리보기할 수 있게 `npm run preview:site`(빌드 +
  데이터 복사 + `site/`만 떼어 로컬 서버 실행)를 추가했습니다. 이번엔 실제로 `site/` 폴더
  **하나만** 떼어 로컬 서버로 띄워서(저장소 루트 전체가 아니라) GitHub Pages와 똑같은
  조건으로 재확인했고, 데이터 로드·8개 탭 전환 모두 정상 동작을 확인했습니다.

### 로컬 검증

```bash
npm install
npm run test:golden   # billing(320) + tariff-monitor(548) + enrich(4,275) + build-tariff-monitor(2,854) + timeseries(84) + optimize(62, 자체 검증) = 8,143건 전부 일치해야 통과
npm run typecheck     # lib/ + tests/golden/ (tsconfig.json)
npm run build:site    # site/ 전체 빌드 (tsconfig.site.json) — lib/ + site/src/ 전부 strict 타입체크 포함
npm run preview:site  # 빌드 + data/ → site/data/ 복사 + site/ 폴더만 localhost:8000 으로 서빙
                       # (GitHub Pages와 똑같이 site/ 하나만 떼어서 확인 — 브라우저로 http://localhost:8000 접속)
```

`.github/workflows/golden.yml`이 `main` 브랜치에 push/PR 될 때마다 `test:golden`을 자동으로 돌립니다.

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
2. ~~pandas 요금 모니터링 로직 → TypeScript 포팅~~ — **완료** (`lib/tariff-monitor.ts`, `lib/forecast.ts`, 548건 전부 일치)
3. ~~군집분석 결과 반영 + 패턴안정성·수요관리우선점수 → TypeScript 포팅~~ — **완료**
   (`data/*.json` 정적 데이터 + `lib/enrich.ts`, 4,275건 전부 일치). ~~`build_tariff_monitor`~~도
   이어서 **완료**(`buildAnnualMonitor`/`buildMonthlyMonitor`, 712명 전원 기준 2,854건 전부 일치).
   ~~`daily`/`profiles` JSON 압축 인코딩~~도 **완료**(`data/daily.json`·`data/profiles.json` +
   `lib/timeseries.ts`, 84건 전부 일치) — 이걸로 Stage 3에 딸린 후속 항목이 전부 끝났습니다.
4. ~~변압기·행동계획 최적화(OR-Tools) → 브라우저용 WASM MIP 솔버로 교체~~ — **완료**.
   다만 WASM 솔버를 들여오는 대신 두 CP-SAT 모델을 정확한 알고리즘으로 직접
   치환하는 쪽을 택했습니다(`lib/optimize.ts`, 판단 근거는 위 절 참고). 실제
   CP-SAT과의 최종 대조는 GitHub Actions에서 골든 캡처를 다시 돌려야 채워집니다.
5. ~~최종 UI 구현 (8개 탭, 18개 입력, 12개 차트)~~ — **완료** (`site/src/main.ts` +
   `site/src/tabs/tab1.ts`~`tab8.ts`, 프레임워크·차트 라이브러리 없는 순수 TS + SVG. 색상은
   `design/PALETTE.md` + `dataviz` 스킬 팔레트, 폰트·레이아웃 구조는 PRAS-DER과 동일)

**이관이 5단계 전부 끝났습니다.** Stage 0(골든값 캡처, ortools 포함) + Stage 1(요금·구독
계산 이관) + Stage 2(요금 모니터링·사용량 예측 이관) + Stage 3(군집·점수 이관 +
build_tariff_monitor + daily/profiles 압축 인코딩) + Stage 4(변압기·행동계획 최적화 이관,
`lib/optimize.ts`) + Stage 5(최종 UI, `site/`) 까지 전부 완료된 상태입니다. `site/`는 이제
Streamlit 서버 없이 그 자체로 완결된 정적 사이트입니다. 계산 검증 총계: 8,143건(그중 62건은
ortools 없이도 확인 가능한 자체 결정론성·경계조건 검증이고, 실제 CP-SAT 대조는 GitHub
Actions에서 골든 캡처를 다시 돌린 뒤 채워집니다 — 이미 한 번 돌려서 확인하셨다면 다시
돌릴 필요 없습니다). UI 쪽은 Stage 5 절에 적은 3가지 의도적 차이(100가구 무작위 추출의
PRNG, ZIP→CSV 2개, 그룹 수 슬라이더의 사전계산 6종)를 빼면 원본과 100% 동일합니다.
