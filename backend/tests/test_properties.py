"""Property-based tests (hypothesis): parser round-trip, metric identities, ladder invariants, inverse, tables, API."""
import math
import re

import numpy as np
from fastapi.testclient import TestClient
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app import analysis as A

pytestmark = pytest.mark.deep
from app import expr as E
from app import metrics as K
from app.main import app
from app.series import Series, Table, compile_series

ML = 30  # ladder length cap in property tests (keeps them fast)
PROP = settings(max_examples=100, deadline=None, derandomize=True)
client = TestClient(app)


# ================================================================ parser round-trip
def numbers():
    return st.one_of(
        st.integers(0, 1000).map(str),
        st.floats(0, 1000, allow_nan=False, allow_infinity=False).map(lambda v: repr(round(v, 4))),
        st.floats(1e-6, 1e6, allow_nan=False, allow_infinity=False).map(lambda v: f"{v:.3e}"),
        st.integers(0, 99).map(lambda n: f".{n}"),
    ).map(lambda t: E.Num(float(t), t))


def trees(variable: str):
    leaves = st.one_of(numbers(), st.just(E.Var(variable)), st.just(E.Pi()))

    def extend(children):
        calls = st.one_of(
            st.tuples(st.sampled_from(["sqrt", "exp", "ln", "log", "log10", "abs"]), children).map(
                lambda t: E.Call(t[0], (t[1],))),
            st.tuples(st.sampled_from(["min", "max"]), st.lists(children, min_size=1, max_size=3)).map(
                lambda t: E.Call(t[0], tuple(t[1]))))
        return st.one_of(children.map(E.Neg), st.tuples(st.sampled_from("+-*/^"), children, children).map(
            lambda t: E.Bin(*t)), calls)

    return st.recursive(leaves, extend, max_leaves=12)


_PREC = {"+": 1, "-": 1, "*": 2, "/": 2, "^": 4}


def _prec(n) -> int:
    return _PREC[n.op] if isinstance(n, E.Bin) else 3 if isinstance(n, E.Neg) else 5


def render_min(n) -> str:
    """Text with only the parentheses the grammar needs (left-assoc + - * /, right-assoc ^, unary below ^)."""
    def wrap(child, need):
        return f"({render_min(child)})" if need else render_min(child)

    if isinstance(n, E.Num):
        return n.text
    if isinstance(n, E.Var):
        return n.name
    if isinstance(n, E.Pi):
        return "pi"
    if isinstance(n, E.Neg):
        return "-" + wrap(n.arg, _prec(n.arg) < 3)
    if isinstance(n, E.Bin):
        p = _PREC[n.op]
        if n.op == "^":  # base must be an atom; exponent is a unary expression
            return f"{wrap(n.left, _prec(n.left) < 5)}^{wrap(n.right, _prec(n.right) < 3)}"
        return f"{wrap(n.left, _prec(n.left) < p)}{n.op}{wrap(n.right, _prec(n.right) <= p)}"
    return f"{n.name}({', '.join(render_min(a) for a in n.args)})"


def render_full(n) -> str:
    if isinstance(n, E.Num):
        return n.text
    if isinstance(n, E.Var):
        return n.name
    if isinstance(n, E.Pi):
        return "PI"
    if isinstance(n, E.Neg):
        return f"(-{render_full(n.arg)})"
    if isinstance(n, E.Bin):
        return f"({render_full(n.left)} {n.op} {render_full(n.right)})"
    return f"{n.name.upper()}({' , '.join(render_full(a) for a in n.args)})"


XS = [0.0, 0.5, 1.0, 3.0, 40.0, 1000.0]


def same_values(a, b):
    np.testing.assert_allclose(a, b, rtol=1e-12, atol=0, equal_nan=True)


@PROP
@given(st.sampled_from("cS"), st.data())
def test_parse_render_roundtrip_evaluates_identically(variable, data):
    tree = data.draw(trees(variable))
    want = E.evaluate(tree, XS)
    for text in (render_min(tree), render_full(tree)):
        back = E.parse(text, variable)
        same_values(E.evaluate(back, XS), want)
    # the minimal rendering is a faithful inverse of the parser: the tree itself comes back (only number
    # text and function-name case are normalised, and both are generated canonically)
    assert E.parse(render_min(tree), variable) == tree


