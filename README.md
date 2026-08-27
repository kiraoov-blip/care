# care — CARE(J-CARE) GitHub 기반 이관 작업 저장소

이 저장소는 현재 Streamlit Community Cloud(`care-jeju-v30.streamlit.app`)에서 서비스 중인
CARE 시뮬레이터를, PRAS-DER처럼 GitHub Pages 기반 정적 사이트로 이관하기 위한 작업 공간입니다.

## 폴더 구조

```
site/     실제로 GitHub Pages에 배포되는 내용
legacy/   원본 파이썬 소스 + 데이터 사본 (배포되지 않음, 골든값 캡처 전용)
golden/   원본 계산 결과를 고정한 기준값 (이관 검증용)
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
- `care-reference.json`: 그 결과. **지금 들어있는 파일은 ortools(변압기·행동계획 최적화 2개
  함수)가 빠진 버전**입니다 — 개발 샌드박스에서는 정책상 ortools를 설치할 수 없어서입니다.
  `.github/workflows/care-golden-capture.yml`을 이 저장소에서 한 번 수동 실행(Actions 탭 →
  "CARE 골든 기준값 캡처" → Run workflow)하면, GitHub Actions 러너에는 제약이 없으므로
  `requirements.txt`를 그대로 설치해 최적화 2개 함수까지 포함한 완전한 기준값을 다시 캡처해서
  자동으로 커밋합니다.

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

1. 요금·구독 계산 함수 → TypeScript 포팅 (golden 기준값과 대조)
2. pandas 데이터 파이프라인 → 미리 계산된 JSON으로 변환
3. 군집분석(k-means) → TypeScript 포팅
4. 변압기·행동계획 최적화(OR-Tools) → 브라우저용 WASM MIP 솔버로 교체
5. 최종 UI 구현 (8개 탭, 18개 입력, 12개 차트)

지금은 Stage 0(골든값 캡처, ortools 제외)까지 완료된 상태입니다.
