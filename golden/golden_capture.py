# -*- coding: utf-8 -*-
"""
CARE-Jeju(streamlit_app_actual_tou_v30.py) 골든 기준값 캡처.

PRAS 저장소의 tests/golden/* 와 같은 목적: JS로 이관하기 전에
"원본 파이썬이 실제로 무엇을 반환하는가"를 고정해 이관 후 결과를
대조할 수 있게 한다.

방식: 원본 파일에서 st.set_page_config(...) 이전(=UI 렌더링 시작 전)까지만
잘라 exec 하여 함수·상수만 로드한다. Streamlit 앱을 실제로 띄우지 않고도
순수 계산 함수들을 그대로 가져다 쓸 수 있다. 원본 파일은 한 줄도 수정하지 않는다.

주의(중요): optimize_transformer_profile · optimize_actions 는 OR-Tools(ortools)가
필요하다. 이 스크립트를 돌리는 환경에 ortools 가 없으면 두 함수의 골든값은
"unavailable"로 표시되고 나머지는 정상 캡처된다. ortools 가 설치된 환경
(GitHub Actions 등)에서 다시 돌리면 전체가 채워진다.
"""
import json
import sys
import types
import traceback
from pathlib import Path

# ── 이 실행 환경에는 streamlit·plotly·ortools 를 설치할 수 없다(정책상 차단).
#    헤더(순수 계산 함수) 로드에 필요한 최소 표면만 스텁으로 제공한다.
#    실제 계산 로직은 건드리지 않는다 — import 만 통과시키는 목적.

def _install_stub_modules():
    st_mod = types.ModuleType("streamlit")
    st_mod.cache_data = lambda *a, **kw: (lambda fn: fn)  # 캐싱 없이 원본 함수 그대로 통과
    st_mod.column_config = types.SimpleNamespace(
        NumberColumn=lambda *a, **kw: None, TextColumn=lambda *a, **kw: None,
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

    ortools_mod = types.ModuleType("ortools")
    sat_mod = types.ModuleType("ortools.sat")
    sat_python_mod = types.ModuleType("ortools.sat.python")
    cp_model_mod = types.ModuleType("ortools.sat.python.cp_model")
    cp_model_mod.__is_stub__ = True  # 실제 최적화 함수가 이 값으로 스텁 여부를 판별한다
    sat_python_mod.cp_model = cp_model_mod
    sat_mod.python = sat_python_mod
    ortools_mod.sat = sat_mod
    sys.modules["ortools"] = ortools_mod
    sys.modules["ortools.sat"] = sat_mod
    sys.modules["ortools.sat.python"] = sat_python_mod
    sys.modules["ortools.sat.python.cp_model"] = cp_model_mod

try:
    import streamlit  # noqa: F401
    _HAS_REAL_STREAMLIT = True
except ImportError:
    _HAS_REAL_STREAMLIT = False

try:
    from ortools.sat.python import cp_model as _real_cp_model  # noqa: F401
    _HAS_REAL_ORTOOLS = True
except ImportError:
    _HAS_REAL_ORTOOLS = False

if not _HAS_REAL_STREAMLIT:
    _install_stub_modules()
elif not _HAS_REAL_ORTOOLS:
    # streamlit 은 있지만 ortools 만 없는 경우에도 cp_model 부분만 스텁 처리한다.
    import types as _types
    ortools_mod = _types.ModuleType("ortools")
    sat_mod = _types.ModuleType("ortools.sat")
    sat_python_mod = _types.ModuleType("ortools.sat.python")
    cp_model_mod = _types.ModuleType("ortools.sat.python.cp_model")
    cp_model_mod.__is_stub__ = True
    sat_python_mod.cp_model = cp_model_mod
    sat_mod.python = sat_python_mod
    ortools_mod.sat = sat_mod
    sys.modules["ortools"] = ortools_mod
    sys.modules["ortools.sat"] = sat_mod
    sys.modules["ortools.sat.python"] = sat_python_mod
    sys.modules["ortools.sat.python.cp_model"] = cp_model_mod

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "streamlit_app_actual_tou_v30.py")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "golden/care-reference.json")

