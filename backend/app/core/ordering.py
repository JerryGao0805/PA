"""排序 key（fractional indexing）。

列表里每一行都有一个字符串 sort_key，按字节序排列。插入或拖动时只给这一行生成一个
介于前后两个 key 之间的新 key，不需要给整列重新编号。

算法移植自 https://github.com/rocicorp/fractional-indexing（CC0）。
key = 整数部分 + 小数部分：整数部分的首字符表示它的长度（a 是 2 位、b 是 3 位……，
A–Z 表示负数）。在末尾追加时只递增整数部分，所以连续追加时 key 的长度按对数增长。

数据库里的 sort_key 列必须用 COLLATE "C"（按字节比较），否则 'B' 和 'a' 的先后顺序
会随数据库的 locale 变化，和这里的比较结果不一致。
"""

DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
_ZERO = DIGITS[0]
_SMALLEST_INTEGER = "A" + _ZERO * 26

FIRST_KEY = "a" + _ZERO


class OrderKeyError(ValueError):
    pass


def _midpoint(a: str, b: str | None) -> str:
    """返回严格介于 a 和 b 之间的小数部分。a 可以为空，b 为 None 表示正无穷；都不能以 0 结尾。"""
    if b:
        # 去掉公共前缀（a 较短时视为在末尾补 0）
        n = 0
        while n < len(b) and (a[n] if n < len(a) else _ZERO) == b[n]:
            n += 1
        if n > 0:
            return b[:n] + _midpoint(a[n:], b[n:])

    digit_a = DIGITS.index(a[0]) if a else 0
    digit_b = DIGITS.index(b[0]) if b is not None else len(DIGITS)
    if digit_b - digit_a > 1:
        return DIGITS[(digit_a + digit_b + 1) // 2]
    # 首位相邻：b 有多位时取 b 的首位即可；否则保留 a 的首位，在后面继续找中点
    if b is not None and len(b) > 1:
        return b[0]
    return DIGITS[digit_a] + _midpoint(a[1:], None)


def _integer_length(head: str) -> int:
    if "a" <= head <= "z":
        return ord(head) - ord("a") + 2
    if "A" <= head <= "Z":
        return ord("Z") - ord(head) + 2
    raise OrderKeyError(f"invalid order key head: {head!r}")


def _integer_part(key: str) -> str:
    length = _integer_length(key[0])
    if length > len(key):
        raise OrderKeyError(f"invalid order key: {key!r}")
    return key[:length]


def validate_key(key: str) -> None:
    if not key or key == _SMALLEST_INTEGER:
        raise OrderKeyError(f"invalid order key: {key!r}")
    integer = _integer_part(key)
    if key[len(integer) :].endswith(_ZERO):
        raise OrderKeyError(f"invalid order key: {key!r}")
    if any(c not in DIGITS for c in key[1:]):
        raise OrderKeyError(f"invalid order key: {key!r}")


def _increment_integer(x: str) -> str | None:
    head, digits = x[0], list(x[1:])
    for i in reversed(range(len(digits))):
        d = DIGITS.index(digits[i]) + 1
        if d < len(DIGITS):
            digits[i] = DIGITS[d]
            return head + "".join(digits)
        digits[i] = _ZERO
    # 进位溢出：换成更长（或更短的负数）的整数部分
    if head == "Z":
        return "a" + _ZERO
    if head == "z":
        return None
    new_head = chr(ord(head) + 1)
    if new_head > "a":
        digits.append(_ZERO)
    else:
        digits.pop()
    return new_head + "".join(digits)


def _decrement_integer(x: str) -> str | None:
    head, digits = x[0], list(x[1:])
    for i in reversed(range(len(digits))):
        d = DIGITS.index(digits[i]) - 1
        if d >= 0:
            digits[i] = DIGITS[d]
            return head + "".join(digits)
        digits[i] = DIGITS[-1]
    if head == "a":
        return "Z" + DIGITS[-1]
    if head == "A":
        return None
    new_head = chr(ord(head) - 1)
    if new_head < "Z":
        digits.append(DIGITS[-1])
    else:
        digits.pop()
    return new_head + "".join(digits)


def key_between(a: str | None, b: str | None) -> str:
    """生成一个满足 a < key < b 的 key。a 为 None 表示开头，b 为 None 表示末尾。"""
    if a is not None:
        validate_key(a)
    if b is not None:
        validate_key(b)
    if a is not None and b is not None and a >= b:
        raise OrderKeyError(f"{a!r} >= {b!r}")

    if a is None:
        if b is None:
            return FIRST_KEY
        ib = _integer_part(b)
        fb = b[len(ib) :]
        if ib == _SMALLEST_INTEGER:
            return ib + _midpoint("", fb)
        if ib < b:
            return ib
        res = _decrement_integer(ib)
        if res is None:
            raise OrderKeyError("cannot decrement any more")
        return res

    ia = _integer_part(a)
    fa = a[len(ia) :]
    if b is None:
        i = _increment_integer(ia)
        return ia + _midpoint(fa, None) if i is None else i

    ib = _integer_part(b)
    fb = b[len(ib) :]
    if ia == ib:
        return ia + _midpoint(fa, fb)
    i = _increment_integer(ia)
    if i is None:
        raise OrderKeyError("cannot increment any more")
    if i < b:
        return i
    return ia + _midpoint(fa, None)


def key_after(last: str | None) -> str:
    """追加到末尾时用的 key。"""
    return key_between(last, None)