@PROP
@given(st.sampled_from("cS"), st.data())
def test_excel_emission_parses_back_in_our_evaluator(variable, data):
    tree = data.draw(trees(variable))
    xl = E.to_excel(tree, "A1")
    assert re.fullmatch(r"[A-Z0-9.+\-*/^(),]*", xl)  # Excel dialect: upper case, no stray symbols
    back = xl.replace("PI()", "pi")
    back = re.sub(r"\bA1\b", variable, back)  # the cell reference is our variable again
    same_values(E.evaluate(E.parse(back, variable), XS), E.evaluate(tree, XS))


# ================================================================ metric identities
mus = st.floats(-1e3, 1e3, allow_nan=False)
sds = st.floats(0.05, 200, allow_nan=False)


@PROP
@given(mus, sds, mus, sds)
def test_dsum_ssmd_flip_sign_when_levels_swap_and_zprime_is_symmetric(m1, s1, m2, s2):
    assert K.dsum(m1, s1, m2, s2) == -K.dsum(m2, s2, m1, s1)
    assert K.ssmd(m1, s1, m2, s2) == -K.ssmd(m2, s2, m1, s1)
    z = K.zprime(m1, s1, m2, s2)
    assert z == K.zprime(m2, s2, m1, s1) or (math.isnan(z) and math.isnan(K.zprime(m2, s2, m1, s1)))
    assert K.ssmd(m1, s1, m2, s2) * K.dsum(m1, s1, m2, s2) >= 0
    assert abs(K.ssmd(m1, s1, m2, s2)) >= abs(K.dsum(m1, s1, m2, s2)) - 1e-12  # sqrt(a²+b²) <= a+b


ratios = st.floats(0.1, 10)


@PROP
@given(mus, sds, mus, sds)
def test_overlap_and_error_are_probabilities_and_symmetric_even_for_extreme_sd_ratios(m1, s1, m2, s2):
    ovl, err = K.overlap(m1, s1, m2, s2), K.misclass(m1, s1, m2, s2)
    assert -1e-9 <= ovl <= 1 + 1e-9
    assert 0 <= err <= 0.5 + 1e-12
    assert math.isclose(ovl, K.overlap(m2, s2, m1, s1), abs_tol=1e-9)
    assert math.isclose(err, K.misclass(m2, s2, m1, s1), abs_tol=1e-12)


@PROP
@given(mus, sds, mus)
def test_equal_sd_error_is_half_the_overlap(m1, s, m2):
    assert math.isclose(K.misclass(m1, s, m2, s), K.overlap(m1, s, m2, s) / 2, abs_tol=1e-6)


@PROP
@given(mus, sds)
def test_overlap_of_identical_distributions_is_one(m, s):
    assert math.isclose(K.overlap(m, s, m, s), 1.0, abs_tol=1e-6)
    assert math.isclose(K.misclass(m, s, m, s), 0.5)


@PROP
@given(mus, sds, ratios, st.floats(0.5, 5), st.floats(0.01, 4))
def test_overlap_non_increasing_and_error_shrinks_with_separation(m, s1, ratio, d1, extra):
    s2 = s1 * ratio
    scale = s1 + s2
    near = (m, s1, m + d1 * scale, s2)
    far = (m, s1, m + (d1 + extra) * scale, s2)
    assert K.overlap(*far) <= K.overlap(*near) + 1e-9
    assert K.misclass(*far) <= K.misclass(*near) + 1e-9


@PROP
@given(mus, sds, ratios)
def test_error_and_overlap_vanish_with_large_separation(m, s1, ratio):
    s2 = s1 * ratio
    assert K.misclass(m, s1, m + 12 * (s1 + s2), s2) < 1e-6
    assert K.overlap(m, s1, m + 12 * (s1 + s2), s2) < 1e-6


