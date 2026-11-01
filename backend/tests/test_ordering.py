import random

import pytest

from app.core.ordering import FIRST_KEY, OrderKeyError, key_after, key_between


# 用例来自 rocicorp/fractional-indexing 的测试集（base 62）
@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        (None, None, "a0"),
        (None, "a0", "Zz"),
        (None, "Zz", "Zy"),
        ("a0", None, "a1"),
        ("a1", None, "a2"),
        ("a0", "a1", "a0V"),
        ("a1", "a2", "a1V"),
        ("a0V", "a1", "a0l"),
        ("Zz", "a0", "ZzV"),
        ("Zz", "a1", "a0"),
        (None, "Y00", "Xzzz"),
        ("bzz", None, "c000"),
        ("a0", "a0V", "a0G"),
        ("a0", "a0G", "a08"),
        ("b125", "b129", "b127"),
        ("a0", "a1V", "a1"),
        ("Zz", "a01", "a0"),
        (None, "a0V", "a0"),
        (None, "b999", "b99"),
        (None, "A000000000000000000000000001", "A000000000000000000000000000V"),
        ("zzzzzzzzzzzzzzzzzzzzzzzzzzy", None, "zzzzzzzzzzzzzzzzzzzzzzzzzzz"),
        ("zzzzzzzzzzzzzzzzzzzzzzzzzzz", None, "zzzzzzzzzzzzzzzzzzzzzzzzzzzV"),
    ],
)
def test_known_keys(a: str | None, b: str | None, expected: str) -> None:
    assert key_between(a, b) == expected


@pytest.mark.parametrize(
    ("a", "b"),
    [
        (None, "A00000000000000000000000000"),  # 最小的整数部分本身不是合法 key
        ("a00", None),  # 小数部分以 0 结尾
        ("a00", "a1"),
        ("0", "1"),  # 首字符不合法
        ("a1", "a0"),  # a >= b
        ("a1", "a1"),
        ("a", None),  # 整数部分长度不够
        ("a0!", None),  # 非法字符
    ],
)
def test_invalid_input(a: str | None, b: str | None) -> None:
    with pytest.raises(OrderKeyError):
        key_between(a, b)


def test_random_inserts_keep_order() -> None:
    rng = random.Random(42)
    for _ in range(200):
        keys: list[str] = []
        for _ in range(50):
            i = rng.randint(0, len(keys))
            a = keys[i - 1] if i > 0 else None
            b = keys[i] if i < len(keys) else None
            key = key_between(a, b)
            assert a is None or a < key
            assert b is None or key < b
            keys.insert(i, key)
        assert keys == sorted(keys)
        assert len(set(keys)) == len(keys)


def test_appending_keeps_keys_short() -> None:
    key = FIRST_KEY
    for _ in range(10_000):
        key = key_after(key)
    # 整数部分递增：一万次追加后仍然只有几个字符
    assert len(key) <= 4

    key = FIRST_KEY
    for _ in range(10_000):
        key = key_between(None, key)
    assert len(key) <= 4
