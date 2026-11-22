"""代码实验室的 Python 会话引擎。

Pyodide Worker 用 `__lc_dispatch__(payload_json)` 一次调用完成一件事，返回 JSON 字符串。
会话（命名空间）留在 Python 内存里，所以：

- 跑完用例后，用户可以继续在终端里用 `Solution()` 和跑出来的变量；
- 终端里敲的每一条命令都在同一个命名空间里执行，变量会累积；
- 需要干净环境时由主线程发 `reset`。

设计约定（和 worker.js / runner.ts 对齐）：

- 用例每个都用**全新命名空间**跑，避免上一例的副作用影响下一例；
- 最后一个用例的命名空间会留作会话命名空间，供终端查看；
- 输出全部自己接管 `sys.stdout` / `sys.stderr`，不依赖 Pyodide 的 setStdout；
- 任何异常都转成可读文本返回，绝不让 Python 侧的异常穿透成 Worker 崩溃。
"""

from __future__ import annotations

import ast
import builtins
import json
import sys
import time
import traceback
import types

# repr 太长会撑爆终端；这是单个值的上限
MAX_REPR = 240
# 单步追踪最多记录多少行，防止大循环把内存打满
MAX_STEPS = 300
# 会话表：sessionId -> {ns, code}
_SESSIONS: dict[str, dict] = {}


class _Writer:
    """替身 stdout/stderr：把 write 收进列表，退出时拼成字符串。"""

    __slots__ = ('_buf',)

    def __init__(self, buf: list[str]) -> None:
        self._buf = buf

    def write(self, text: str) -> int:
        self._buf.append(text)
        return len(text)

    def writelines(self, lines) -> None:  # type: ignore[no-untyped-def]
        for line in lines:
            self._buf.append(line)

    def flush(self) -> None:
        return None

    def isatty(self) -> bool:
        return False


class _Capture:
    """with 块里接管 stdout/stderr，把输出收进 out/err 两个列表。"""

    def __init__(self) -> None:
        self.out: list[str] = []
        self.err: list[str] = []
        self._saved: tuple = (None, None)

    def __enter__(self) -> '_Capture':
        self._saved = (sys.stdout, sys.stderr)
        sys.stdout = _Writer(self.out)
        sys.stderr = _Writer(self.err)
        return self

    def __exit__(self, *exc_info) -> bool:
        saved_out, saved_err = self._saved
        if saved_out is not None:
            sys.stdout = saved_out
        if saved_err is not None:
            sys.stderr = saved_err
        return False


def _short(text: str, limit: int = MAX_REPR) -> str:
    return text if len(text) <= limit else text[:limit] + '…'


def _safe_repr(value) -> str:  # type: ignore[no-untyped-def]
    try:
        text = repr(value)
    except BaseException as exc:  # repr 自己炸了也不能连累调用方
        return f'<repr 失败：{type(exc).__name__}>'
    return _short(text)


def _fmt_error(exc: BaseException) -> str:
    """把异常栈裁成「只和用户代码有关」的样子，去掉引擎自己的栈帧。"""
    try:
        raw = ''.join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    except BaseException:
        return f'{type(exc).__name__}: {exc}'
    kept: list[str] = []
    skipping = False
    for line in raw.splitlines():
        stripped = line.strip()
        if stripped.startswith('File "'):
            skipping = not ('<用户代码>' in stripped or '<用例>' in stripped)
            if skipping:
                continue
        elif skipping and (not stripped or line.startswith(' ')):
            # 被过滤栈帧的源码行 / 空行
            if not stripped:
                skipping = False
            continue
        elif not stripped:
            skipping = False
            continue
        kept.append(line)
    text = '\n'.join(kept).strip()
    return _short(text or f'{type(exc).__name__}: {exc}', 4000)


def _new_ns(prelude: str = '') -> dict:
    """新建一个干净的命名空间；prelude 是主线程传来的「自测辅助」源码（链表/树构造等）。

    辅助函数先于用户代码执行，用户自己再定义 ListNode 会覆盖掉同名的那个，
    而辅助函数是按名字查全局的，所以它们会自动用上用户的版本，不冲突。
    """
    ns = {'__name__': '__lc__', '__builtins__': builtins}
    if prelude:
        exec(_prelude_code(prelude), ns)
    return ns


_PRELUDE_CACHE: dict[str, object] = {}


def _prelude_code(prelude: str):  # type: ignore[no-untyped-def]
    cached = _PRELUDE_CACHE.get(prelude)
    if cached is None:
        cached = compile(prelude, '<自测辅助>', 'exec')
        _PRELUDE_CACHE[prelude] = cached
    return cached


