import base64
import html
import hashlib
import hmac
import json
import os
import re
import secrets
from sqlalchemy.exc import IntegrityError
from mysql_runtime import required_url, engine_for, platform_connection
from platform_schema import initialize_schema
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


USER_STATUSES = {"pending", "enabled", "disabled"}
PLATFORM_ROLES = {"super_admin", "admin", "user"}
ADMIN_ROLES = {"super_admin", "admin"}
USAGE_CATEGORIES = {"image", "video", "chat", "workflow"}
DEFAULT_PRICING = {"image": 1, "video": 10, "chat": 1, "workflow": 1}
try:
    ANALYTICS_TIMEZONE = ZoneInfo("Asia/Shanghai")
except ZoneInfoNotFoundError:
    # Windows does not ship the IANA timezone database. Keep the admin site
    # available before dependencies are refreshed; Shanghai has used UTC+8
    # without daylight-saving changes since 1991.
    ANALYTICS_TIMEZONE = timezone(timedelta(hours=8), name="Asia/Shanghai")
ANALYTICS_ERROR_LABELS = {
    "rate_limit": "\u9650\u6d41",
    "auth_config": "\u8ba4\u8bc1/\u914d\u7f6e",
    "network_timeout": "\u7f51\u7edc/\u8d85\u65f6",
    "validation": "\u53c2\u6570\u6821\u9a8c",
    "upstream": "\u4e0a\u6e38\u670d\u52a1",
    "unknown": "\u672a\u77e5\u9519\u8bef",
}
USAGE_CATEGORY_LABELS = {
    "image": "图片",
    "video": "视频",
    "chat": "对话",
    "workflow": "工作流",
}
USAGE_STATUS_LABELS = {
    "reserved": "处理中",
    "succeeded": "成功",
    "failed": "失败",
    "refunded": "已退还",
}
USAGE_OPERATION_METADATA = {
    "online-image": ("在线生图", "图片生成"),
    "canvas-image": ("无限画布", "图片生成"),
    "canvas-video": ("无限画布", "视频生成"),
    "canvas-llm": ("无限画布", "AI 文本节点"),
    "chat": ("GPT 对话", "消息回复"),
    "chat-stream": ("GPT 对话", "流式消息回复"),
    "angle-generate": ("角度控制", "多角度图片生成"),
    "zimage-cloud": ("在线生图", "Z-Image 图片生成"),
    "modelscope-image": ("在线生图", "ModelScope 图片生成"),
    "workflow-test": ("工作流设置", "工作流测试"),
    "workbench-plan": ("设计智能体", "需求分析与方案"),
    "workbench-plan-followup": ("设计智能体", "澄清分析"),
    "workbench-review": ("设计智能体", "质量复核"),
    "workbench-marker-label": ("设计智能体", "画面标记识别"),
    "ppt-ai-chat": ("PPT", "AI 数据检查"),
    "ppt-ai-image": ("PPT", "场景图片生成"),
}
ROLE_PERMISSIONS = {
    "user": ["use_products"],
    "admin": [
        "use_products",
        "manage_settings",
        "manage_users",
        "manage_credits",
    ],
    "super_admin": [
        "use_products",
        "manage_settings",
        "manage_users",
        "manage_credits",
        "manage_roles",
        "manage_pricing",
        "manage_admin_lifecycle",
    ],
}


def usage_feature_metadata(category, operation):
    category = str(category or "").strip().lower()
    operation = str(operation or "").strip()
    if operation == "chat-agent":
        surface, feature = (
            ("设计智能体", "图片生成或修改")
            if category == "image"
            else ("GPT 对话", "Agent 对话")
        )
    elif operation in USAGE_OPERATION_METADATA:
        surface, feature = USAGE_OPERATION_METADATA[operation]
    elif category == "workflow":
        surface, feature = "工作流", operation or "工作流执行"
    elif operation.startswith("canvas-"):
        surface, feature = "无限画布", operation.removeprefix("canvas-") or "画布任务"
    else:
        surface = USAGE_CATEGORY_LABELS.get(category, "其他功能")
        feature = operation or f"{surface}任务"
    return {
        "feature_key": f"{category}:{operation or 'unknown'}",
        "surface_label": surface,
        "feature_label": feature,
        "category_label": USAGE_CATEGORY_LABELS.get(category, category or "未知"),
    }


def enrich_usage_row(row):
    result = dict(row)
    charged = max(0, int(result.get("charged_points") or 0))
    debited = max(0, int(result.get("debited_points") or 0))
    refunded = max(0, int(result.get("refunded_points") or 0))
    # Rows created before upfront charging have no debit snapshot. Preserve
    # their historical successful usage without inventing refund entries.
    if debited == 0 and charged > 0:
        debited = charged
    result["debited_points"] = debited
    result["refunded_points"] = refunded
    result["net_points"] = charged
    result.update(usage_feature_metadata(result.get("category"), result.get("operation")))
    result["status_label"] = USAGE_STATUS_LABELS.get(
        str(result.get("status") or ""),
        str(result.get("status") or ""),
    )
    created_at = int(result.get("created_at") or 0)
    completed_at = int(result.get("completed_at") or 0)
    result["duration_ms"] = max(0, completed_at - created_at) if completed_at else None
    return result


