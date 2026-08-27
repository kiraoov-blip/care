# -*- coding: utf-8 -*-
"""
legacy/streamlit_app_actual_tou_v30.py 의 데이터 파이프라인을 한 번 실행해서
브라우저(TypeScript)가 그대로 fetch 해 쓸 수 있는 정적 JSON으로 내보낸다.

PRAS-DER 저장소의 scripts/extract-reference-data.py 와 같은 역할이다.

군집분석(joint_dynamic_clusters → kmeans_numpy)은 여기서 "한 번" 계산해서
data/clusters.json 에 결과만 저장한다. 원본 712명의 과거 데이터는 바뀌지
않으므로 이 결과도 항상 같다 — 매번 브라우저에서 다시 클러스터링을 돌릴
필요가 없고, 그러려면 numpy PCG64 비트제너레이터(np.random.default_rng)를
JS에서 비트 단위로 재현해야 하는데 그건 이 상황에서 리스크만 크고 얻는
것은 없다(golden/golden_capture.py 의 주석 참고).

실행: python scripts/export_data.py
출력: data/customers.json, data/monthly.json, data/clusters.json,
      data/daily.json, data/profiles.json, data/overall-profiles.json

daily/profiles 압축 인코딩(이번 업데이트에서 추가):
  원본 "daily"(52만행)와 "profiles"(82만행)는 둘 다 빈 칸 없이 꽉 찬 격자다 —
  daily는 고객마다 정확히 2024-01-01~2025-12-31의 731일이 하루도 안 빠지고 있고,
  profiles는 고객마다 정확히 2개년×12개월×2일유형×24시간=1,152행이 있다. 그래서
  "고객ID·날짜·시간"을 매 행마다 반복 저장하는 대신, 그 축(날짜/연·월·일유형·시간)을
  한 번만 저장하고 고객별로는 그 축 순서에 맞춰 정렬된 숫자 배열 하나만 저장한다
  (날짜·시간 값 자체를 지우는 게 아니라, 행마다 반복 안 하고 한 번만 적는다는 뜻).

  daily의 "일유형" 컬럼은 원본 전체 52만행에서 예외 없이 "주말" 한 값뿐이었다
  (직접 확인: daily.groupby("고객ID")["일유형"].apply(lambda s:(s=="주말").mean())의
  모든 고객이 1.0). 원본 데이터 자체의 특성이라 그대로 반영해 "dayTypeConst"로
  한 번만 적는다 — 이관 과정에서 임의로 바꾼 값이 아니다.
"""
import json
import sys
import types
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SRC = BASE_DIR / "legacy" / "streamlit_app_actual_tou_v30.py"
OUT_DIR = BASE_DIR / "data"


def _install_stub_modules_if_needed():
    try:
        import streamlit  # noqa: F401
        has_streamlit = True
    except ImportError:
        has_streamlit = False
    try:
        from ortools.sat.python import cp_model  # noqa: F401
        has_ortools = True
    except ImportError:
        has_ortools = False

    if not has_streamlit:
        st_mod = types.ModuleType("streamlit")
        st_mod.cache_data = lambda *a, **kw: (lambda fn: fn)
        st_mod.column_config = types.SimpleNamespace(
            NumberColumn=lambda *a, **kw: None, TextColumn=lambda *a, **kw: None
        )
        st_mod.markdown = lambda *a, **kw: None
        sys.modules["streamlit"] = st_mod

        plotly_mod = types.ModuleType("plotly")
        px_mod = types.ModuleType("plotly.express")
        go_mod = types.ModuleType("plotly.graph_objects")
        plotly_mod.express = px_mod
        plotly_mod.graph_objects = go_mod
        sys.modules["plotly"] = plotly_mod
        sys.modules["plotly.express"] = px_mod
        sys.modules["plotly.graph_objects"] = go_mod

    if not has_ortools:
        ortools_mod = types.ModuleType("ortools")
        sat_mod = types.ModuleType("ortools.sat")
        sat_python_mod = types.ModuleType("ortools.sat.python")
        cp_model_mod = types.ModuleType("ortools.sat.python.cp_model")
        sat_python_mod.cp_model = cp_model_mod
        sat_mod.python = sat_python_mod
        ortools_mod.sat = sat_mod
        sys.modules["ortools"] = ortools_mod
        sys.modules["ortools.sat"] = sat_mod
        sys.modules["ortools.sat.python"] = sat_python_mod
        sys.modules["ortools.sat.python.cp_model"] = cp_model_mod


_install_stub_modules_if_needed()

text = SRC.read_text(encoding="utf-8")
cutoff = text.index("st.set_page_config")
line_start = text.rfind("\n", 0, cutoff) + 1
header_src = text[:line_start]
ns = {"__name__": "care_export", "__file__": str(SRC)}
exec(compile(header_src, str(SRC) + " (header only, no UI)", "exec"), ns)