def _vars_of(ns: dict) -> list[dict]:
    rows: list[dict] = []
    for name, value in list(ns.items()):
        # 双下划线是 Python 内部；单下划线是引擎注入的自测辅助（_build_list 之类），
        # 但 `_` 是「上一次结果」，要留
        if name.startswith('__') or (name.startswith('_') and name != '_'):
            continue
        if isinstance(value, types.ModuleType):
            continue
        rows.append({'name': name, 'type': type(value).__name__, 'repr': _safe_repr(value)})
    return rows


def _exec_statement(code: str, ns: dict) -> str:
    """执行一段代码；如果最后一句是表达式，返回它的 repr（像 REPL 那样）。"""
    tree = ast.parse(code, '<用户代码>', 'exec')
    tail = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        tail = ast.Expression(tree.body[-1].value)
        tree.body = tree.body[:-1]
    if tree.body:
        exec(compile(tree, '<用户代码>', 'exec'), ns)
    if tail is not None:
        value = eval(compile(tail, '<用户代码>', 'eval'), ns)
        ns['_'] = value
        # 和真 REPL 一样：结果是 None 就不显示，免得每句 print 后面跟一个 None
        return '' if value is None else _safe_repr(value)
    return ''


def _session(sid: str) -> dict:
    return _SESSIONS.setdefault(sid, {'ns': None, 'code': ''})


# ---------------------------------------------------------------- 动作：跑用例


def _run_cases(payload: dict) -> dict:
    sid = str(payload.get('session') or 'default')
    code = str(payload.get('code') or '')
    prelude = str(payload.get('prelude') or '')
    cases = payload.get('cases') or []
    session = _session(sid)
    session['code'] = code

    results: list[dict] = []
    total_out: list[str] = []
    total_err: list[str] = []
    last_ns: dict | None = None

    # 代码只编译一次：既省掉 N 次编译，也能在语法错误时不给会话留一个空命名空间
    # （否则终端下一条命令会因为「命名空间已存在」而不重新载入代码，直接 NameError）
    code_obj = None
    compile_error = ''
    try:
        code_obj = compile(code, '<用户代码>', 'exec')
    except BaseException as exc:
        compile_error = _fmt_error(exc)

    if compile_error:
        session['ns'] = None
        for item in cases:
            results.append(
                {
                    'id': str(item.get('id') or ''),
                    'repr': '',
                    'stdout': '',
                    'stderr': '',
                    'error': compile_error,
                    'ms': 0,
                }
            )
        return {'cases': results, 'vars': [], 'stdout': '', 'stderr': ''}

    for item in cases:
        case_id = str(item.get('id') or '')
        call = str(item.get('call') or '')
        # 每个用例独立命名空间：和 LeetCode 一样，用例之间不共享状态
        ns = _new_ns(prelude)
        last_ns = ns
        cap = _Capture()
        started = time.perf_counter()
        repr_text = ''
        error = ''
        with cap:
            try:
                exec(code_obj, ns)
                if call.strip():
                    value = eval(compile(call, '<用例>', 'eval'), ns)
                    ns['_'] = value
                    repr_text = _safe_repr(value)
                else:
                    error = '调用表达式为空，先填上要执行的调用'
            except BaseException as exc:
                error = _fmt_error(exc)
        ms = int((time.perf_counter() - started) * 1000)
        out_text = ''.join(cap.out)
        err_text = ''.join(cap.err)
        total_out.append(out_text)
        total_err.append(err_text)
        results.append(
            {
                'id': case_id,
                'repr': repr_text,
                'stdout': out_text,
                'stderr': err_text,
                'error': error,
                'ms': ms,
            }
        )

    if last_ns is not None:
        session['ns'] = last_ns
    return {
        'cases': results,
        'vars': _vars_of(session['ns'] or {}),
        'stdout': ''.join(total_out),
        'stderr': ''.join(total_err),
    }


# ---------------------------------------------------------------- 动作：终端执行


def _exec(payload: dict) -> dict:
    sid = str(payload.get('session') or 'default')
    code = str(payload.get('code') or '')
    prelude = str(payload.get('prelude') or '')
    preload = payload.get('preload')
    reload_flag = bool(payload.get('reload'))
    session = _session(sid)

    preload_error = ''
    if reload_flag or session['ns'] is None:
        ns = _new_ns(prelude)
        session['ns'] = ns
        if isinstance(preload, str) and preload.strip():
            cap = _Capture()
            with cap:
                try:
                    exec(compile(preload, '<用户代码>', 'exec'), ns)
                    session['code'] = preload
                except BaseException as exc:
                    preload_error = _fmt_error(exc)
            # 预加载时的输出直接丢掉，不污染终端
        if reload_flag and not code.strip():
            return {
                'repr': '',
                'stdout': '',
                'stderr': '',
                'error': '',
                'ms': 0,
                'vars': _vars_of(ns),
                'preloadError': preload_error,
            }

    ns = session['ns'] or _new_ns()
    session['ns'] = ns

    cap = _Capture()
    started = time.perf_counter()
    repr_text = ''
    error = ''
    with cap:
        try:
            if not code.strip():
                error = '命令是空的'
            else:
                repr_text = _exec_statement(code, ns)
        except BaseException as exc:
            error = _fmt_error(exc)
    ms = int((time.perf_counter() - started) * 1000)
    return {
        'repr': repr_text,
        'stdout': ''.join(cap.out),
        'stderr': ''.join(cap.err),
        'error': error,
        'ms': ms,
        'vars': _vars_of(ns),
        'preloadError': preload_error,
    }


