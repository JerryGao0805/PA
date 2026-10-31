import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

# argon2id，参数使用 argon2-cffi 的默认值（符合 RFC 9106 的低内存推荐配置）
_hasher = PasswordHasher()

# 用户不存在时也跑一次哈希校验，让「邮箱不存在」和「密码错误」耗时一致，防止通过响应时间枚举账号
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    """校验密码。password_hash 为 None 表示用户不存在，仍会执行一次等耗时的校验。"""
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    """哈希参数升级后，用户下次登录时用新参数重新哈希。"""
    return _hasher.check_needs_rehash(password_hash)


def generate_token() -> str:
    """生成 32 字节（256 位）的 URL 安全随机 token，用于 Cookie 和邮件链接。"""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """数据库只存 token 的 SHA-256。token 本身是高熵随机值，不需要加盐或慢哈希。

    按哈希值做等值查询，不涉及逐字节比较原始 token，因此不存在时序侧信道。
    """
    return hashlib.sha256(token.encode()).hexdigest()
