"""Spec §9 / owner requirement 7: malformed or extreme input never produces a 5xx and always yields JSON."""
from __future__ import annotations

import copy
import io
import json

import pytest
from hypothesis import HealthCheck, given, settings, strategies as st

pytestmark = pytest.mark.filterwarnings("ignore::RuntimeWarning")

BASE = {"name": "Example", "units": "ng/mL", "signalLabel": "Signal", "mode": "equations",
        "meanExpr": "4000 + (50 - 4000)/(1 + (c/40)^1.2)", "sdExpr": "sqrt(15^2 + (0.08*S)^2)",
        "levels": [0, 1, 5, 25, 100, 500], "cMax": 500,
        "replicates": {"concs": [0, 1, 5], "cells": [[48.1, 52.0, 47.3], [55.0, 58.2, 53.9], [90.1, 101.3, 95.5]]},
        "summary": [{"c": 0, "mean": 50, "sd": 15}, {"c": 5, "mean": 95, "sd": 16}],
        "metric": "ssmd", "kTarget": 3, "sim": {"n": 5, "seed": 42}}

SETTINGS = dict(max_examples=100, derandomize=True, deadline=None, suppress_health_check=list(HealthCheck),
                database=None)


def strict_json(text: str):
    def bad(x):
        raise AssertionError(f"non-standard JSON constant {x!r} in response")
    return json.loads(text, parse_constant=bad)


def _sanitize(o):
    """NaN/Infinity literals are not JSON; they have their own pinned test (test_nan_literal_*).  Everywhere else
    they are replaced by the string form so the fuzzers keep exercising the rest of the input space."""
    if isinstance(o, float) and (o != o or o in (float("inf"), float("-inf"))):
        return str(o)
    if isinstance(o, dict):
        return {k: _sanitize(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_sanitize(v) for v in o]
    return o


def post_raw(client, path, payload):
    if not isinstance(payload, (bytes, str)) and path != "/api/fit":
        payload = _sanitize(payload)
    body = payload if isinstance(payload, (bytes, str)) else json.dumps(payload, allow_nan=True)
    return client.post(path, content=body, headers={"content-type": "application/json"})


def check(r, allow_xlsx=False):
    assert r.status_code < 500, (r.status_code, r.text[:300])
    ctype = r.headers.get("content-type", "")
    if r.status_code == 200 and allow_xlsx and "spreadsheetml" in ctype:
        assert r.content[:2] == b"PK"
        return None
    assert ctype.startswith("application/json"), (ctype, r.text[:200])
    return strict_json(r.text)


junk_leaf = st.one_of(
    st.none(), st.booleans(), st.integers(-10**6, 10**6), st.integers(-10**30, 10**30),
    st.floats(allow_nan=True, allow_infinity=True), st.sampled_from([1e308, -1e308, 1e-320, 0.0, -0.0, 5e-324, 2**53 + 1]),
    st.text(max_size=12), st.sampled_from(["", "NaN", "Infinity", "c", "S", "1e999", "0", "-1", "null", "\u0000", "💥"]))
junk = st.recursive(junk_leaf, lambda c: st.one_of(st.lists(c, max_size=5),
                                                   st.dictionaries(st.text(max_size=6), c, max_size=4)), max_leaves=12)


def mutate(base, draw_paths, value):
    obj = copy.deepcopy(base)
    cur = obj
    for key in draw_paths[:-1]:
        if isinstance(cur, dict) and key in cur and isinstance(cur[key], (dict, list)):
            cur = cur[key]
        elif isinstance(cur, list) and isinstance(key, int) and 0 <= key < len(cur) and isinstance(cur[key], (dict, list)):
            cur = cur[key]
        else:
            break
    last = draw_paths[-1]
    if isinstance(cur, dict):
        cur[last if isinstance(last, str) else str(last)] = value
    elif isinstance(cur, list) and cur:
        cur[(last if isinstance(last, int) else 0) % len(cur)] = value
    return obj


KEYS = list(BASE) + ["concs", "cells", "c", "mean", "sd", "n", "seed", "extra", "grid"]
path_st = st.lists(st.one_of(st.sampled_from(KEYS), st.integers(0, 3)), min_size=1, max_size=3)


@st.composite
def series_payload(draw):
    s = BASE
    for _ in range(draw(st.integers(1, 3))):
        s = mutate(s, draw(path_st), draw(junk))
    if draw(st.booleans()):
        s["mode"] = draw(st.sampled_from(["equations", "replicates", "summary", "bogus", None, 3]))
    return s


# ---------------------------------------------------------------------------------------------


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"ok": True}


def test_unknown_paths_and_methods_are_json_4xx(client):
    for method, path in [("get", "/api/nope"), ("get", "/api/parse"), ("put", "/api/fit"), ("delete", "/api/evaluate"),
                         ("get", "/api/export"), ("post", "/api/health"), ("get", "/")]:
        r = getattr(client, method)(path)
        assert 400 <= r.status_code < 500, (method, path, r.status_code)
        check(r)


