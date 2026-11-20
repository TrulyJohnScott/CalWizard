import ast
import inspect
import math

import numpy as np
import pytest

from app import expr as E


def val(text, x=0.0, var="c"):
    return float(E.evaluate(E.parse(text, var), x))


def test_precedence():
    assert val("-2^2") == -4
    assert val("2^3^2") == 512  # right associative
    assert val("2^-1") == 0.5
    assert val("1 + 2*3") == 7
    assert val("(1 + 2)*3") == 9
    assert val("10 - 4 - 3") == 3
    assert val("8/4/2") == 1
    assert val("- -3") == 3
    assert val("+3") == 3
    assert val(".5 + 1.5e1 + 2E-1") == pytest.approx(15.7)


def test_variables_and_constants():
    assert val("c^2", 3) == 9
    assert val("S*2", 4, "S") == 8
    assert val("s*2", 4, "S") == 8
    assert val("pi") == pytest.approx(math.pi)
    np.testing.assert_allclose(E.evaluate(E.parse("2*c", "c"), [1, 2, 3]), [2, 4, 6])
    assert E.evaluate(E.parse("20", "S"), [1, 2, 3]).shape == (3,)


def test_functions():
    assert val("log(1000)") == pytest.approx(3)  # base 10
    assert val("log10(100)") == pytest.approx(2)
    assert val("ln(exp(2))") == pytest.approx(2)
    assert val("SQRT(16) + Abs(-2)") == 6
    assert val("min(3, 1, 2)") == 1
    assert val("max(3, 1, 2)") == 3
    assert math.isnan(val("sqrt(-1)"))
    assert math.isinf(val("1/0"))


@pytest.mark.parametrize("text,var,pos", [
    ("1 +", "c", 3),
    ("2 $ 3", "c", 2),
    ("foo + 1", "c", 0),
    ("1 + foo(2)", "c", 4),
    ("(1 + 2", "c", 6),
    ("1 2", "c", 2),
    ("sqrt", "c", 0),
    ("sqrt(1, 2)", "c", 0),
    ("S + 1", "c", 0),  # wrong variable for the mean field
    ("c + 1", "S", 0),  # wrong variable for the sd field
    ("1 + c*S", "c", 6),
    ("", "c", 0),
    ("2e", "c", 1),
])
def test_errors_have_positions(text, var, pos):
    with pytest.raises(E.ExprError) as ei:
        E.parse(text, var)
    assert ei.value.pos == pos


def test_excel_emission():
    def f(t, v="c"):
        return E.to_excel(E.parse(t, v), "A1")

    assert f("-2^2") == "(-(2^2))"
    assert f("2^3^2") == "(2^(3^2))"
    assert f("1 + 2*c") == "(1+(2*A1))"
    assert f("log(c) + ln(c) + log10(c)") == "((LOG10(A1)+LN(A1))+LOG10(A1))"
    assert f("pi*sqrt(abs(c))") == "(PI()*SQRT(ABS(A1)))"
    assert f("min(c, 1, 2e-3)") == "MIN(A1,1,2E-3)"
    assert f("sqrt(15^2 + (0.08*S)^2)", "S") == "SQRT(((15^2)+((0.08*A1)^2)))"
    assert f("2^-3") == "(2^(-3))"


def test_no_eval_used():
    names = {n.id for n in ast.walk(ast.parse(inspect.getsource(E))) if isinstance(n, ast.Name)}
    assert not names & {"eval", "exec", "compile"}