# ================================================================ ladder / closeness invariants
@st.composite
def monotone_models(draw):
    """Increasing mean, increasing sd: the family where the greedy ladder is monotone in k."""
    a = draw(st.floats(0, 200))
    b = draw(st.floats(0.5, 50))
    p = draw(st.floats(0.5, 1.5))
    s0 = draw(st.floats(0.2, 20))
    cv = draw(st.sampled_from([0.0, 0.02, 0.1]))
    cmax = draw(st.floats(5, 500))
    sd_expr = f"{s0!r} + {cv!r}*S" if cv else repr(s0)
    return compile_series(Series(meanExpr=f"{a!r} + {b!r}*c^{p!r}", sdExpr=sd_expr, cMax=cmax))


METRIC_K = st.one_of(st.tuples(st.just("dsum"), st.floats(0.3, 3)), st.tuples(st.just("ssmd"), st.floats(0.5, 6)),
                     st.tuples(st.just("zprime"), st.floats(-1.0, 0.8)))


@PROP
@given(monotone_models(), METRIC_K, st.floats(0, 0.4))
def test_ladder_invariants(m, mk, start_frac):
    metric, k = mk
    start = start_frac * m.c_max
    for sig in (0, 4):
        lv = A.ladder(m, metric, k, start=start, sig=sig, max_levels=ML)
        assert lv[0] == start and len(lv) <= ML
        assert all(b > a for a, b in zip(lv, lv[1:]))  # strictly increasing
        assert lv[-1] <= m.c_max  # never exceeds stop
        assert all(A.pair(m, a, b, metric, k)["pass"] for a, b in zip(lv, lv[1:]))  # every rung passes
    # sig=0: the point just below each rung does NOT pass (the rung is the smallest passing c)
    lv = A.ladder(m, metric, k, start=start, sig=0, max_levels=ML)
    for a, b in zip(lv, lv[1:]):
        below = b - 1e-7 * (b - a)
        assert not A.pair(m, a, below, metric, k)["pass"], (a, b)
    # and the next rung is absent only if nothing passes anywhere on (last, cMax]
    if len(lv) < ML and lv[-1] < m.c_max:
        last = lv[-1]
        grid = last + (m.c_max - last) * np.arange(1, 2001) / 2000
        assert not A._passes_array(metric, A.metric_value(m, last, grid, metric), k).any()


@PROP
@given(monotone_models(), st.sampled_from(["dsum", "ssmd"]), st.floats(0.3, 4), st.floats(0.05, 3))
def test_larger_k_never_gives_more_rungs(m, metric, k, more):
    assert len(A.ladder(m, metric, k + more, sig=0, max_levels=ML)) <= len(A.ladder(m, metric, k, sig=0, max_levels=ML))


@PROP
@given(monotone_models(), st.floats(-1.0, 0.7), st.floats(0.02, 0.2))
def test_larger_zprime_target_never_gives_more_rungs(m, k, more):
    assert len(A.ladder(m, "zprime", k + more, sig=0, max_levels=ML)) <= len(A.ladder(m, "zprime", k, sig=0, max_levels=ML))


@PROP
@given(monotone_models(), METRIC_K, st.floats(0, 1), st.floats(0, 1))
def test_steps_between_and_closeness_are_consistent_with_pass(m, mk, f1, f2):
    metric, k = mk
    lo, hi = sorted((f1 * m.c_max, f2 * m.c_max))
    n = A.steps_between(m, lo, hi, metric, k)
    assert n == A.steps_between(m, hi, lo, metric, k) and 0 <= n < A.MAX_LEVELS
    row = A.pair(m, lo, hi, metric, k)
    if row["pass"]:
        assert n >= 1  # a passing pair is at least one resolvable step
    if lo == hi:
        assert n == 0
    # closeness q >= 1 exactly when the pair passes (up to rounding at the boundary)
    q = A.closeness_q(row, metric, k)
    assert q >= 0
    assert q >= 1 - 1e-9 if row["pass"] else q <= 1 + 1e-9


# ================================================================ inverse
@PROP
@given(st.floats(0, 100), st.floats(0.5, 50), st.floats(0.4, 2), st.floats(5, 500), st.floats(0.001, 0.999),
       st.sampled_from([1, -1]))