def _sanitize_analytics_error(value, limit=180):
    """Return a short, human-readable sample without credentials or HTML."""
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", text)
    sensitive_patterns = (
        r"(?i)(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+",
        r"(?i)((?:api[_-]?key|token|secret|password|credential)\s*[:=]\s*)[^\s,;]+",
    )
    for pattern in sensitive_patterns:
        text = re.sub(pattern, r"\1[REDACTED]", text)
    text = re.sub(r"\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b", "[REDACTED]", text)
    text = re.sub(r"\b[A-Za-z0-9_-]{32,}\b", "[REDACTED]", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > int(limit):
        text = text[: max(1, int(limit) - 1)].rstrip() + "\u2026"
    return text


def _classify_analytics_error(value):
    text = str(value or "").lower()
    rules = (
        ("rate_limit", ("429", "too many request", "rate limit", "rate-limit", "quota", "\u9650\u6d41")),
        ("auth_config", ("401", "403", "unauthorized", "forbidden", "api key", "apikey", "credential", "auth", "config", "\u8ba4\u8bc1", "\u5bc6\u94a5", "\u914d\u7f6e")),
        ("network_timeout", ("timeout", "timed out", "network", "tls", "ssl", "connect", "disconnect", "dns", "\u7f51\u7edc", "\u8d85\u65f6")),
        ("validation", ("400", "422", "validation", "invalid", "parameter", "pydantic", "\u53c2\u6570", "\u6821\u9a8c")),
        ("upstream", ("500", "502", "503", "504", "bad gateway", "service unavailable", "upstream", "provider", "\u4e0a\u6e38", "\u670d\u52a1\u4e0d\u53ef\u7528")),
    )
    for key, needles in rules:
        if any(needle in text for needle in needles):
            return key
    return "unknown"


class PlatformStoreError(Exception):
    def __init__(self, message, code="platform_error", status_code=400, **extra):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.extra = extra


class UsageReservationResult(tuple):
    """Two-item compatible result with transient recovery metadata."""
    def __new__(cls, event_id, created, prior_status=""):
        value = super().__new__(cls, (event_id, bool(created)))
        value.prior_status = str(prior_status or "")
        return value


class PlatformStore:
    def __init__(self, db_path, legacy_auth_path, session_max_age=7 * 24 * 60 * 60):
        self.engine = engine_for(required_url())
        self.db_path = str(self.engine.url.database)
        self.legacy_auth_path = os.path.abspath(legacy_auth_path)
        self.session_max_age = int(session_max_age)

    @contextmanager
    def connect(self, immediate=False):
        with platform_connection(self.engine, immediate=immediate) as connection:
            yield connection

    def initialize(self):
        initialize_schema(self.engine)
        with self.connect(immediate=True) as connection:
            now = self.now_ms()
            for category, unit_cost in DEFAULT_PRICING.items():
                connection.execute(
                    'INSERT INTO platform_pricing(category, unit_cost, updated_at) VALUES(?, ?, ?) ON DUPLICATE KEY UPDATE category=category',
                    (category, unit_cost, now),
                )
            self._ensure_meta(connection, "user_session_secret", secrets.token_urlsafe(48))
            self._ensure_meta(connection, "admin_session_secret", secrets.token_urlsafe(48))
            self._migrate_admin_accounts(connection)
            # An old reservation can belong to a live approval/Temporal run.
            # Only the result reconciliation path may settle it, never startup age.

    @staticmethod
    def now_ms():
        return int(time.time() * 1000)

    @staticmethod
    def password_hash(password, salt, iterations=310000):
        return hashlib.pbkdf2_hmac(
            "sha256",
            str(password or "").encode("utf-8"),
            bytes.fromhex(str(salt or "")),
            int(iterations or 310000),
        ).hex()

    @classmethod
    def password_record(cls, password):
        salt = secrets.token_hex(16)
        iterations = 310000
        return salt, cls.password_hash(password, salt, iterations), iterations

    def _ensure_meta(self, connection, key, value):
        connection.execute('INSERT INTO platform_meta(`key`, value) VALUES(?, ?) ON DUPLICATE KEY UPDATE `key`=`key`', (key, value))

    def _meta(self, connection, key):
        row = connection.execute('SELECT value FROM platform_meta WHERE `key`=?', (key,)).fetchone()
        return str(row["value"] if row else "")

    def _legacy_users(self):
        try:
            with open(self.legacy_auth_path, "r", encoding="utf-8") as file:
                config = json.load(file)
        except Exception:
            return [], ""
        users = config.get("users") if isinstance(config, dict) else []
        if not isinstance(users, list):
            users = []
        if not users and config.get("username") and config.get("password_hash"):
            users = [{
                "username": config.get("username"),
                "password_salt": config.get("password_salt"),
                "password_hash": config.get("password_hash"),
                "password_iterations": config.get("password_iterations"),
                "role": "admin",
                "created_at": config.get("created_at"),
            }]
        return [item for item in users if isinstance(item, dict)], str(config.get("session_secret") or "")

    def _migrate_legacy(self, connection):
        if self._meta(connection, "legacy_migration_complete") == "1":
            return
        users, legacy_secret = self._legacy_users()
        now = self.now_ms()
        for item in users:
            username = str(item.get("username") or "").strip()
            password_hash = str(item.get("password_hash") or "")
            password_salt = str(item.get("password_salt") or "")
            if not username or not password_hash or not password_salt:
                continue
            created_at = int(item.get("created_at") or now)
            iterations = int(item.get("password_iterations") or 310000)
            if str(item.get("role") or "member").lower() == "admin":
                connection.execute(
                    'INSERT INTO platform_admins\n                       (username, password_salt, password_hash, password_iterations, created_at, updated_at)\n                       VALUES(?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE username=username',
                    (username, password_salt, password_hash, iterations, created_at, now),
                )
            else:
                connection.execute(
                    "INSERT INTO platform_users\n                       (username, password_salt, password_hash, password_iterations, status, credit_balance, created_at, updated_at)\n                       VALUES(?, ?, ?, ?, 'pending', 0, ?, ?) ON DUPLICATE KEY UPDATE username=username",
                    (username, password_salt, password_hash, iterations, created_at, now),
                )
        if legacy_secret:
            connection.execute(
                "UPDATE platform_meta SET value=? WHERE `key`='user_session_secret'",
                (legacy_secret,),
            )
        connection.execute(
            "INSERT INTO platform_meta(`key`, value) VALUES('legacy_migration_complete', '1') ON DUPLICATE KEY UPDATE value=VALUES(value)"
        )

    def _migrate_admin_accounts(self, connection):
        """Copy legacy admins into the unified account table without deleting compatibility data."""
        if self._meta(connection, "unified_admin_migration_complete") == "1":
            return
        now = self.now_ms()
        admins = connection.execute(
            "SELECT * FROM platform_admins ORDER BY id"
        ).fetchall()
        for legacy in admins:
            conflict = connection.execute(
                'SELECT id, role FROM platform_users WHERE username=? COLLATE utf8mb4_0900_as_ci',
                (legacy["username"],),
            ).fetchone()
            if conflict:
                raise PlatformStoreError(
                    f"管理员迁移遇到同名平台账号：{legacy['username']}",
                    "admin_username_conflict",
                    409,
                )
            connection.execute(
                """INSERT INTO platform_users
                   (username, password_salt, password_hash, password_iterations, role, status,
                    credit_balance, created_at, updated_at, approved_at, last_login_at)
                   VALUES(?, ?, ?, ?, 'super_admin', 'enabled', 0, ?, ?, ?, ?)""",
                (
                    legacy["username"],
                    legacy["password_salt"],
                    legacy["password_hash"],
                    legacy["password_iterations"],
                    legacy["created_at"],
                    now,
                    now,
                    legacy["last_login_at"],
                ),
            )
        connection.execute(
            "INSERT INTO platform_meta(`key`, value) VALUES('unified_admin_migration_complete', '1') ON DUPLICATE KEY UPDATE value=VALUES(value)"
        )

    @staticmethod
    def permissions_for_role(role):
        return list(ROLE_PERMISSIONS.get(str(role or "user"), ROLE_PERMISSIONS["user"]))

    def admin_count(self):
        with self.connect() as connection:
            return int(connection.execute(
                "SELECT COUNT(*) AS n FROM platform_users WHERE role IN ('super_admin','admin')"
            ).fetchone()["n"])

    def user_count(self):
        with self.connect() as connection:
            return int(connection.execute(
                "SELECT COUNT(*) AS n FROM platform_users WHERE role='user'"
            ).fetchone()["n"])

    def _account(self, table, username):
        with self.connect() as connection:
            row = connection.execute(f"SELECT * FROM {table} WHERE username=? COLLATE utf8mb4_0900_as_ci", (username,)).fetchone()
            return dict(row) if row else None

    def user(self, username):
        return self._account("platform_users", username)

    def admin(self, username):
        account = self.user(username)
        return account if account and account.get("role") in ADMIN_ROLES else None

    def create_admin(self, username, password):
        salt, password_hash, iterations = self.password_record(password)
        now = self.now_ms()
        with self.connect(immediate=True) as connection:
            if connection.execute(
                "SELECT 1 FROM platform_users WHERE role IN ('super_admin','admin') LIMIT 1"
            ).fetchone():
                raise PlatformStoreError("管理员账户已经创建", "admin_exists", 409)
            try:
                connection.execute(
                    """INSERT INTO platform_users
                       (username, password_salt, password_hash, password_iterations, role, status,
                        credit_balance, created_at, updated_at, approved_at)
                       VALUES(?, ?, ?, ?, 'super_admin', 'enabled', 0, ?, ?, ?)""",
                    (username, salt, password_hash, iterations, now, now, now),
                )
            except IntegrityError as exc:
                raise PlatformStoreError("该用户名已被使用", "username_exists", 409) from exc
        return self.admin(username)

    def create_user(self, username, password):
        salt, password_hash, iterations = self.password_record(password)
        now = self.now_ms()
        with self.connect(immediate=True) as connection:
            try:
                connection.execute(
                    """INSERT INTO platform_users
                       (username, password_salt, password_hash, password_iterations, role, status,
                        credit_balance, created_at, updated_at)
                       VALUES(?, ?, ?, ?, 'user', 'pending', 0, ?, ?)""",
                    (username, salt, password_hash, iterations, now, now),
                )
            except IntegrityError as exc:
                raise PlatformStoreError("用户名已存在，请更换用户名", "username_exists", 409) from exc
        return self.user(username)

    def create_auth_hub_login_intent(self, intent, return_to, ttl_seconds=300):
        now = self.now_ms()
        intent_hash = hashlib.sha256(str(intent).encode("utf-8")).hexdigest()
        with self.connect(immediate=True) as connection:
            connection.execute(
                "DELETE FROM auth_hub_login_intents WHERE expires_at < ? OR consumed_at IS NOT NULL",
                (now,),
            )
            connection.execute(
                """INSERT INTO auth_hub_login_intents
                   (intent_hash, return_to, created_at, expires_at, consumed_at)
                   VALUES(?, ?, ?, ?, NULL)""",
                (intent_hash, str(return_to or "/"), now, now + int(ttl_seconds) * 1000),
            )

    def consume_auth_hub_login_intent(self, intent):
        now = self.now_ms()
        intent_hash = hashlib.sha256(str(intent or "").encode("utf-8")).hexdigest()
        with self.connect(immediate=True) as connection:
            row = connection.execute(
                """SELECT return_to FROM auth_hub_login_intents
                   WHERE intent_hash=? AND consumed_at IS NULL AND expires_at>=?""",
                (intent_hash, now),
            ).fetchone()
            if not row:
                return None
            updated = connection.execute(
                """UPDATE auth_hub_login_intents SET consumed_at=?
                   WHERE intent_hash=? AND consumed_at IS NULL""",
                (now, intent_hash),
            ).rowcount
            return str(row["return_to"]) if updated == 1 else None

    @staticmethod
    def _auth_hub_username(connection, employee_no, display_name=""):
        clean_name = re.sub(r'[\x00-\x1f/\\:*?"<>|]', "", str(display_name or "").strip())[:40]
        base = f"{clean_name or '员工'}_{employee_no}"
        candidate = base
        suffix = 1
        while connection.execute(
            'SELECT 1 FROM platform_users WHERE username=? COLLATE utf8mb4_0900_as_ci',
            (candidate,),
        ).fetchone():
            suffix += 1
            candidate = f"{base}_{suffix}"
        return candidate

    def authenticate_auth_hub_identity(
        self,
        employee_no,
        display_name="",
        subject="",
        wecom_userid="",
        role="user",
        ip_address="",
    ):
        employee_no = str(employee_no or "").strip()
        display_name = str(display_name or "").strip()[:80]
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,32}", employee_no):
            raise PlatformStoreError("企业身份缺少有效工号", "invalid_employee_no", 401)
        role = str(role or "user")
        if role not in PLATFORM_ROLES:
            role = "user"
        now = self.now_ms()
        with self.connect(immediate=True) as connection:
            binding = connection.execute(
                """SELECT * FROM auth_hub_identity_bindings
                   WHERE provider='auth_hub' AND employee_no=?""",
                (employee_no,),
            ).fetchone()
            if binding:
                if binding["status"] != "enabled":
                    raise PlatformStoreError("企业身份已被禁用", "sso_identity_disabled", 403)
                user = connection.execute(
                    "SELECT * FROM platform_users WHERE id=?",
                    (binding["local_user_id"],),
                ).fetchone()
                if not user or user["status"] != "enabled":
                    raise PlatformStoreError("关联账号未启用", "account_disabled", 403)
                connection.execute(
                    """UPDATE platform_users
                       SET employee_no=?, display_name=?, last_login_at=?, updated_at=?
                       WHERE id=?""",
                    (employee_no, display_name, now, now, user["id"]),
                )
                connection.execute(
                    """UPDATE auth_hub_identity_bindings
                       SET subject=?, wecom_userid=?, updated_at=? WHERE id=?""",
                    (str(subject or ""), str(wecom_userid or ""), now, binding["id"]),
                )
                username = str(user["username"])
                local_role = str(user["role"] or "user")
                action = "auth_hub.login"
            else:
                prebound = connection.execute(
                    "SELECT * FROM platform_users WHERE employee_no=?",
                    (employee_no,),
                ).fetchone()
                if prebound:
                    if prebound["status"] != "enabled":
                        raise PlatformStoreError("关联账号未启用", "account_disabled", 403)
                    user_id = int(prebound["id"])
                    username = str(prebound["username"])
                    local_role = str(prebound["role"] or "user")
                    connection.execute(
                        """UPDATE platform_users
                           SET display_name=?, last_login_at=?, updated_at=? WHERE id=?""",
                        (display_name, now, now, user_id),
                    )
                    bound_by = "employee_prebind"
                    action = "auth_hub.prebound_login"
                else:
                    username = self._auth_hub_username(connection, employee_no, display_name)
                    salt, password_hash, iterations = self.password_record(secrets.token_urlsafe(48))
                    cursor = connection.execute(
                        """INSERT INTO platform_users
                           (username, password_salt, password_hash, password_iterations, role, status,
                            credit_balance, employee_no, display_name, created_at, updated_at,
                            approved_at, last_login_at)
                           VALUES(?, ?, ?, ?, ?, 'enabled', 0, ?, ?, ?, ?, ?, ?)""",
                        (
                            username,
                            salt,
                            password_hash,
                            iterations,
                            "user",
                            employee_no,
                            display_name,
                            now,
                            now,
                            now,
                            now,
                        ),
                    )
                    user_id = int(cursor.lastrowid)
                    bound_by = "auth_hub"
                    local_role = "user"
                    action = "auth_hub.account_created"
                connection.execute(
                    """INSERT INTO auth_hub_identity_bindings
                       (provider, employee_no, local_user_id, subject, wecom_userid, status,
                        bound_by, bound_at, updated_at)
                       VALUES('auth_hub', ?, ?, ?, ?, 'enabled', ?, ?, ?)""",
                    (
                        employee_no,
                        user_id,
                        str(subject or ""),
                        str(wecom_userid or ""),
                        bound_by,
                        now,
                        now,
                    ),
                )
            connection.execute(
                """INSERT INTO platform_audit_events
                   (id, actor_username, actor_role, action, target_type, target_id,
                    field_name, result, ip_address, created_at)
                   VALUES(?, ?, ?, ?, 'platform_user', ?, 'employee_no', 'success', ?, ?)""",
                (
                    uuid.uuid4().hex,
                    username,
                    local_role,
                    action,
                    employee_no,
                    str(ip_address or ""),
                    now,
                ),
            )
        return self.user(username)

    def _verify(self, account, password):
        if not account:
            return False
        try:
            supplied = self.password_hash(password, account["password_salt"], account["password_iterations"])
        except Exception:
            supplied = ""
        return hmac.compare_digest(supplied, str(account.get("password_hash") or ""))

    def verify_account_password(self, username, password):
        """Verify the unified account password without changing login timestamps."""
        return self._verify(self.user(username), password)

    def authenticate_user(self, username, password):
        account = self.user(username)
        if not self._verify(account, password):
            raise PlatformStoreError("用户名或密码不正确", "invalid_credentials", 401)
        status = account.get("status")
        if status == "pending":
            raise PlatformStoreError("账号正在等待管理员审核", "account_pending", 403)
        if status != "enabled":
            raise PlatformStoreError("账号已被管理员禁用", "account_disabled", 403)
        now = self.now_ms()
        with self.connect(immediate=True) as connection:
            connection.execute("UPDATE platform_users SET last_login_at=?, updated_at=? WHERE id=?", (now, now, account["id"]))
        return self.user(username)

    def authenticate_admin(self, username, password):
        account = self.admin(username)
        if not self._verify(account, password):
            raise PlatformStoreError("管理员账号或密码不正确", "invalid_credentials", 401)
        if account.get("status") != "enabled":
            raise PlatformStoreError("管理员账号已被禁用", "account_disabled", 403)
        now = self.now_ms()
        with self.connect(immediate=True) as connection:
            connection.execute(
                "UPDATE platform_users SET last_login_at=?, updated_at=? WHERE id=?",
                (now, now, account["id"]),
            )
        return self.admin(username)

    def _session_secret(self, kind):
        key = "admin_session_secret" if kind == "admin" else "user_session_secret"
        with self.connect() as connection:
            return self._meta(connection, key)

    def session_token(self, kind, username):
        payload = {
            "kind": kind,
            "username": str(username or ""),
            "expires_at": int(time.time()) + self.session_max_age,
            "nonce": secrets.token_hex(8),
        }
        encoded = base64.urlsafe_b64encode(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ).decode("ascii").rstrip("=")
        signature = hmac.new(self._session_secret(kind).encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).hexdigest()
        return f"{encoded}.{signature}"

    def session_account(self, kind, token, require_enabled=True):
        if not token:
            return None
        try:
            encoded, supplied = str(token).rsplit(".", 1)
            expected = hmac.new(self._session_secret(kind).encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(supplied, expected):
                return None
            padding = "=" * (-len(encoded) % 4)
            payload = json.loads(base64.urlsafe_b64decode(encoded + padding).decode("utf-8"))
            if payload.get("kind") != kind or int(payload.get("expires_at") or 0) <= int(time.time()):
                return None
            account = self.admin(payload.get("username")) if kind == "admin" else self.user(payload.get("username"))
            if not account:
                return None
            if require_enabled and account.get("status") != "enabled":
                return None
            return account
        except Exception:
            return None

    def user_balance(self, user_id):
        with self.connect() as connection:
            row = connection.execute(
                """SELECT u.credit_balance,
                          COALESCE(SUM(CASE WHEN e.status='reserved' THEN e.reserved_points ELSE 0 END), 0) AS reserved
                   FROM platform_users u
                   LEFT JOIN platform_usage_events e ON e.user_id=u.id
                   WHERE u.id=? GROUP BY u.id""",
                (user_id,),
            ).fetchone()
        if not row:
            return {"balance": 0, "reserved": 0, "available": 0}
        balance = int(row["credit_balance"] or 0)
        reserved = int(row["reserved"] or 0)
        return {"balance": balance, "reserved": reserved, "available": balance}

    def update_admin_account(self, current_username, username=None, password=None):
        now = self.now_ms()
        with self.connect(immediate=True) as connection:
            account = connection.execute(
                "SELECT * FROM platform_users\n                   WHERE username=? COLLATE utf8mb4_0900_as_ci AND role IN ('super_admin','admin')",
                (current_username,),
            ).fetchone()
            if not account:
                raise PlatformStoreError("管理员不存在", "admin_not_found", 404)
            next_username = str(username or account["username"]).strip()
            values = [next_username, now]
            sql = "UPDATE platform_users SET username=?, updated_at=?"
            if password:
                salt, password_hash, iterations = self.password_record(password)
                sql += ", password_salt=?, password_hash=?, password_iterations=?"
                values.extend([salt, password_hash, iterations])
            sql += " WHERE id=?"
            values.append(account["id"])
            try:
                connection.execute(sql, tuple(values))
            except IntegrityError as exc:
                raise PlatformStoreError("管理员用户名已存在", "username_exists", 409) from exc
        return self.admin(next_username)

    def set_user_status(self, user_id, status, actor_role="super_admin"):
        if status not in USER_STATUSES:
            raise PlatformStoreError("用户状态不合法", "invalid_status", 400)
        now = self.now_ms()
        approved_at = now if status == "enabled" else None
        with self.connect(immediate=True) as connection:
            row = connection.execute(
                "SELECT id, role, status FROM platform_users WHERE id=?", (user_id,)
            ).fetchone()
            if not row:
                raise PlatformStoreError("用户不存在", "user_not_found", 404)
            if row["role"] == "super_admin":
                if actor_role != "super_admin":
                    raise PlatformStoreError(
                        "管理员不能修改超级管理员", "insufficient_role", 403
                    )
                if status != "enabled" and row["status"] == "enabled":
                    enabled_super_admins = int(connection.execute(
                        """SELECT COUNT(*) AS n FROM platform_users
                           WHERE role='super_admin' AND status='enabled'"""
                    ).fetchone()["n"])
                    if enabled_super_admins <= 1:
                        raise PlatformStoreError(
                            "最后一个启用的超级管理员不能被停用",
                            "last_super_admin",
                            409,
                        )
            connection.execute(
                """UPDATE platform_users SET status=?, updated_at=?,
                   approved_at=CASE WHEN ?='enabled' THEN COALESCE(approved_at, ?) ELSE approved_at END
                   WHERE id=?""",
                (status, now, status, approved_at, user_id),
            )
        return self.user_by_id(user_id)

    def set_user_role(self, user_id, role):
        role = str(role or "").strip()
        if role not in PLATFORM_ROLES:
            raise PlatformStoreError("用户角色不合法", "invalid_role", 400)
        if role == "super_admin":
            raise PlatformStoreError(
                "超级管理员不可通过成员管理任命",
                "super_admin_assignment_forbidden",
                403,
            )
        now = self.now_ms()
        with self.connect(immediate=True) as connection:
            user = connection.execute(
                "SELECT id, username, role, status FROM platform_users WHERE id=?",
                (user_id,),
            ).fetchone()
            if not user:
                raise PlatformStoreError("用户不存在", "user_not_found", 404)
            if user["role"] == "super_admin" and role != "super_admin" and user["status"] == "enabled":
                enabled_super_admins = int(connection.execute(
                    """SELECT COUNT(*) AS n FROM platform_users
                       WHERE role='super_admin' AND status='enabled'"""
                ).fetchone()["n"])
                if enabled_super_admins <= 1:
                    raise PlatformStoreError(
                        "最后一个启用的超级管理员不能被降级",
                        "last_super_admin",
                        409,
                    )
            connection.execute(
                "UPDATE platform_users SET role=?, updated_at=? WHERE id=?",
                (role, now, user_id),
            )
        return self.user_by_id(user_id)

    def audit_event(
        self,
        actor_username,
        actor_role,
        action,
        target_type="",
        target_id="",
        field_name="",
        result="success",
        ip_address="",
    ):
        with self.connect(immediate=True) as connection:
            connection.execute(
                """INSERT INTO platform_audit_events
                   (id, actor_username, actor_role, action, target_type, target_id,
                    field_name, result, ip_address, created_at)
                   VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    uuid.uuid4().hex,
                    str(actor_username or "")[:200],
                    str(actor_role or "")[:40],
                    str(action or "")[:120],
                    str(target_type or "")[:80],
                    str(target_id or "")[:200],
                    str(field_name or "")[:120],
                    str(result or "")[:80],
                    str(ip_address or "")[:120],
                    self.now_ms(),
                ),
            )

    def user_by_id(self, user_id):
        with self.connect() as connection:
            row = connection.execute(
                """SELECT id, username, employee_no, display_name, role, status, credit_balance, created_at, updated_at,
                          approved_at, last_login_at, last_active_at
                   FROM platform_users WHERE id=?""",
                (user_id,),
            ).fetchone()
            return dict(row) if row else None

    def legacy_content_owner(self):
        """Resolve one deterministic owner for content created before isolation."""
        configured = str(os.getenv("LEGACY_CONTENT_OWNER_USERNAME") or "").strip()
        with self.connect() as connection:
            if configured:
                row = connection.execute(
                    "SELECT id, username, role, status\n                       FROM platform_users\n                       WHERE username=? COLLATE utf8mb4_0900_as_ci AND status='enabled'",
                    (configured,),
                ).fetchone()
                return dict(row) if row else None
            regular = connection.execute(
                """SELECT id, username, role, status
                   FROM platform_users
                   WHERE status='enabled' AND role='user'
                   ORDER BY id"""
            ).fetchall()
            if len(regular) == 1:
                return dict(regular[0])
            enabled = connection.execute(
                """SELECT id, username, role, status
                   FROM platform_users WHERE status='enabled' ORDER BY id"""
            ).fetchall()
            return dict(enabled[0]) if len(enabled) == 1 else None

    def adjust_credit(self, user_id, admin_username, mode, amount, reason="", actor_role="super_admin"):
        amount = int(amount)
        if mode not in {"add", "subtract", "set"} or amount < 0:
            raise PlatformStoreError("积分调整参数不合法", "invalid_credit_adjustment", 400)
        now = self.now_ms()
        with self.connect(immediate=True) as connection:
            user = connection.execute("SELECT * FROM platform_users WHERE id=?", (user_id,)).fetchone()
            if not user:
                raise PlatformStoreError("用户不存在", "user_not_found", 404)
            if user["role"] == "super_admin" and actor_role != "super_admin":
                raise PlatformStoreError(
                    "管理员不能调整超级管理员积分", "insufficient_role", 403
                )
            current = int(user["credit_balance"] or 0)
            next_balance = amount if mode == "set" else current + (amount if mode == "add" else -amount)
            if next_balance < 0:
                raise PlatformStoreError("积分余额不能小于 0", "negative_balance", 400)
            delta = next_balance - current
            connection.execute("UPDATE platform_users SET credit_balance=?, updated_at=? WHERE id=?", (next_balance, now, user_id))
            connection.execute(
                """INSERT INTO platform_credit_ledger
                   (id, user_id, admin_username, action, delta, balance_after, reason, created_at)
                   VALUES(?, ?, ?, ?, ?, ?, ?, ?)""",
                (uuid.uuid4().hex, user_id, admin_username, mode, delta, next_balance, str(reason or "")[:500], now),
            )
        return {**self.user_by_id(user_id), **self.user_balance(user_id)}

    def pricing(self):
        with self.connect() as connection:
            rows = connection.execute("SELECT category, unit_cost FROM platform_pricing ORDER BY category").fetchall()
        return {row["category"]: int(row["unit_cost"]) for row in rows}

    def model_pricing(self):
        with self.connect() as connection:
            rows = connection.execute(
                'SELECT model, unit_cost FROM platform_model_pricing ORDER BY model COLLATE utf8mb4_0900_as_ci'
            ).fetchall()
        return {row["model"]: int(row["unit_cost"]) for row in rows}

    @staticmethod
    def _change_usage_balance(connection, event, delta, action, reason, now):
        """Apply one auditable usage balance movement inside the caller transaction."""
        delta = int(delta or 0)
        if not delta:
            return
        connection.execute(
            "UPDATE platform_users SET credit_balance=credit_balance+?, last_active_at=?, updated_at=? WHERE id=?",
            (delta, now, now, event["user_id"]),
        )
        balance = int(connection.execute(
            "SELECT credit_balance FROM platform_users WHERE id=?", (event["user_id"],)
        ).fetchone()["credit_balance"] or 0)
        connection.execute(
            """INSERT INTO platform_credit_ledger
               (id, user_id, admin_username, action, delta, balance_after, reason, usage_event_id, created_at)
               VALUES(?, ?, 'system', ?, ?, ?, ?, ?, ?)""",
            (uuid.uuid4().hex, event["user_id"], action, delta, balance, str(reason or "")[:500], event["id"], now),
        )

    def set_pricing(self, pricing):
        now = self.now_ms()
        with self.connect(immediate=True) as connection:
            for category in USAGE_CATEGORIES:
                if category not in pricing:
                    continue
                unit_cost = int(pricing[category])
                if unit_cost < 0 or unit_cost > 1000000:
                    raise PlatformStoreError("积分单价必须在 0–1000000 之间", "invalid_price", 400)
                connection.execute(
                    'INSERT INTO platform_pricing(category, unit_cost, updated_at) VALUES(?, ?, ?) ON DUPLICATE KEY UPDATE unit_cost=VALUES(unit_cost), updated_at=VALUES(updated_at)',
                    (category, unit_cost, now),
                )
        return self.pricing()

    def set_model_pricing(self, pricing):
        now = self.now_ms()
        with self.connect(immediate=True) as connection:
            for raw_model, raw_unit_cost in (pricing or {}).items():
                model = str(raw_model or "").strip()
                if not model or len(model) > 160:
                    raise PlatformStoreError("模型名称不能为空且不能超过 160 个字符", "invalid_model", 400)
                unit_cost = int(raw_unit_cost)
                if unit_cost < 0 or unit_cost > 1000000:
                    raise PlatformStoreError("积分单价必须在 0–1000000 之间", "invalid_price", 400)
                connection.execute(
                    'INSERT INTO platform_model_pricing(model, unit_cost, updated_at) VALUES(?, ?, ?) ON DUPLICATE KEY UPDATE unit_cost=VALUES(unit_cost), updated_at=VALUES(updated_at)',
                    (model, unit_cost, now),
                )
        return self.model_pricing()

    @staticmethod
    def _usage_unit_cost(connection, category, model=""):
        model = str(model or "").strip()
        if model:
            row = connection.execute(
                'SELECT unit_cost FROM platform_model_pricing WHERE model=? COLLATE utf8mb4_0900_as_ci',
                (model,),
            ).fetchone()
            if row:
                return int(row["unit_cost"])
        row = connection.execute(
            "SELECT unit_cost FROM platform_pricing WHERE category=?",
            (category,),
        ).fetchone()
        return int(row["unit_cost"] if row else DEFAULT_PRICING[category])

    def _reserve_usage(self, connection, username, category, requested_units=1, operation="", model="", external_task_id=""):
        if category not in USAGE_CATEGORIES:
            raise PlatformStoreError("使用类型不合法", "invalid_category", 400)
        requested_units = max(1, int(requested_units or 1))
        now = self.now_ms()
        event_id = uuid.uuid4().hex
        user = connection.execute('SELECT * FROM platform_users WHERE username=? COLLATE utf8mb4_0900_as_ci', (username,)).fetchone()
        if not user or user["status"] != "enabled":
            raise PlatformStoreError("账号未启用或已被禁用", "account_disabled", 403)
        unit_cost = self._usage_unit_cost(connection, category, model)
        reserved_points = unit_cost * requested_units
        available = int(user["credit_balance"] or 0)
        if available < reserved_points:
            raise PlatformStoreError(
                "积分额度不足，请联系管理员充值",
                "insufficient_quota",
                402,
                required_points=reserved_points,
                available_points=available,
            )
        connection.execute(
            """INSERT INTO platform_usage_events
               (id, user_id, username, category, operation, model, external_task_id, status,
                task_count, requested_units, output_units, unit_cost, reserved_points,
                debited_points, refunded_points, charged_points, created_at)
               VALUES(?, ?, ?, ?, ?, ?, ?, 'reserved', 1, ?, 0, ?, ?, ?, 0, 0, ?)""",
            (
                event_id, user["id"], user["username"], category, str(operation or "")[:160],
                str(model or "")[:160], str(external_task_id or "")[:240], requested_units,
                unit_cost, reserved_points, reserved_points, now,
            ),
        )
        event = connection.execute("SELECT * FROM platform_usage_events WHERE id=?", (event_id,)).fetchone()
        self._change_usage_balance(connection, event, -reserved_points, "usage_debit", "任务预扣积分", now)
        return event_id

    def reserve_usage(self, username, category, requested_units=1, operation="", model="", external_task_id=""):
        with self.connect(immediate=True) as connection:
            return self._reserve_usage(connection, username, category, requested_units, operation, model, external_task_id)

    def claim_generation_task(self, task_id, owner_user_id, operation, request_id, fingerprint,
                              payload=None, usage_event_id=""):
        now = int(time.time() * 1000)
        with self.connect(immediate=True) as connection:
            row = connection.execute(
                "SELECT * FROM platform_generation_tasks WHERE owner_user_id = ? AND operation = ? AND request_id = ?",
                (int(owner_user_id), operation, request_id),
            ).fetchone()
            if row:
                item = dict(row)
                item["payload"] = json.loads(item.pop("payload_json") or "{}")
                item["result"] = json.loads(item.pop("result_json") or "{}")
                return item, False
            connection.execute(
                """
                INSERT INTO platform_generation_tasks
                    (id, owner_user_id, operation, request_id, fingerprint, status, payload_json,
                     result_json, error, external_task_id, usage_event_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'queued', ?, '{}', '', '', ?, ?, ?)
                """,
                (task_id, int(owner_user_id), operation, request_id, fingerprint,
                 json.dumps(payload or {}, ensure_ascii=False), usage_event_id, now, now),
            )
            return self.generation_task(task_id, connection=connection), True

    def generation_task(self, task_id, owner_user_id=None, connection=None):
        def read(conn):
            query = "SELECT * FROM platform_generation_tasks WHERE id = ?"
            params = [task_id]
            if owner_user_id is not None:
                query += " AND owner_user_id = ?"
                params.append(int(owner_user_id))
            row = conn.execute(query, params).fetchone()
            if not row:
                return None
            item = dict(row)
            item["payload"] = json.loads(item.pop("payload_json") or "{}")
            item["result"] = json.loads(item.pop("result_json") or "{}")
            return item
        if connection is not None:
            return read(connection)
        with self.connect() as conn:
            return read(conn)

    def update_generation_task(self, task_id, **updates):
        allowed = {"status", "result", "error", "external_task_id", "usage_event_id"}
        values = {key: value for key, value in updates.items() if key in allowed}
        if not values:
            return self.generation_task(task_id)
        columns, params = [], []
        for key, value in values.items():
            column = "result_json" if key == "result" else key
            columns.append(f"{column} = ?")
            params.append(json.dumps(value or {}, ensure_ascii=False) if key == "result" else str(value or ""))
        columns.append("updated_at = ?")
        params.extend([int(time.time() * 1000), task_id])
        with self.connect(immediate=True) as connection:
            connection.execute(f"UPDATE platform_generation_tasks SET {', '.join(columns)} WHERE id = ?", params)
        return self.generation_task(task_id)

    def reserve_usage_idempotent(self, idempotency_key, username, category, requested_units=1, operation="", model=""):
        key = str(idempotency_key or "").strip()[:240]
        if not key:
            raise PlatformStoreError("幂等键不能为空", "invalid_idempotency_key", 400)
        with self.connect(immediate=True) as connection:
            existing = connection.execute(
                "SELECT event_id FROM platform_usage_idempotency WHERE idempotency_key=?",
                (key,),
            ).fetchone()
            if existing:
                return existing["event_id"], False
            event_id = self._reserve_usage(connection, username, category, requested_units, operation, model, "")
            connection.execute(
                "INSERT INTO platform_usage_idempotency(idempotency_key, event_id, created_at) VALUES(?, ?, ?)",
                (key, event_id, self.now_ms()),
            )
            return event_id, True

    def reserve_usage_retryable(self, idempotency_key, username, category, requested_units=1, operation="", model=""):
        """Reuse an active/successful reservation, but replace a previously failed attempt."""
        key = str(idempotency_key or "").strip()[:240]
        if not key:
            raise PlatformStoreError("幂等键不能为空", "invalid_idempotency_key", 400)
        with self.connect(immediate=True) as connection:
            existing = connection.execute(
                """SELECT event.id, event.status FROM platform_usage_events AS event
                   JOIN platform_usage_idempotency AS idem ON idem.event_id=event.id
                   WHERE idem.idempotency_key=?""",
                (key,),
            ).fetchone()
            if existing and existing["status"] in {"reserved", "succeeded"}:
                return UsageReservationResult(existing["id"], False, existing["status"])
            event_id = self._reserve_usage(connection, username, category, requested_units, operation, model, "")
            if existing:
                connection.execute(
                    "UPDATE platform_usage_idempotency SET event_id=?, created_at=? WHERE idempotency_key=?",
                    (event_id, self.now_ms(), key),
                )
            else:
                connection.execute(
                    "INSERT INTO platform_usage_idempotency(idempotency_key, event_id, created_at) VALUES(?, ?, ?)",
                    (key, event_id, self.now_ms()),
                )
            return UsageReservationResult(event_id, True, existing["status"] if existing else "")

    def set_usage_task_id(self, event_id, external_task_id):
        with self.connect(immediate=True) as connection:
            connection.execute(
                "UPDATE platform_usage_events SET external_task_id=? WHERE id=? AND status='reserved'",
                (str(external_task_id or "")[:240], event_id),
            )

    def upgrade_usage_reservation(self, event_id, category, requested_units=1, model=""):
        """Atomically reprice an active reservation before expensive work starts."""
        if category not in USAGE_CATEGORIES:
            raise PlatformStoreError("使用类型不合法", "invalid_category", 400)
        requested_units = max(1, int(requested_units or 1))
        with self.connect(immediate=True) as connection:
            event = connection.execute(
                "SELECT * FROM platform_usage_events WHERE id=?",
                (str(event_id or ""),),
            ).fetchone()
            if not event or event["status"] != "reserved":
                return dict(event) if event else None
            unit_cost = self._usage_unit_cost(connection, category, model or event["model"])
            reserved_points = unit_cost * requested_units
            user = connection.execute(
                "SELECT * FROM platform_users WHERE id=?",
                (event["user_id"],),
            ).fetchone()
            held_points = max(0, int(event["debited_points"] or 0) - int(event["refunded_points"] or 0))
            debit_delta = reserved_points - held_points
            available = int(user["credit_balance"] or 0)
            if debit_delta > 0 and available < debit_delta:
                raise PlatformStoreError(
                    "积分额度不足，请联系管理员充值",
                    "insufficient_quota",
                    402,
                    required_points=debit_delta,
                    available_points=available,
                )
            if debit_delta:
                self._change_usage_balance(
                    connection, event, -debit_delta, "usage_debit" if debit_delta > 0 else "usage_refund",
                    "任务预扣调整", self.now_ms(),
                )
            connection.execute(
                """UPDATE platform_usage_events
                   SET category=?, requested_units=?, unit_cost=?, reserved_points=?, debited_points=?,
                       refunded_points=refunded_points+?, model=?
                   WHERE id=? AND status='reserved'""",
                (
                    category,
                    requested_units,
                    unit_cost,
                    reserved_points,
                    int(event["debited_points"] or 0) + max(0, debit_delta),
                    max(0, -debit_delta),
                    str(model or event["model"] or "")[:160],
                    event["id"],
                ),
            )
            row = connection.execute(
                "SELECT * FROM platform_usage_events WHERE id=?",
                (event["id"],),
            ).fetchone()
            return dict(row) if row else None

    def usage_by_idempotency_key(self, idempotency_key):
        key = str(idempotency_key or "").strip()[:240]
        if not key:
            return None
        with self.connect() as connection:
            row = connection.execute(
                """SELECT event.* FROM platform_usage_events AS event
                   JOIN platform_usage_idempotency AS idem ON idem.event_id=event.id
                   WHERE idem.idempotency_key=?""",
                (key,),
            ).fetchone()
        return dict(row) if row else None

    def finish_usage_by_task_id(self, username, external_task_id, success, output_units=1, error=""):
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT id FROM platform_usage_events\n                   WHERE username=? COLLATE utf8mb4_0900_as_ci AND external_task_id=? AND status='reserved'",
                (str(username or ""), str(external_task_id or "")),
            ).fetchall()
        return [self.finish_usage(row["id"], success, output_units, error) for row in rows]

    def finish_usage(self, event_id, success, output_units=1, error=""):
        now = self.now_ms()
        with self.connect(immediate=True) as connection:
            event = connection.execute("SELECT * FROM platform_usage_events WHERE id=?", (event_id,)).fetchone()
            if not event or event["status"] != "reserved":
                return dict(event) if event else None
            if success:
                actual_units = max(0, int(output_units or 0))
                charge_units = min(actual_units, int(event["requested_units"] or 1)) if event["category"] == "image" else 1
                charged = int(event["unit_cost"] or 0) * charge_units
                refund = max(0, int(event["debited_points"] or 0) - int(event["refunded_points"] or 0) - charged)
                if refund:
                    self._change_usage_balance(connection, event, refund, "usage_refund", "按实际产出退还差额", now)
                connection.execute(
                    """UPDATE platform_usage_events
                       SET status='succeeded', output_units=?, charged_points=?,
                           refunded_points=refunded_points+?, error='', completed_at=? WHERE id=?""",
                    (actual_units, charged, refund, now, event_id),
                )
            else:
                refund = max(0, int(event["debited_points"] or 0) - int(event["refunded_points"] or 0))
                if refund:
                    self._change_usage_balance(connection, event, refund, "usage_refund", "任务失败自动返还", now)
                connection.execute(
                    """UPDATE platform_usage_events
                       SET status='failed', output_units=0, charged_points=0,
                           refunded_points=refunded_points+?, error=?, completed_at=? WHERE id=?""",
                    (refund, str(error or "任务失败")[:1000], now, event_id),
                )
            row = connection.execute("SELECT * FROM platform_usage_events WHERE id=?", (event_id,)).fetchone()
            return dict(row) if row else None

    def reconcile_usage_success(self, event_id, output_units=1):
        """Settle a provider result discovered after an earlier ambiguous failure."""
        now = self.now_ms()
        with self.connect(immediate=True) as connection:
            event = connection.execute("SELECT * FROM platform_usage_events WHERE id=?", (event_id,)).fetchone()
            if not event:
                return None
            if event["status"] == "succeeded":
                result = dict(event)
                result["_settled_now"] = False
                return result
            if event["status"] not in {"reserved", "failed", "refunded"}:
                result = dict(event)
                result["_settled_now"] = False
                return result
            actual_units = max(0, int(output_units or 0))
            charge_units = min(actual_units, int(event["requested_units"] or 1)) if event["category"] == "image" else 1
            charged = int(event["unit_cost"] or 0) * charge_units
            held = max(0, int(event["debited_points"] or 0) - int(event["refunded_points"] or 0))
            additional_debit = max(0, charged - held)
            settlement_refund = max(0, held - charged)
            if additional_debit:
                self._change_usage_balance(
                    connection, event, -additional_debit, "usage_debit", "已退款任务迟到成功补扣", now
                )
            if settlement_refund:
                self._change_usage_balance(
                    connection, event, settlement_refund, "usage_refund", "按实际产出退还差额", now
                )
            connection.execute(
                """UPDATE platform_usage_events
                   SET status='succeeded', output_units=?, charged_points=?,
                       debited_points=debited_points+?, refunded_points=refunded_points+?,
                       error='', completed_at=? WHERE id=?""",
                (actual_units, charged, additional_debit, settlement_refund, now, event_id),
            )
            row = connection.execute("SELECT * FROM platform_usage_events WHERE id=?", (event_id,)).fetchone()
            result = dict(row) if row else None
            if result is not None:
                result["_settled_now"] = True
            return result

    @staticmethod
    def _range_sql(from_ms=None, to_ms=None, column="created_at"):
        clauses, params = [], []
        if from_ms is not None:
            clauses.append(f"{column} >= ?")
            params.append(int(from_ms))
        if to_ms is not None:
            clauses.append(f"{column} < ?")
            params.append(int(to_ms))
        return clauses, params

    @staticmethod
    def _analytics_ranges(from_ms=None, to_ms=None):
        if from_ms is None and to_ms is None:
            now = datetime.now(ANALYTICS_TIMEZONE)
            to_local = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            from_local = to_local - timedelta(days=7)
            from_ms = int(from_local.timestamp() * 1000)
            to_ms = int(to_local.timestamp() * 1000)
        elif from_ms is None or to_ms is None:
            raise PlatformStoreError(
                "from_ms and to_ms must be provided together",
                code="invalid_analytics_range",
                status_code=400,
            )
        else:
            from_ms, to_ms = int(from_ms), int(to_ms)
        if from_ms >= to_ms:
            raise PlatformStoreError(
                "from_ms must be earlier than to_ms",
                code="invalid_analytics_range",
                status_code=400,
            )
        duration = to_ms - from_ms
        if duration > 366 * 24 * 60 * 60 * 1000:
            raise PlatformStoreError(
                "analytics range cannot exceed 366 days",
                code="invalid_analytics_range",
                status_code=400,
            )
        return from_ms, to_ms, from_ms - duration, from_ms

    def analytics(self, from_ms=None, to_ms=None):
        from_ms, to_ms, previous_from_ms, previous_to_ms = self._analytics_ranges(from_ms, to_ms)
        with self.connect() as connection:
            raw_rows = connection.execute(
                """SELECT id, user_id, username, category, operation, model, status,
                    output_units, reserved_points, charged_points, error, created_at, completed_at
                    FROM platform_usage_events
                    WHERE created_at >= ? AND created_at < ?
                    ORDER BY created_at ASC, id ASC""",
                (previous_from_ms, to_ms),
            ).fetchall()
        all_rows = [dict(row) for row in raw_rows]
        current_rows = [row for row in all_rows if int(row.get("created_at") or 0) >= from_ms]
        previous_rows = [row for row in all_rows if int(row.get("created_at") or 0) < previous_to_ms]

        def summarize(rows):
            statuses = [str(row.get("status") or "") for row in rows]
            succeeded = statuses.count("succeeded")
            failed = statuses.count("failed")
            refunded = statuses.count("refunded")
            processing = statuses.count("reserved")
            terminal = succeeded + failed + refunded
            active = set()
            for row in rows:
                user_id = str(row.get("user_id") or "").strip()
                username = str(row.get("username") or "").strip()
                if user_id:
                    active.add(f"id:{user_id}")
                elif username:
                    active.add(f"username:{username}")
            return {
                "active_users": len(active),
                "total_tasks": len(rows),
                "succeeded_tasks": succeeded,
                "failed_tasks": failed,
                "refunded_tasks": refunded,
                "processing_tasks": processing,
                "terminal_tasks": terminal,
                "output_units": sum(
                    max(0, int(row.get("output_units") or 0))
                    for row in rows
                    if row.get("status") == "succeeded"
                ),
                "charged_points": sum(max(0, int(row.get("charged_points") or 0)) for row in rows),
                "reserved_points": sum(
                    max(0, int(row.get("reserved_points") or 0))
                    for row in rows
                    if row.get("status") == "reserved"
                ),
                "success_rate": round((succeeded / terminal * 100), 2) if terminal else 0.0,
            }

        summary = summarize(current_rows)
        previous_summary = summarize(previous_rows)
        comparison = {}
        for key in (
            "active_users",
            "succeeded_tasks",
            "output_units",
            "charged_points",
            "success_rate",
            "processing_tasks",
            "reserved_points",
        ):
            current_value = summary[key]
            previous_value = previous_summary[key]
            delta = round(current_value - previous_value, 2)
            comparison[key] = {
                "current": current_value,
                "previous": previous_value,
                "delta": delta,
                "change_percent": None
                if previous_value == 0
                else round(delta / previous_value * 100, 2),
                "is_new": previous_value == 0 and current_value > 0,
                "direction": "up" if delta > 0 else "down" if delta < 0 else "flat",
            }

        start_local = datetime.fromtimestamp(from_ms / 1000, ANALYTICS_TIMEZONE)
        end_local = datetime.fromtimestamp((to_ms - 1) / 1000, ANALYTICS_TIMEZONE)
        series_by_date = {}
        cursor = start_local.date()
        while cursor <= end_local.date():
            date_key = cursor.isoformat()
            series_by_date[date_key] = {
                "date": date_key,
                "label": f"{cursor.month}/{cursor.day}",
                "succeeded_tasks": 0,
                "failed_tasks": 0,
                "refunded_tasks": 0,
                "processing_tasks": 0,
                "output_units": 0,
                "charged_points": 0,
                "reserved_points": 0,
            }
            cursor += timedelta(days=1)
        for row in current_rows:
            date_key = datetime.fromtimestamp(int(row.get("created_at") or 0) / 1000, ANALYTICS_TIMEZONE).date().isoformat()
            bucket = series_by_date.get(date_key)
            if not bucket:
                continue
            status = row.get("status")
            if status == "succeeded":
                bucket["succeeded_tasks"] += 1
                bucket["output_units"] += max(0, int(row.get("output_units") or 0))
            elif status == "failed":
                bucket["failed_tasks"] += 1
            elif status == "refunded":
                bucket["refunded_tasks"] += 1
            elif status == "reserved":
                bucket["processing_tasks"] += 1
                bucket["reserved_points"] += max(0, int(row.get("reserved_points") or 0))
            bucket["charged_points"] += max(0, int(row.get("charged_points") or 0))
        series = list(series_by_date.values())

        feature_groups = {}
        model_groups = {}
        user_groups = {}
        failure_groups = {
            key: {"key": key, "label": label, "count": 0, "samples": [], "latest_at": None}
            for key, label in ANALYTICS_ERROR_LABELS.items()
        }
        for row in current_rows:
            status = str(row.get("status") or "")
            output_units = max(0, int(row.get("output_units") or 0)) if status == "succeeded" else 0
            charged_points = max(0, int(row.get("charged_points") or 0))
            failed_count = 1 if status in {"failed", "refunded"} else 0

            category = str(row.get("category") or "").strip().lower()
            operation = str(row.get("operation") or "").strip()
            feature_key = (category, operation)
            if feature_key not in feature_groups:
                metadata = usage_feature_metadata(category, operation)
                feature_groups[feature_key] = {
                    "category": category,
                    "operation": operation,
                    "surface": metadata["surface_label"],
                    "feature": metadata["feature_label"],
                    "category_label": metadata["category_label"],
                    "tasks": 0,
                    "succeeded": 0,
                    "failed": 0,
                    "processing": 0,
                    "output_units": 0,
                    "charged_points": 0,
                }
            feature = feature_groups[feature_key]
            feature["tasks"] += 1
            feature["succeeded"] += 1 if status == "succeeded" else 0
            feature["failed"] += failed_count
            feature["processing"] += 1 if status == "reserved" else 0
            feature["output_units"] += output_units
            feature["charged_points"] += charged_points

            model_name = str(row.get("model") or "").strip() or "\u672a\u8bb0\u5f55"
            model = model_groups.setdefault(
                model_name,
                {
                    "model": model_name,
                    "calls": 0,
                    "succeeded": 0,
                    "failed": 0,
                    "processing": 0,
                    "output_units": 0,
                    "charged_points": 0,
                    "duration_total_ms": 0,
                    "duration_samples": 0,
                },
            )
            model["calls"] += 1
            model["succeeded"] += 1 if status == "succeeded" else 0
            model["failed"] += failed_count
            model["processing"] += 1 if status == "reserved" else 0
            model["output_units"] += output_units
            model["charged_points"] += charged_points
            created_at = int(row.get("created_at") or 0)
            completed_at = int(row.get("completed_at") or 0)
            if completed_at >= created_at > 0:
                model["duration_total_ms"] += completed_at - created_at
                model["duration_samples"] += 1

            user_id = str(row.get("user_id") or "").strip()
            username = str(row.get("username") or "").strip()
            user_key = f"id:{user_id}" if user_id else f"username:{username}" if username else "unknown"
            user = user_groups.setdefault(
                user_key,
                {
                    "user_id": row.get("user_id") or "",
                    "username": str(row.get("username") or "").strip() or "\u672a\u77e5\u7528\u6237",
                    "tasks": 0,
                    "succeeded": 0,
                    "failures": 0,
                    "output_units": 0,
                    "charged_points": 0,
                },
            )
            user["tasks"] += 1
            user["succeeded"] += 1 if status == "succeeded" else 0
            user["failures"] += failed_count
            user["output_units"] += output_units
            user["charged_points"] += charged_points

            if status in {"failed", "refunded"}:
                failure_key = _classify_analytics_error(row.get("error"))
                failure = failure_groups[failure_key]
                failure["count"] += 1
                created = int(row.get("created_at") or 0)
                failure["latest_at"] = max(int(failure["latest_at"] or 0), created)
                sample = _sanitize_analytics_error(row.get("error"))
                if sample and sample not in failure["samples"] and len(failure["samples"]) < 3:
                    failure["samples"].append(sample)

        by_feature = list(feature_groups.values())
        for row in by_feature:
            terminal = row["succeeded"] + row["failed"]
            row["success_rate"] = round(row["succeeded"] / terminal * 100, 2) if terminal else 0.0
        by_feature.sort(key=lambda row: (-row["charged_points"], -row["tasks"], row["feature"]))

        by_model = list(model_groups.values())
        for row in by_model:
            terminal = row["succeeded"] + row["failed"]
            row["success_rate"] = round(row["succeeded"] / terminal * 100, 2) if terminal else 0.0
            row["avg_duration_ms"] = (
                round(row["duration_total_ms"] / row["duration_samples"])
                if row["duration_samples"]
                else None
            )
            row.pop("duration_total_ms", None)
            row.pop("duration_samples", None)
        by_model.sort(key=lambda row: (-row["calls"], -row["charged_points"], row["model"]))

        top_users = list(user_groups.values())
        top_users.sort(key=lambda row: (-row["charged_points"], -row["tasks"], row["username"]))

        def range_payload(start_ms, end_ms):
            start = datetime.fromtimestamp(start_ms / 1000, ANALYTICS_TIMEZONE)
            end = datetime.fromtimestamp(end_ms / 1000, ANALYTICS_TIMEZONE)
            return {
                "from_ms": start_ms,
                "to_ms": end_ms,
                "from_iso": start.isoformat(),
                "to_iso_exclusive": end.isoformat(),
                "timezone": "Asia/Shanghai",
                "duration_ms": end_ms - start_ms,
            }

        return {
            "range": range_payload(from_ms, to_ms),
            "previous_range": range_payload(previous_from_ms, previous_to_ms),
            "summary": summary,
            "comparison": comparison,
            "series": series,
            "by_feature": by_feature,
            "by_model": by_model,
            "top_users": top_users[:20],
            "failures": {
                "total": sum(row["count"] for row in failure_groups.values()),
                "categories": [
                    row for row in failure_groups.values() if row["count"] > 0
                ],
            },
        }

    def list_users(self, search="", status="", from_ms=None, to_ms=None, role=""):
        clauses = ["1=1"]
        params = []
        if search:
            clauses.append("u.username LIKE ?")
            params.append(f"%{search}%")
        if status in USER_STATUSES:
            clauses.append("u.status=?")
            params.append(status)
        if role in PLATFORM_ROLES:
            clauses.append("u.role=?")
            params.append(role)
        event_filters = ["e.status='succeeded'"]
        event_params = []
        range_clauses, range_params = self._range_sql(from_ms, to_ms, "e.created_at")
        event_filters.extend(range_clauses)
        event_params.extend(range_params)
        sql = f"""
            SELECT u.id, u.username, u.employee_no, u.display_name, u.role, u.status, u.credit_balance,
                u.created_at, u.updated_at, u.approved_at, u.last_login_at, u.last_active_at,
                COALESCE(r.reserved_points, 0) AS reserved_points,
                COALESCE(h.historical_balance, 0) AS historical_balance,
                COALESCE(s.success_tasks, 0) AS success_tasks,
                COALESCE(s.image_tasks, 0) AS image_tasks,
                COALESCE(s.image_outputs, 0) AS image_outputs,
                COALESCE(s.video_tasks, 0) AS video_tasks,
                COALESCE(s.video_outputs, 0) AS video_outputs,
                COALESCE(s.chat_tasks, 0) AS chat_tasks,
                COALESCE(s.chat_outputs, 0) AS chat_outputs,
                COALESCE(s.workflow_tasks, 0) AS workflow_tasks,
                COALESCE(s.workflow_outputs, 0) AS workflow_outputs,
                COALESCE(s.points_used, 0) AS points_used,
                COALESCE(s.success_refunded_points, 0) + COALESCE(f.failed_refunded_points, 0) AS points_refunded,
                COALESCE(f.failed_tasks, 0) AS failed_tasks
            FROM platform_users u
            LEFT JOIN (
                SELECT user_id, SUM(reserved_points) AS reserved_points
                FROM platform_usage_events WHERE status='reserved' GROUP BY user_id
            ) r ON r.user_id=u.id
            LEFT JOIN (
                SELECT user_id, SUM(delta) AS historical_balance
                FROM platform_credit_ledger
                WHERE action IN ('add', 'subtract', 'set')
                GROUP BY user_id
            ) h ON h.user_id=u.id
            LEFT JOIN (
                SELECT e.user_id, COUNT(*) AS success_tasks,
                    SUM(CASE WHEN e.category='image' THEN 1 ELSE 0 END) AS image_tasks,
                    SUM(CASE WHEN e.category='image' THEN e.output_units ELSE 0 END) AS image_outputs,
                    SUM(CASE WHEN e.category='video' THEN 1 ELSE 0 END) AS video_tasks,
                    SUM(CASE WHEN e.category='video' THEN e.output_units ELSE 0 END) AS video_outputs,
                    SUM(CASE WHEN e.category='chat' THEN 1 ELSE 0 END) AS chat_tasks,
                    SUM(CASE WHEN e.category='chat' THEN e.output_units ELSE 0 END) AS chat_outputs,
                    SUM(CASE WHEN e.category='workflow' THEN 1 ELSE 0 END) AS workflow_tasks,
                    SUM(CASE WHEN e.category='workflow' THEN e.output_units ELSE 0 END) AS workflow_outputs,
                    SUM(e.charged_points) AS points_used,
                    SUM(e.refunded_points) AS success_refunded_points
                FROM platform_usage_events e WHERE {' AND '.join(event_filters)} GROUP BY e.user_id
            ) s ON s.user_id=u.id
            LEFT JOIN (
                SELECT e.user_id, COUNT(*) AS failed_tasks,
                    SUM(e.refunded_points) AS failed_refunded_points
                FROM platform_usage_events e WHERE e.status IN ('failed','refunded')
                {''.join(' AND ' + item for item in range_clauses)} GROUP BY e.user_id
            ) f ON f.user_id=u.id
            WHERE {' AND '.join(clauses)} ORDER BY u.created_at DESC
        """
        query_params = event_params + range_params + params
        with self.connect() as connection:
            rows = [dict(row) for row in connection.execute(sql, tuple(query_params)).fetchall()]
        for row in rows:
            row["available_points"] = int(row.get("credit_balance") or 0)
            row["net_points"] = int(row.get("points_used") or 0)
        return rows

    def usage_breakdown(self, from_ms=None, to_ms=None):
        range_clauses, range_params = self._range_sql(from_ms, to_ms)
        where = " AND ".join(range_clauses) if range_clauses else "1=1"
        with self.connect() as connection:
            rows = connection.execute(
                f"""SELECT category, operation,
                    COUNT(*) AS total_tasks,
                    SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) AS success_tasks,
                    SUM(CASE WHEN status IN ('failed','refunded') THEN 1 ELSE 0 END) AS failed_tasks,
                    SUM(CASE WHEN status='reserved' THEN 1 ELSE 0 END) AS processing_tasks,
                    COALESCE(SUM(CASE WHEN status='succeeded' THEN output_units ELSE 0 END), 0) AS output_units,
                    COALESCE(SUM(charged_points), 0) AS points_used
                    FROM platform_usage_events
                    WHERE {where}
                    GROUP BY category, operation
                    ORDER BY points_used DESC, total_tasks DESC, operation ASC""",
                tuple(range_params),
            ).fetchall()
        return [enrich_usage_row(row) for row in rows]

    def overview(self, from_ms=None, to_ms=None):
        range_clauses, range_params = self._range_sql(from_ms, to_ms)
        where = " AND ".join(range_clauses) if range_clauses else "1=1"
        with self.connect() as connection:
            users = connection.execute(
                """SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
                    SUM(CASE WHEN status='enabled' THEN 1 ELSE 0 END) AS enabled,
                    SUM(CASE WHEN status='disabled' THEN 1 ELSE 0 END) AS disabled,
                    COALESCE(SUM(credit_balance), 0) AS balance
                    FROM platform_users"""
            ).fetchone()
            reserved = connection.execute(
                "SELECT COALESCE(SUM(reserved_points), 0) AS n FROM platform_usage_events WHERE status='reserved'"
            ).fetchone()["n"]
            usage = connection.execute(
                f"""SELECT
                    COUNT(*) AS total_tasks,
                    SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) AS success_tasks,
                    SUM(CASE WHEN status IN ('failed','refunded') THEN 1 ELSE 0 END) AS failed_tasks,
                    SUM(CASE WHEN status='succeeded' AND category='image' THEN output_units ELSE 0 END) AS image_outputs,
                    SUM(CASE WHEN status='succeeded' AND category='image' THEN 1 ELSE 0 END) AS image_tasks,
                    SUM(CASE WHEN status='succeeded' AND category='video' THEN 1 ELSE 0 END) AS video_tasks,
                    SUM(CASE WHEN status='succeeded' AND category='chat' THEN 1 ELSE 0 END) AS chat_tasks,
                    SUM(CASE WHEN status='succeeded' AND category='workflow' THEN 1 ELSE 0 END) AS workflow_tasks,
                    COALESCE(SUM(charged_points), 0) AS points_used,
                    COALESCE(SUM(refunded_points), 0) AS points_refunded
                    FROM platform_usage_events WHERE {where}""",
                tuple(range_params),
            ).fetchone()
        user_data = {key: int(users[key] or 0) for key in users.keys()}
        usage_data = {key: int(usage[key] or 0) for key in usage.keys()}
        user_data["reserved"] = int(reserved or 0)
        user_data["available"] = user_data["balance"]
        return {
            "users": user_data,
            "usage": usage_data,
            "pricing": self.pricing(),
            "features": self.usage_breakdown(from_ms, to_ms),
        }

    def usage_details(self, search="", category="", status="", from_ms=None, to_ms=None, limit=500):
        clauses = ["1=1"]
        params = []
        if search:
            clauses.append("username LIKE ?")
            params.append(f"%{search}%")
        if category in USAGE_CATEGORIES:
            clauses.append("category=?")
            params.append(category)
        if status in {"reserved", "succeeded", "failed", "refunded"}:
            clauses.append("status=?")
            params.append(status)
        range_clauses, range_params = self._range_sql(from_ms, to_ms)
        clauses.extend(range_clauses)
        params.extend(range_params)
        try:
            safe_limit = max(1, min(int(limit or 500), 10000))
        except (TypeError, ValueError):
            safe_limit = 500
        with self.connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM platform_usage_events WHERE {' AND '.join(clauses)} ORDER BY created_at DESC LIMIT ?",
                tuple(params + [safe_limit]),
            ).fetchall()
        return [enrich_usage_row(row) for row in rows]