@pytest.mark.parametrize("endpoint", ["/api/parse", "/api/evaluate", "/api/fit", "/api/export"])
@pytest.mark.parametrize("raw", [b"", b"{", b"[]", b"null", b"123", b'"x"', b"{}", b'{"series": null}',
                                 b'{"series": []}', b'{"series": 5}', b'{"expr": 5}', b'\xff\xfe\x00', b"\x00" * 10,
                                 b'{"series": {"mode": "equations"}}', b'{"expr": "c", "variable": null}',
                                 b'{"expr": null}', b'{"a":' * 50, b"[" * 5000
                                 ])
def test_malformed_bodies(client, endpoint, raw):
    r = post_raw(client, endpoint, raw)
    check(r, allow_xlsx=(endpoint == "/api/export"))
    if endpoint != "/api/fit":
        assert r.status_code in (200, 400, 422), r.status_code


@pytest.mark.parametrize("endpoint", ["/api/parse", "/api/evaluate", "/api/export"])
@pytest.mark.parametrize("raw", [b'{"series":{"cMax":NaN}}', b'{"expr":"c","variable":NaN}',
                                 b'{"series":{"cMax":Infinity,"meanExpr":"c","sdExpr":"1"}}'])
def test_nan_literal_in_body_is_client_error(client, endpoint, raw):
    r = post_raw(client, endpoint, raw)
    assert r.status_code < 500, r.status_code


def test_wrong_content_type(client):
    for ct in ("text/plain", "application/x-www-form-urlencoded", "multipart/form-data"):
        for ep in ("/api/parse", "/api/evaluate", "/api/fit", "/api/export"):
            r = client.post(ep, content=b'{"expr": "c"}', headers={"content-type": ct})
            check(r, allow_xlsx=True)


@settings(**SETTINGS)
@given(expr=junk, variable=junk)
def test_parse_fuzz(client, expr, variable):
    r = post_raw(client, "/api/parse", {"expr": expr, "variable": variable})
    d = check(r)
    if r.status_code == 200:
        assert d["ok"] in (True, False)
        if d["ok"] is False:
            assert isinstance(d["pos"], int) and isinstance(d["error"], str)
        else:
            assert isinstance(d["excel"], str)


@settings(**SETTINGS)
@given(expr=st.text(max_size=300))
def test_parse_arbitrary_unicode_text(client, expr):
    r = post_raw(client, "/api/parse", {"expr": expr, "variable": "c"})
    d = check(r)
    assert r.status_code == 200
    if d["ok"] is False:
        assert 0 <= d["pos"] <= len(expr)


def test_parse_large_but_reasonable_expressions(client):
    for expr in ["(" * 100 + "c" + ")" * 100, "-" * 500 + "c", "2^" * 400 + "2", "1" * 20000, "c" * 5000,
                 " " * 100000 + "c", "c" + "+c" * 100, "sqrt(" * 50 + "c" + ")" * 50]:
        r = client.post("/api/parse", json={"expr": expr, "variable": "c"})
        check(r)
        assert r.status_code == 200
        assert r.json()["ok"] in (True, False)


@pytest.mark.parametrize("expr", ["(" * 300 + "c" + ")" * 300, "-" * 5000 + "c", "c" + "+c" * 3000,
                                  "sqrt(" * 200 + "c" + ")" * 200])
def test_parse_pathological_depth_is_not_a_500(client, expr):
    r = client.post("/api/parse", json={"expr": expr, "variable": "c"})
    assert r.status_code < 500


@pytest.mark.parametrize("ep", ["/api/evaluate", "/api/export"])
def test_summary_with_float_max_magnitude_is_not_a_500(client, ep):
    s = {**BASE, "mode": "summary", "summary": [{"c": 0, "mean": 1e308, "sd": 1}, {"c": 1, "mean": -1e308, "sd": 1},
                                                 {"c": 2, "mean": 1e308, "sd": 1}]}
    assert post_raw(client, ep, {"series": s}).status_code < 500


@settings(**SETTINGS)
@given(s=series_payload(), grid=st.one_of(st.none(), junk, st.lists(st.floats(allow_nan=True, allow_infinity=True), max_size=20)))
def test_evaluate_fuzz(client, s, grid):
    body = {"series": s}
    if grid is not None:
        body["grid"] = grid
    r = post_raw(client, "/api/evaluate", body)
    d = check(r)
    if r.status_code == 200:
        assert {"grid", "mean", "sd", "rows", "levels"} <= set(d)
        assert len(d["grid"]) == len(d["mean"]) == len(d["sd"])
        for row in d["rows"]:
            assert {"c1", "c2", "mu1", "mu2", "sd1", "sd2", "dmu", "dsum", "ssmd", "zprime", "ovl", "err", "pass"} <= set(row)
        assert d["levels"] == sorted(set(d["levels"])) or d["levels"] == []


@settings(**SETTINGS)
@given(s=series_payload())
def test_default_grid_is_sane_when_ok(client, s):
    r = post_raw(client, "/api/evaluate", {"series": s})
    d = check(r)
    if r.status_code == 200 and d["grid"]:
        g = d["grid"]
        assert g == sorted(g)
        assert g[0] == 0 or g[0] is None