def test_inverse_of_mean_recovers_concentration(a, b, p, cmax, frac, sign):
    m = compile_series(Series(meanExpr=f"{a!r} + {sign * b!r}*c^{p!r}" if sign > 0 else f"{a + 5000!r} - {b!r}*c^{p!r}",
                              sdExpr="1", cMax=cmax))
    c = frac * cmax
    (got,) = m.inverse([float(m.mean(c))])
    assert got is not None and math.isclose(got, c, rel_tol=1e-8, abs_tol=1e-9 * cmax)


# ================================================================ table interpolation
@st.composite
def tables(draw):
    c = sorted(draw(st.sets(st.integers(0, 2000), min_size=1, max_size=12)))
    y = draw(st.lists(st.floats(-1e3, 1e3), min_size=len(c), max_size=len(c)))
    return np.array(c, float) / 10, np.array(y)


@PROP
@given(tables())
def test_pchip_passes_through_points_and_stays_between_neighbours(tab):
    c, y = tab
    t = Table(c, y)
    np.testing.assert_allclose(t(c), y, rtol=1e-9, atol=1e-9)
    tol = 1e-9 * (1 + np.abs(y).max())
    for i in range(len(c) - 1):
        x = np.linspace(c[i], c[i + 1], 25)
        v = t(x)
        assert v.min() >= min(y[i], y[i + 1]) - tol and v.max() <= max(y[i], y[i + 1]) + tol
    # clamped outside
    np.testing.assert_allclose(t([c[0] - 5, c[-1] + 5]), [y[0], y[-1]], rtol=1e-9, atol=1e-9)


@PROP
@given(tables())
def test_pchip_preserves_monotonicity(tab):
    c, y = tab
    t = Table(c, np.sort(y))
    assert np.all(np.diff(t(np.linspace(c[0], c[-1], 200))) >= -1e-9 * (1 + np.abs(y).max()))


# ================================================================ API JSON round trip
presets_mean = ["4000 + (50 - 4000)/(1 + (c/40)^1.2)", "50 + 12*c^0.8", "50 + 900*ln(1 + c/20)", "100 + 3*c"]
presets_sd = ["sqrt(15^2 + (0.08*S)^2)", "20", "0.08*S", "2 + 0.05*S^1.1"]


@st.composite
def series_objects(draw):
    levels = draw(st.lists(st.floats(0, 1000, allow_nan=False), max_size=8))
    return Series(
        name=draw(st.text(max_size=20)), units=draw(st.sampled_from(["ng/mL", "µg/L", "", "IU"])),
        meanExpr=draw(st.sampled_from(presets_mean)), sdExpr=draw(st.sampled_from(presets_sd)),
        levels=levels, cMax=draw(st.floats(1, 1000)), metric=draw(st.sampled_from(["dsum", "ssmd", "zprime"])),
        kTarget=draw(st.floats(0.5, 5)), sim={"n": draw(st.integers(1, 20)), "seed": draw(st.integers(0, 10**6))})


@PROP
@given(series_objects())
def test_series_json_roundtrip_through_the_api(s):
    wire = s.model_dump(by_alias=True, mode="json")
    assert Series.model_validate(wire) == s  # camelCase wire form is lossless
    assert Series.model_validate_json(s.model_dump_json(by_alias=True)) == s
    r = client.post("/api/evaluate", json={"series": wire, "grid": [0, 1]})
    assert r.status_code == 200
    body = r.json()
    assert body["levels"] == s.levels and len(body["rows"]) == len(s.levels) - 1
    m = compile_series(s)
    assert body["rows"] == [{k: (None if isinstance(v, float) and not math.isfinite(v) else v)
                             for k, v in row.items()} for row in
                            [{k: (bool(v) if k == "pass" else float(v)) for k, v in r_.items()}
                             for r_ in K.level_rows(m)]]
    c = s.levels[-1]
    meas = client.post("/api/measure", json={"series": wire, "c1": 0, "c2": c}).json()
    direct = A.pair(m, 0, c, s.metric, s.k_target)
    for key, want in direct.items():
        if isinstance(want, float) and not math.isfinite(want):
            assert meas[key] is None
        else:
            assert meas[key] == want
    lad = client.post("/api/ladder", json={"series": wire, "metric": "ssmd", "k": 3}).json()
    assert lad["levels"] == A.ladder(m, "ssmd", 3) and lad["n"] == len(lad["levels"])