text = SRC.read_text(encoding="utf-8")
cutoff = text.index("st.set_page_config")
line_start = text.rfind("\n", 0, cutoff) + 1
header_src = text[:line_start]

ns = {"__name__": "care_headless", "__file__": str(SRC)}
exec(compile(header_src, str(SRC) + " (header only, no UI)", "exec"), ns)

def call(fn_name, *args, **kwargs):
    fn = ns[fn_name]
    return fn(*args, **kwargs)

results = {"_meta": {"source_file": SRC.name, "app_version": ns.get("APP_VERSION")}}
errors = {}

def capture(key, fn):
    try:
        results[key] = fn()
    except Exception as e:
        errors[key] = f"{type(e).__name__}: {e}\n" + traceback.format_exc(limit=3)

# ── 1. 요금 계산 (순수 함수, 데이터 불필요) ─────────────────────────
def billing_cases():
    out = []
    kwh_points = [50, 120, 199, 200, 201, 300, 399, 400, 401, 800, 999, 1000, 1001, 1500]
    months = [1, 4, 6, 7, 8, 10, 12]  # 계절 경계 포함
    for m in months:
        for k in kwh_points:
            out.append({
                "month": m, "kwh": k,
                "residential_won": call("residential_bill", float(k), m),
                "tou_won_default_share": call("tou_bill", float(k), m, 0.35, 0.35, 0.30),
            })
    return out

def subscription_cases():
    # 사이드바 기본값(overage=300원/kWh, index=1 of [200,300,307.3,400])과
    # 상한·경계값을 함께 검사한다.
    out = []
    for overage_rate in [200, 300, 307.3, 400]:
        for plan_name, plan in ns["PLAN_DEFAULTS"].items():
            for over in [0, 1, 50, 200, 600]:
                usage = plan["included"] + over
                out.append({
                    "plan": plan_name, "overage_rate": overage_rate,
                    "usage_kwh": usage,
                    "bill_won": call("subscription_bill", usage, plan["fee"], plan["included"], overage_rate),
                })
    return out

capture("billing_cases", billing_cases)
capture("subscription_cases", subscription_cases)

def inverse_subscription_cases():
    out = []
    for overage_rate in [200, 300, 400]:
        for plan_name, plan in ns["PLAN_DEFAULTS"].items():
            for target in [plan["fee"] - 1000, plan["fee"], plan["fee"] + 5000, plan["fee"] + 50000]:
                out.append({
                    "plan": plan_name, "overage_rate": overage_rate, "target_bill": target,
                    "max_kwh": call("inverse_subscription_bill", target, plan["fee"], plan["included"], overage_rate),
                })
    return out

capture("inverse_subscription_cases", inverse_subscription_cases)

def component_breakdown_cases():
    out = []
    for kwh, month in [(250.0, 1), (550.0, 7), (1200.0, 8)]:
        base_fee, energy_charge, _ = call("residential_base_energy", kwh, month)
        out.append({
            "kwh": kwh, "month": month,
            "breakdown": call("bill_component_breakdown", base_fee, energy_charge, kwh),
        })
    return out

capture("residential_component_breakdown", component_breakdown_cases)

def rounding_cases():
    vals = [0.5, 1.5, 2.5, 10.4, 10.5, 10.6, -0.5, 123.456, 9999.999]
    return {
        "round_half_up": {str(v): call("round_half_up", v) for v in vals},
        "truncate_won": {str(v): call("truncate_won", v) for v in vals},
        "truncate_10won": {str(v): call("truncate_10won", v) for v in vals},
        "billed_kwh": {str(v): call("billed_kwh", v) for v in [0.0, 0.4, 0.5, 0.6, 199.9, 200.0]},
    }

capture("rounding_cases", rounding_cases)