def call(fn_name, *args, **kwargs):
    return ns[fn_name](*args, **kwargs)


OUT_DIR.mkdir(parents=True, exist_ok=True)


def write_json(name, obj):
    path = OUT_DIR / name
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":"), default=str), encoding="utf-8")
    print(f"{path.relative_to(BASE_DIR)}: {path.stat().st_size:,} bytes")


data = call("load_data")
customers = data["customers"]
monthly = data["monthly"]

# ── customers.json: 원본 712명 전체 컬럼 (군집분석 이전의 정적 데이터) ──
write_json("customers.json", customers.to_dict("records"))

# ── monthly.json: 고객×연도×월 사용량 (17,088행) ──
write_json(
    "monthly.json",
    monthly[
        ["고객ID", "연도", "월", "사용량_kWh", "경부하_kWh", "중간부하_kWh", "최대부하_kWh",
         "경부하비중", "중간부하비중", "최대부하비중"]
    ].to_dict("records"),
)

# ── clusters.json: kmeans 군집분석 결과 (여기서 한 번만 계산) ──
stacked, summary, wide, transition = call("joint_dynamic_clusters", customers, 8)
write_json(
    "clusters.json",
    {
        "wide": wide.to_dict("records"),
        "summary": summary.round(6).to_dict("records"),
        "transition": transition.round(6).to_dict("records"),
    },
)

# ── daily.json: 고객×일별 사용량 (52만행 → 날짜축 1번 + 고객당 숫자배열 712개) ──
daily = data["daily"]
dates = sorted(daily["날짜"].dt.strftime("%Y-%m-%d").unique().tolist())
assert len(dates) == 731, f"날짜 개수가 예상(731)과 다름: {len(dates)}"

daytypes_seen = sorted(daily["일유형"].unique().tolist())
assert daytypes_seen == ["주말"], (
    f"daily의 일유형이 더 이상 상수가 아님({daytypes_seen}) — "
    "export_data.py의 dayTypeConst 가정이 깨졌으니 이 스크립트를 고쳐야 함"
)

daily_customers = {}
for cid, g in daily.groupby("고객ID", sort=False):
    g2 = g.sort_values("날짜")
    got_dates = g2["날짜"].dt.strftime("%Y-%m-%d").tolist()
    assert got_dates == dates, f"{cid}의 날짜 순서/구성이 공통 축과 다름"
    daily_customers[str(cid)] = g2["일사용량_kWh"].tolist()

write_json("daily.json", {"dates": dates, "dayTypeConst": "주말", "customers": daily_customers})

# ── profiles.json: 고객×연도×월×일유형×시간 평균사용량 (82만행 → 축 1번 + 고객당 1,152길이 배열) ──
profiles = data["profiles"]
P_YEARS = [2024, 2025]
P_MONTHS = list(range(1, 13))
P_DAYTYPES = ["주중", "주말"]
P_HOURS = list(range(1, 25))

idx_of = {}
_i = 0
for _y in P_YEARS:
    for _m in P_MONTHS:
        for _dt in P_DAYTYPES:
            for _h in P_HOURS:
                idx_of[(_y, _m, _dt, _h)] = _i
                _i += 1
assert _i == 1152

profiles_customers = {}
for cid, g in profiles.groupby("고객ID", sort=False):
    arr = [0.0] * 1152
    filled = 0
    for row in g.itertuples(index=False):
        key = (int(row.연도), int(row.월), row.일유형, int(row.시간))
        # daily.json의 일사용량_kWh는 원본 자체가 이미 소수 3자리라 그대로 실었지만,
        # profiles의 평균사용량_kWh는 pandas mean()이 만든 배정밀도 실수라 소수점 아래
        # 15~16자리까지 그대로 직렬화되면 용량만 늘어나고(파일이 3배 이상 커짐) 화면
        # 표시에는 아무 의미가 없다. daily와 같은 소수 3자리(0.001kWh=1Wh 단위)로 반올림한다
        # — golden/golden_capture.py의 timeseries_integrity_cases도 같은 반올림을 적용해
        # "반올림 전/후가 같은 값"이 아니라 "같은 규칙으로 반올림한 값"으로 정확히 대조한다.
        arr[idx_of[key]] = round(float(row.평균사용량_kWh), 3)
        filled += 1
    assert filled == 1152, f"{cid}의 profiles 행이 1,152개가 아님({filled})"
    profiles_customers[str(cid)] = arr

write_json(
    "profiles.json",
    {"years": P_YEARS, "months": P_MONTHS, "dayTypes": P_DAYTYPES, "hours": P_HOURS, "customers": profiles_customers},
)

# ── overall-profiles.json: 연도×계절×일유형×시간 전체 평균 (288행, 압축 없이 그대로) ──
overall_profiles = data["overall_profiles"]
write_json("overall-profiles.json", overall_profiles.to_dict("records"))

print("완료.")
