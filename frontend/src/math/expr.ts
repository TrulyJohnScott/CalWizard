/**
 * Spec section 2: tiny expression language. Tokenizer + recursive-descent parser -> AST, then a
 * closure compiler. No eval / Function. Errors carry the 0-based character position.
 */
export class ExprError extends Error {
  pos: number
  constructor(message: string, pos: number) {
    super(message)
    this.pos = pos
  }
}

export type Ast =
  | { t: 'num'; v: number }
  | { t: 'var' }
  | { t: 'neg'; a: Ast }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Ast; b: Ast }
  | { t: 'call'; fn: string; args: Ast[] }

type Tok =
  | { k: 'num'; v: number; pos: number }
  | { k: 'id'; v: string; pos: number }
  | { k: 'op'; v: string; pos: number }
  | { k: 'end'; pos: number }

const isDigit = (ch: string | undefined) => ch !== undefined && ch >= '0' && ch <= '9'
const isAlpha = (ch: string | undefined) => ch !== undefined && /[A-Za-z_]/.test(ch)

export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1]))) {
      const start = i
      while (isDigit(src[i])) i++
      if (src[i] === '.' && isDigit(src[i + 1])) {
        i++
        while (isDigit(src[i])) i++
      }
      if (src[i] === 'e' || src[i] === 'E') {
        let j = i + 1
        if (src[j] === '+' || src[j] === '-') j++
        if (isDigit(src[j])) {
          while (isDigit(src[j])) j++
          i = j
        }
      }
      out.push({ k: 'num', v: Number(src.slice(start, i)), pos: start })
      continue
    }
    if (isAlpha(ch)) {
      const start = i
      while (isAlpha(src[i]) || isDigit(src[i])) i++
      out.push({ k: 'id', v: src.slice(start, i), pos: start })
      continue
    }
    if ('+-*/^(),'.includes(ch)) {
      out.push({ k: 'op', v: ch, pos: i })
      i++
      continue
    }
    throw new ExprError(`unexpected character '${ch}'`, i)
  }
  out.push({ k: 'end', pos: src.length })
  return out
}

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10, // base 10, like Excel
  log10: Math.log10,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
}
const ONE_ARG = new Set(['sqrt', 'exp', 'ln', 'log', 'log10', 'abs'])

/** Parse `src`; `variable` is the one free variable allowed ('c' for mean, 'S' for sd). */
export function parseExpr(src: string, variable: 'c' | 'S'): Ast {
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const isOp = (v: string) => {
    const t = peek()
    return t.k === 'op' && t.v === v
  }
  const describe = (t: Tok) => (t.k === 'end' ? 'end of expression' : `'${t.k === 'num' ? (src.slice(t.pos).match(/^[^\s+\-*/^(),]+/)?.[0] ?? String(t.v)) : t.v}'`)
  const isVar = (name: string) => (variable === 'c' ? name === 'c' : name === 'S' || name === 's')

  if (peek().k === 'end') throw new ExprError('empty expression', 0)

  function expr(): Ast {
    let a = term()
    while (isOp('+') || isOp('-')) {
      const op = (toks[p++] as { v: '+' | '-' }).v
      a = { t: 'bin', op, a, b: term() }
    }
    return a
  }
  function term(): Ast {
    let a = unary()
    while (isOp('*') || isOp('/')) {
      const op = (toks[p++] as { v: '*' | '/' }).v
      a = { t: 'bin', op, a, b: unary() }
    }
    return a
  }
  function unary(): Ast {
    if (isOp('-')) {
      p++
      return { t: 'neg', a: unary() }
    }
    if (isOp('+')) {
      p++
      return unary()
    }
    return power()
  }
  function power(): Ast {
    const a = atom()
    if (isOp('^')) {
      p++
      return { t: 'bin', op: '^', a, b: unary() }
    }
    return a
  }
  function atom(): Ast {
    const t = toks[p]
    if (t.k === 'num') {
      p++
      return { t: 'num', v: t.v }
    }
    if (t.k === 'id') {
      const name = t.v
      const lower = name.toLowerCase()
      const next = toks[p + 1]
      if (next.k === 'op' && next.v === '(') {
        if (!(lower in FUNCS)) throw new ExprError(`unknown function '${name}'`, t.pos)
        p += 2
        const args: Ast[] = [expr()]
        while (isOp(',')) {
          p++
          args.push(expr())
        }
        if (!isOp(')')) throw new ExprError(`expected ')' but found ${describe(peek())}`, peek().pos)
        p++
        if (ONE_ARG.has(lower) && args.length !== 1) throw new ExprError(`${lower} takes one argument`, t.pos)
        return { t: 'call', fn: lower, args }
      }
      p++
      if (isVar(name)) return { t: 'var' }
      if (lower === 'pi') return { t: 'num', v: Math.PI }
      if (variable === 'c' && lower === 's') throw new ExprError(`'${name}' is a signal variable; use c here`, t.pos)
      if (variable === 'S' && name === 'c') throw new ExprError(`'c' is not available here; use S (signal)`, t.pos)
      throw new ExprError(`unknown identifier '${name}'`, t.pos)
    }
    if (t.k === 'op' && t.v === '(') {
      p++
      const a = expr()
      if (!isOp(')')) throw new ExprError(`expected ')' but found ${describe(peek())}`, peek().pos)
      p++
      return a
    }
    throw new ExprError(`unexpected ${describe(t)}`, t.pos)
  }

  const ast = expr()
  if (peek().k !== 'end') throw new ExprError(`unexpected ${describe(peek())}`, peek().pos)
  return ast
}

export type Fn = (x: number) => number

/** Compile an AST to a closure x -> value (plain floats; NaN / inf propagate). */
export function compileAst(a: Ast): Fn {
  switch (a.t) {
    case 'num': {
      const v = a.v
      return () => v
    }
    case 'var':
      return (x) => x
    case 'neg': {
      const f = compileAst(a.a)
      return (x) => -f(x)
    }
    case 'bin': {
      const f = compileAst(a.a)
      const g = compileAst(a.b)
      switch (a.op) {
        case '+': return (x) => f(x) + g(x)
        case '-': return (x) => f(x) - g(x)
        case '*': return (x) => f(x) * g(x)
        case '/': return (x) => f(x) / g(x)
        case '^': return (x) => Math.pow(f(x), g(x))
      }
      break
    }
    case 'call': {
      const fn = FUNCS[a.fn]
      const args = a.args.map(compileAst)
      if (args.length === 1) {
        const f = args[0]
        return (x) => fn(f(x))
      }
      return (x) => fn(...args.map((f) => f(x)))
    }
  }
  return () => NaN
}

export type Compiled = { ok: true; fn: Fn } | { ok: false; error: string; pos: number }

export function compileExpr(src: string, variable: 'c' | 'S'): Compiled {
  try {
    return { ok: true, fn: compileAst(parseExpr(src, variable)) }
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, error: e.message, pos: e.pos }
    throw e
  }
}
