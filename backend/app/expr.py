"""Spec section 2 expression language: tokenizer, recursive-descent parser, evaluator, Excel emitter.

No eval(). Errors carry a character position (0-based index into the source text).
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

import numpy as np


class ExprError(ValueError):
    def __init__(self, message: str, pos: int):
        super().__init__(f"{message} (at position {pos})")
        self.message = message
        self.pos = pos


# --------------------------------------------------------------------------- AST
@dataclass(frozen=True)
class Num:
    value: float
    text: str


@dataclass(frozen=True)
class Var:
    name: str


@dataclass(frozen=True)
class Pi:
    pass


@dataclass(frozen=True)
class Neg:
    arg: "Node"


@dataclass(frozen=True)
class Bin:
    op: str
    left: "Node"
    right: "Node"


@dataclass(frozen=True)
class Call:
    name: str
    args: tuple


Node = Num | Var | Pi | Neg | Bin | Call

# name -> (min args, max args or None, excel name)
FUNCS = {
    "sqrt": (1, 1, "SQRT"), "exp": (1, 1, "EXP"), "ln": (1, 1, "LN"), "log": (1, 1, "LOG10"),
    "log10": (1, 1, "LOG10"), "abs": (1, 1, "ABS"), "min": (1, None, "MIN"), "max": (1, None, "MAX"),
}
VARIABLES = {"c": ("c",), "S": ("S", "s")}

_TOKEN = re.compile(
    r"\s*(?:(?P<num>(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|(?P<id>[A-Za-z_][A-Za-z_0-9]*)|(?P<op>[-+*/^(),]))")


_WS = re.compile(r"\s*")


def tokenize(text: str) -> list[tuple[str, str, int]]:
    """Return [(kind, text, pos)] with kind in num/id/op and a trailing ('end', '', len)."""
    out, i = [], 0
    while True:
        i = _WS.match(text, i).end()
        if i >= len(text):
            out.append(("end", "", len(text)))
            return out
        m = _TOKEN.match(text, i)
        if not m:
            raise ExprError(f"unexpected character '{text[i]}'", i)
        kind = "num" if m.group("num") else "id" if m.group("id") else "op"
        out.append((kind, m.group(kind), m.start(kind)))
        i = m.end()


class _Parser:
    def __init__(self, text: str, variable: str):
        if variable not in VARIABLES:
            raise ValueError(f"variable must be one of {list(VARIABLES)}")
        self.variable = variable
        self.toks = tokenize(text)
        self.i = 0

    @property
    def tok(self):
        return self.toks[self.i]

    def eat(self):
        t = self.toks[self.i]
        self.i += 1
        return t

    def is_op(self, *ops):
        return self.tok[0] == "op" and self.tok[1] in ops

    def parse(self) -> Node:
        node = self.expr()
        if self.tok[0] != "end":
            raise ExprError(f"unexpected '{self.tok[1]}'", self.tok[2])
        return node

    def expr(self) -> Node:
        node = self.term()
        while self.is_op("+", "-"):
            op = self.eat()[1]
            node = Bin(op, node, self.term())
        return node

    def term(self) -> Node:
        node = self.unary()
        while self.is_op("*", "/"):
            op = self.eat()[1]
            node = Bin(op, node, self.unary())
        return node

    def unary(self) -> Node:
        if self.is_op("-"):
            self.eat()
            return Neg(self.unary())
        if self.is_op("+"):
            self.eat()
            return self.unary()
        return self.power()

    def power(self) -> Node:
        node = self.atom()
        if self.is_op("^"):
            self.eat()
            node = Bin("^", node, self.unary())
        return node

    def atom(self) -> Node:
        kind, text, pos = self.tok
        if kind == "num":
            self.eat()
            return Num(float(text), text)
        if kind == "id":
            self.eat()
            low = text.lower()
            if self.is_op("("):
                if low not in FUNCS:
                    raise ExprError(f"unknown function '{text}'", pos)
                self.eat()
                args = [self.expr()]
                while self.is_op(","):
                    self.eat()
                    args.append(self.expr())
                if not self.is_op(")"):
                    raise ExprError("expected ')'", self.tok[2])
                self.eat()
                lo, hi, _ = FUNCS[low]
                if len(args) < lo or (hi is not None and len(args) > hi):
                    raise ExprError(f"wrong number of arguments for '{text}'", pos)
                return Call(low, tuple(args))
            if text in VARIABLES[self.variable]:
                return Var(self.variable)
            if low == "pi":
                return Pi()
            if low in FUNCS:
                raise ExprError(f"function '{text}' needs '('", pos)
            if text in VARIABLES["c"] + VARIABLES["S"]:
                raise ExprError(f"variable '{text}' not allowed here; use '{self.variable}'", pos)
            raise ExprError(f"unknown identifier '{text}'", pos)
        if self.is_op("("):
            self.eat()
            node = self.expr()
            if not self.is_op(")"):
                raise ExprError("expected ')'", self.tok[2])
            self.eat()
            return node
        if kind == "end":
            raise ExprError("unexpected end of expression", pos)
        raise ExprError(f"unexpected '{text}'", pos)


def parse(text: str, variable: str = "c") -> Node:
    """Parse `text` where the only variable is `variable` ('c' or 'S').

    Pathologically deep input is rejected as an ExprError (never a RecursionError), and the depth
    limit guarantees that evaluating or emitting the tree cannot overflow the stack either.
    """
    try:
        node = _Parser(text, variable).parse()
    except RecursionError:
        raise ExprError("expression is too deeply nested", 0) from None
    if _depth(node) > MAX_DEPTH:
        raise ExprError("expression is too deeply nested", 0)
    return node


MAX_DEPTH = 200


def _depth(node: Node) -> int:
    """Height of the AST, computed iteratively."""
    deepest, stack = 0, [(node, 1)]
    while stack:
        n, d = stack.pop()
        deepest = max(deepest, d)
        if isinstance(n, Neg):
            stack.append((n.arg, d + 1))
        elif isinstance(n, Bin):
            stack.append((n.left, d + 1))
            stack.append((n.right, d + 1))
        elif isinstance(n, Call):
            stack.extend((a, d + 1) for a in n.args)
    return deepest


# --------------------------------------------------------------------------- evaluation
def evaluate(node: Node, x) -> np.ndarray:
    """Evaluate with the variable bound to x (scalar or array). Always returns an array shaped like x."""
    x = np.asarray(x, dtype=float)
    with np.errstate(all="ignore"):
        out = _ev(node, x)
    return np.broadcast_to(np.asarray(out, dtype=float), x.shape).copy()


def _ev(n: Node, x):
    if isinstance(n, Num):
        return n.value
    if isinstance(n, Var):
        return x
    if isinstance(n, Pi):
        return math.pi
    if isinstance(n, Neg):
        return -_ev(n.arg, x)
    if isinstance(n, Bin):
        a, b = _ev(n.left, x), _ev(n.right, x)
        return {"+": np.add, "-": np.subtract, "*": np.multiply, "/": np.divide, "^": np.power}[n.op](a, b)
    args = [np.asarray(_ev(a, x), dtype=float) for a in n.args]
    f = n.name
    if f == "min":
        return _reduce(np.minimum, args)
    if f == "max":
        return _reduce(np.maximum, args)
    fn = {"sqrt": np.sqrt, "exp": np.exp, "ln": np.log, "log": np.log10, "log10": np.log10, "abs": np.abs}[f]
    return fn(args[0])


def _reduce(fn, args):
    out = args[0]
    for a in args[1:]:
        out = fn(out, a)
    return out


# --------------------------------------------------------------------------- Excel emission
def to_excel(node: Node, ref: str) -> str:
    """Fully parenthesised Excel formula text (no leading '='), variable replaced by cell ref `ref`."""
    if isinstance(node, Num):
        return node.text.upper() if "e" in node.text else node.text
    if isinstance(node, Var):
        return ref
    if isinstance(node, Pi):
        return "PI()"
    if isinstance(node, Neg):
        return f"(-{to_excel(node.arg, ref)})"
    if isinstance(node, Bin):
        return f"({to_excel(node.left, ref)}{node.op}{to_excel(node.right, ref)})"
    return f"{FUNCS[node.name][2]}({','.join(to_excel(a, ref) for a in node.args)})"


def to_text(node: Node, var: str) -> str:
    """Fully parenthesised expression text in this language, the variable replaced by `var`."""
    if isinstance(node, Num):
        return node.text
    if isinstance(node, Var):
        return var
    if isinstance(node, Pi):
        return "pi"
    if isinstance(node, Neg):
        return f"(-{to_text(node.arg, var)})"
    if isinstance(node, Bin):
        return f"({to_text(node.left, var)}{node.op}{to_text(node.right, var)})"
    return f"{node.name}({','.join(to_text(a, var) for a in node.args)})"