# ── 2. 데이터 로드 + 군집분석 (pandas/numpy, ortools 불필요) ────────
def data_and_clusters():
    # joint_dynamic_clusters 는 (stacked, summary, wide, transition) 튜플을 돌려준다.
    # enrich_scores 의 두 번째 인자는 이 중 "wide"(고객ID · 2024/2025군집 · 군집유지여부).
    data = call("load_data")
    customers = data["customers"]
    n_clusters = 8
    stacked, summary, wide, transition = call("joint_dynamic_clusters", customers, n_clusters)
    enriched = call("enrich_scores", customers, wide)

    # 군집 이름 부여는 kmeans_numpy 의 seed=42 에 전적으로 좌우되는 결정론적 결과다.
    # JS 이관본이 반드시 정확히 재현해야 하는 핵심 골든값.
    cluster_counts = (
        summary.groupby(["연도", "군집"], as_index=False)["고객수"].sum()
        .sort_values(["연도", "군집"]).to_dict("records")
    )
    return {
        "customers_row_count": int(len(customers)),
        "customers_columns": sorted(customers.columns.tolist()),
        "cluster_names_used": sorted(summary["군집"].unique().tolist()),
        "cluster_counts_by_year": cluster_counts,
        "wide_columns": wide.columns.tolist(),
        "wide_sample_first5": wide.head(5).to_dict("records"),
        "transition_row_count": int(len(transition)),
        "enriched_sample_first5_customer_ids": enriched["고객ID"].astype(str).tolist()[:5],
        "enriched_columns_added": sorted(set(enriched.columns) - set(customers.columns)),
        "enriched_구조변화신호_counts": enriched["구조변화신호"].value_counts().to_dict(),
        "enriched_패턴안정성점수_first5": enriched["패턴안정성점수"].head(5).round(4).tolist(),
        "enriched_수요관리우선점수_first5": enriched["수요관리우선점수"].head(5).round(4).tolist(),
    }

capture("data_and_clusters", data_and_clusters)

# ── 3. 최적화 (ortools 필요 — 없으면 unavailable로 표시) ────────────
def transformer_optimization_cases():
    import numpy as np
    from ortools.sat.python import cp_model
    if getattr(cp_model, "__is_stub__", False):
        return {"_status": "unavailable: ortools not installed in this environment (stub active)"}
    cases = []
    profiles = {
        "flat_no_overload": [10.0] * 24,
        "evening_peak_overload": [8, 7, 6, 5, 5, 5, 6, 8, 9, 9, 9, 9, 9, 9, 9, 10, 18, 22, 24, 23, 20, 15, 11, 9],
    }
    for name, base in profiles.items():
        for limit_ratio in [0.8, 1.0]:
            for participation in [0.5, 1.0]:
                r = call("optimize_transformer_profile", np.array(base), limit_ratio, participation)
                cases.append({
                    "profile": name, "limit_ratio": limit_ratio, "participation": participation,
                    "peak_before": r["peak_before"], "peak_after": r["peak_after"],
                    "shifted": r["shifted"], "reduced": r["reduced"],
                    "overload_before": r["overload_before"], "overload_after": r["overload_after"],
                    "status": r["status"],
                })
    return cases

capture("transformer_optimization_cases", transformer_optimization_cases)

def action_optimization_cases():
    from ortools.sat.python import cp_model
    if getattr(cp_model, "__is_stub__", False):
        return {"_status": "unavailable: ortools not installed in this environment (stub active)"}
    cases = []
    for required_kwh in [50, 150, 400]:
        for mode in ns["CONTROL_MODES"].keys():
            df, gross, effective = call(
                "optimize_actions", float(required_kwh), 15, "여름",
                ["에어컨", "세탁기", "건조기"], mode, False,
            )
            cases.append({
                "required_kwh": required_kwh, "mode": mode,
                "gross": gross, "effective": effective,
                "row_count": int(len(df)),
            })
    return cases

capture("action_optimization_cases", action_optimization_cases)

results["_errors"] = errors
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(results, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
print(f"기록: {OUT} ({OUT.stat().st_size} bytes)")
print(f"오류 {len(errors)}건: {list(errors.keys())}")
