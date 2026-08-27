# CARE 색상 팔레트 — 따뜻한 노랑·주황 톤

Stage 5(최종 UI 구현)에서 쓸 색상 토큰입니다. PRAS-DER의 `app/globals.css`와
**폰트·레이아웃 클래스 구조(`.page-shell`, `.hero`, `.section-card`, `.metric-grid`,
`.landing-grid`/`.landing-card`, `.site-nav`)는 완전히 동일하게 유지**하고, `:root`
색상 토큰 값만 이 문서의 값으로 교체하면 됩니다.

미리보기: 아래 값을 실제 컴포넌트(nav/hero/지표카드/알림배지/카드/버튼)에 입혀본
시안을 Artifact로 확인할 수 있습니다 — 대화 중 공유된 "CARE 색상 팔레트" 링크 참고.

## 왜 이 톤인가

PRAS-DER은 발전소·계통 시뮬레이터라 navy/blue 계열(신뢰감·기술적 정밀함)을 씁니다.
CARE는 "care"(돌봄)라는 이름처럼 일반 가정의 전기요금을 함께 들여다보고 절약을
안내하는 서비스라, 요청하신 대로 **노랑·주황 중심의 따뜻한 톤**으로 차별화했습니다.
동시에 CARE가 이미 가진 "알림단계"(정상/관심/주의/경고/긴급) 5단계 경보 기능이
이 팔레트 자체의 그러데이션(초록→금색→주황→진한주황→빨강)과 자연스럽게 이어지도록
설계했습니다 — 별도의 임의 경보색을 새로 정하지 않고 브랜드 톤을 그대로 확장한 것입니다.

## 폰트

PRAS-DER과 동일하게 **Pretendard**(jsdelivr CDN)를 그대로 씁니다. 폰트는 이번 변경의
대상이 아닙니다. (참고: Artifact 미리보기 페이지만 CSP 제약으로 Google Fonts의
"Noto Sans KR"을 대신 썼습니다 — 실제 배포 사이트는 이 제약이 없으므로 PRAS와
완전히 동일하게 Pretendard를 씁니다.)

## 색상 토큰

`app/globals.css`의 `:root`에 PRAS의 토큰 대신 아래 값을 넣습니다.

```css
:root {
  /* 브랜드 · 배경 */
  --brand: #d9670f;       /* 주요 액션·강조 (PRAS의 --blue 대응) */
  --brand-dark: #a8460f;  /* hover·짙은 강조 (PRAS의 --navy 대응) */
  --brand-soft: #fdecd3;  /* 강조 카드 배경 (PRAS의 --blue-soft 대응) */
  --brand-line: #f3cfa0;  /* 강조 카드 테두리 */
  --gold: #eab308;        /* 포인트 강조색(로고 배지, 관심 단계) */
  --gold-soft: #fdf1c8;

  /* 텍스트 · 테두리 · 짙은 배경 */
  --ink: #2b1c10;         /* 본문 텍스트 (PRAS의 --ink 대응) */
  --ink-soft: #6b5a48;    /* 보조 텍스트 */
  --line: #ecdfc7;        /* 테두리 (PRAS의 --line 대응) */
  --surface: #fffaf2;     /* 카드 배경 (PRAS의 --surface 대응) */
  --canvas: #faf3e7;      /* 페이지 배경 (PRAS의 --canvas 대응) */
  --nav-dark: #33190c;    /* 상단 nav · footer 배경 (PRAS의 #081a2f 대응) */

  /* 의미색 — 알림단계 5단계 (정상 → 긴급 순서 그대로 브랜드 톤 확장) */
  --green: #3f7d20;       /* 정상 */
  --green-soft: #e9f3dd;
  /* 관심 = --gold, 주의 = --brand, 경고 = --brand-dark (위에서 이미 정의) */
  --red: #c0392b;         /* 긴급 */
  --red-soft: #fbe6e2;
}
```

## 알림단계 매핑

| 단계 | 색 토큰 | 배경(soft) |
|---|---|---|
| 정상 | `--green` | `--green-soft` |
| 관심 | `--gold` | `--gold-soft` |
| 주의 | `--brand` | `--brand-soft` |
| 경고 | `--brand-dark` | `#fbe3c8` |
| 긴급 | `--red` | `--red-soft` |

## 레이아웃 · 구조

`.page-shell`, `.hero`(radial + 118deg 3-stop 그라디언트, 각도·정지점 동일, 색상값만
`#5c2a0a → #a8460f → #dd7a1f`로 교체), `.section-card`, `.metric-grid`, `.landing-grid`/
`.landing-card`, `.site-nav` — 클래스명·구조·spacing·radius 모두 PRAS-DER과 동일하게
유지합니다. 바뀌는 것은 오직 `:root`의 색상 값뿐입니다.