# ---------------------------------------------------------------- 动作：查变量


def _inspect(payload: dict) -> dict:
    sid = str(payload.get('session') or 'default')
    session = _SESSIONS.get(sid)
    if not session or session.get('ns') is None:
        return {'vars': []}
    return {'vars': _vars_of(session['ns'])}


def _reset(payload: dict) -> dict:
    sid = str(payload.get('session') or 'default')
    _SESSIONS.pop(sid, None)
    return {'vars': []}


# ---------------------------------------------------------------- 动作：单步追踪


class _TraceStop(BaseException):
    """达到步数上限时从 tracer 里抛出来，主动停表。

    继承 BaseException 而不是 Exception：用户代码里常见 `try: ... except Exception:`
    （比如自己写的递归兜底），如果继承 Exception，这个「停表信号」会被用户吞掉。
    """


def _trace(payload: dict) -> dict:
    code = str(payload.get('code') or '')
    call = str(payload.get('call') or '')
    prelude = str(payload.get('prelude') or '')
    ns = _new_ns(prelude)
    lines = code.splitlines()
    steps: list[dict] = []
    state = {'depth': 0, 'truncated': False}
    repr_text = ''
    error = ''

    def local_tracer(frame, event, arg):  # type: ignore[no-untyped-def]
        if event == 'line':
            if len(steps) >= MAX_STEPS:
                state['truncated'] = True
                raise _TraceStop()
            lineno = frame.f_lineno
            source = lines[lineno - 1].strip() if 0 < lineno <= len(lines) else ''
            locals_row = [
                {'name': key, 'repr': _safe_repr(value)}
                for key, value in frame.f_locals.items()
                if not key.startswith('__')
            ]
            steps.append(
                {
                    'line': lineno,
                    'code': source,
                    # 最外层函数记 0（global_tracer 在 call 时先加过 1）
                    'depth': max(state['depth'] - 1, 0),
                    'locals': locals_row,
                }
            )
        elif event == 'return':
            state['depth'] = max(state['depth'] - 1, 0)
        return local_tracer

    def global_tracer(frame, event, arg):  # type: ignore[no-untyped-def]
        # 只追踪用户代码里的函数（模块顶层那一帧没意思，跳过）
        if event == 'call' and frame.f_code.co_filename == '<用户代码>':
            if frame.f_code.co_name == '<module>':
                return None
            # ListNode / TreeNode 的 __init__ 是构造噪音，不是算法本身，跳过
            qualname = getattr(frame.f_code, 'co_qualname', frame.f_code.co_name)
            if qualname.startswith(('ListNode.', 'TreeNode.')):
                return None
            state['depth'] += 1
            return local_tracer
        return None

    cap = _Capture()
    with cap:
        try:
            exec(compile(code, '<用户代码>', 'exec'), ns)
            if not call.strip():
                error = '这条用例没有调用表达式，没法追踪'
            else:
                sys.settrace(global_tracer)
                try:
                    value = eval(compile(call, '<用例>', 'eval'), ns)
                    repr_text = _safe_repr(value)
                except _TraceStop:
                    pass
                finally:
                    sys.settrace(None)
        except _TraceStop:
            pass
        except BaseException as exc:
            error = _fmt_error(exc)
        finally:
            sys.settrace(None)

    return {
        'steps': steps,
        'repr': repr_text,
        'stdout': ''.join(cap.out),
        'stderr': ''.join(cap.err),
        'error': error,
        'truncated': state['truncated'],
    }


# ---------------------------------------------------------------- 分发


_HANDLERS = {
    'runCases': _run_cases,
    'exec': _exec,
    'inspect': _inspect,
    'reset': _reset,
    'trace': _trace,
}


def __lc_dispatch__(raw: str) -> str:
    """Worker 唯一入口：收 JSON 字符串，回 JSON 字符串。"""
    try:
        payload = json.loads(raw)
    except BaseException as exc:
        return json.dumps({'ok': False, 'error': f'请求解析失败：{exc}'}, ensure_ascii=False)
    kind = str(payload.get('kind') or '')
    handler = _HANDLERS.get(kind)
    if handler is None:
        return json.dumps({'ok': False, 'error': f'未知操作：{kind}'}, ensure_ascii=False)
    try:
        data = handler(payload)
    except BaseException as exc:
        return json.dumps({'ok': False, 'error': _fmt_error(exc)}, ensure_ascii=False)
    return json.dumps({'ok': True, **data}, ensure_ascii=False)
