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
출력: data/customers.json, data/monthly.json, data/clusters.json
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

print("완료.")