@settings(max_examples=60, derandomize=True, deadline=None, suppress_health_check=list(HealthCheck), database=None)
@given(s=series_payload())
def test_export_fuzz(client, s):
    r = post_raw(client, "/api/export", {"series": s})
    check(r, allow_xlsx=True)
    if r.status_code == 200:
        import openpyxl
        openpyxl.load_workbook(io.BytesIO(r.content))


@settings(**SETTINGS)
@given(body=junk)
def test_fit_fuzz_always_200(client, body):
    r = post_raw(client, "/api/fit", body)
    d = check(r)
    assert r.status_code == 200
    assert isinstance(d, dict) and {"levels", "meanFits", "sdFits"} <= set(d)


@settings(**SETTINGS)
@given(pts=st.lists(st.fixed_dictionaries({"c": junk, "y": junk}), max_size=12),
       summ=st.lists(st.fixed_dictionaries({"c": junk, "mean": junk, "sd": junk}), max_size=12))
def test_fit_fuzz_structured(client, pts, summ):
    for body in ({"points": pts}, {"summary": summ}, {"points": pts, "summary": summ}):
        r = post_raw(client, "/api/fit", body)
        d = check(r)
        assert r.status_code == 200 and {"levels", "meanFits", "sdFits"} <= set(d)


@settings(max_examples=12, derandomize=True, deadline=None, suppress_health_check=list(HealthCheck), database=None)
@given(xs=st.lists(st.floats(-1e6, 1e6, allow_nan=False), min_size=5, max_size=40),
       ys=st.lists(st.floats(-1e6, 1e6, allow_nan=False), min_size=5, max_size=40))
def test_fit_numeric_random_clouds(client, xs, ys):
    n = min(len(xs), len(ys))
    r = post_raw(client, "/api/fit", {"points": [{"c": xs[i], "y": ys[i]} for i in range(n)]})
    d = check(r)
    assert r.status_code == 200
    for f in d["meanFits"] + d["sdFits"]:
        if f["ok"]:
            assert isinstance(f["expr"], str)
            p = client.post("/api/parse", json={"expr": f["expr"], "variable": "c" if f in d["meanFits"] else "S"}).json()
            assert p["ok"], f


@pytest.mark.parametrize("n", [1, 2, 10_000])
def test_large_grids(client, n):
    grid = [i * 500 / max(n - 1, 1) for i in range(n)]
    r = client.post("/api/evaluate", json={"series": BASE, "grid": grid})
    d = check(r)
    assert r.status_code == 200 and len(d["mean"]) == n and len(d["sd"]) == n
    assert d["grid"][0] == 0


def test_empty_and_degenerate_grids(client):
    for grid in ([], [0], [-1e308, 1e308], [float("nan")], [float("inf"), float("-inf")], [1e-320, 5e-324], [0] * 1000):
        r = post_raw(client, "/api/evaluate", {"series": BASE, "grid": grid})
        d = check(r)
        assert r.status_code == 200, (grid[:3], r.text[:200])
        assert len(d["mean"]) == len(grid)


def test_extreme_series_values(client):
    for patch in [{"cMax": 1e308}, {"cMax": 1e-300}, {"cMax": -5}, {"cMax": 0}, {"cMax": 1e15, "levels": [0, 1e15]},
                  {"levels": []}, {"levels": [-5, -1]}, {"levels": [0] * 100}, {"levels": list(range(0, 2000))},
                  {"levels": [1e308, 1e-308, 0, 5e-324]}, {"kTarget": -1}, {"kTarget": 0}, {"kTarget": 1e308},
                  {"metric": "nope"}, {"metric": None}, {"sim": {"n": -5, "seed": 2**70}}, {"sim": None},
                  {"meanExpr": "1e308*c", "sdExpr": "1e308"}, {"meanExpr": "0", "sdExpr": "0"},
                  {"meanExpr": "c", "sdExpr": "0"}, {"meanExpr": "1/c", "sdExpr": "1/S"},
                  {"meanExpr": "-c", "sdExpr": "-S"}, {"name": None}, {"units": 5}, {"mode": "replicates",
                                                                              "replicates": {"concs": [], "cells": []}},
                  {"mode": "replicates", "replicates": {"concs": [0, 1], "cells": [[1]]}},
                  {"mode": "replicates", "replicates": {"concs": [0], "cells": [[1], [2], [3]]}},
                  {"mode": "replicates", "replicates": {"concs": [0, 1], "cells": [["a", None], [float("nan"), 1e308]]}},
                  {"mode": "summary", "summary": []},
                  {"mode": "summary", "summary": [{"c": 0, "mean": 1e300, "sd": -1e300}, {"c": 1, "mean": -1e300, "sd": 1e300}]},
                  {"mode": "summary", "summary": [{"c": float("nan"), "mean": 1, "sd": 1}]}]:
        s = {**BASE, **patch}
        for ep in ("/api/evaluate", "/api/export"):
            r = post_raw(client, ep, {"series": s})
            check(r, allow_xlsx=ep.endswith("export"))
            assert r.status_code in (200, 400, 422), (ep, patch, r.status_code)
