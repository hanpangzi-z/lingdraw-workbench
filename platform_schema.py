"""MySQL platform schema, version 1. Source IDs and millisecond timestamps are preserved."""

DDL = [
    """CREATE TABLE IF NOT EXISTS platform_meta (
    `key` VARCHAR(240) PRIMARY KEY,
    value LONGTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin""",
    """CREATE TABLE IF NOT EXISTS platform_admins (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(240) NOT NULL UNIQUE COLLATE utf8mb4_0900_as_ci,
    password_salt VARCHAR(240) NOT NULL,
    password_hash VARCHAR(240) NOT NULL,
    password_iterations BIGINT NOT NULL DEFAULT 310000,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    last_login_at BIGINT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin""",
    """CREATE TABLE IF NOT EXISTS platform_users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(240) NOT NULL UNIQUE COLLATE utf8mb4_0900_as_ci,
    password_salt VARCHAR(240) NOT NULL,
    password_hash VARCHAR(240) NOT NULL,
    password_iterations BIGINT NOT NULL DEFAULT 310000,
    role VARCHAR(240) NOT NULL DEFAULT 'user',
    status VARCHAR(240) NOT NULL DEFAULT 'pending',
    credit_balance BIGINT NOT NULL DEFAULT 0,
    employee_no VARCHAR(240) NOT NULL DEFAULT '',
    display_name VARCHAR(240) NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    approved_at BIGINT,
    last_login_at BIGINT,
    last_active_at BIGINT,
    employee_no_unique VARCHAR(240) GENERATED ALWAYS AS (NULLIF(employee_no, '')) STORED,
    UNIQUE KEY idx_platform_users_employee_no (employee_no_unique)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin""",
    """CREATE TABLE IF NOT EXISTS platform_pricing (
    category VARCHAR(240) PRIMARY KEY,
    unit_cost BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin""",
    """CREATE TABLE IF NOT EXISTS platform_model_pricing (
    model VARCHAR(240) PRIMARY KEY COLLATE utf8mb4_0900_as_ci,
    unit_cost BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin""",
    """CREATE TABLE IF NOT EXISTS platform_usage_events (
    id VARCHAR(240) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    FOREIGN KEY (`user_id`) REFERENCES platform_users(id) ON DELETE CASCADE,
    username VARCHAR(240) NOT NULL,
    category VARCHAR(240) NOT NULL,
    operation VARCHAR(240) NOT NULL DEFAULT '',
    model VARCHAR(240) NOT NULL DEFAULT '',
    external_task_id VARCHAR(240) NOT NULL DEFAULT '',
    status VARCHAR(240) NOT NULL,
    task_count BIGINT NOT NULL DEFAULT 1,
    requested_units BIGINT NOT NULL DEFAULT 1,
    output_units BIGINT NOT NULL DEFAULT 0,
    unit_cost BIGINT NOT NULL,
    reserved_points BIGINT NOT NULL,
    debited_points BIGINT NOT NULL DEFAULT 0,
    refunded_points BIGINT NOT NULL DEFAULT 0,
    charged_points BIGINT NOT NULL DEFAULT 0,
    error LONGTEXT NOT NULL DEFAULT (''),
    created_at BIGINT NOT NULL,
    completed_at BIGINT,
    KEY idx_platform_usage_user_time (user_id, created_at),
    KEY idx_platform_usage_status_time (status, created_at),
    KEY idx_platform_usage_category_time (category, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin""",
    """CREATE TABLE IF NOT EXISTS platform_credit_ledger (
    id VARCHAR(240) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    FOREIGN KEY (`user_id`) REFERENCES platform_users(id) ON DELETE CASCADE,
    admin_username VARCHAR(240) NOT NULL,
    action VARCHAR(240) NOT NULL,
    delta BIGINT NOT NULL,
    balance_after BIGINT NOT NULL,
    reason LONGTEXT NOT NULL DEFAULT (''),
    usage_event_id VARCHAR(240) NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin""",
    """CREATE TABLE IF NOT EXISTS platform_usage_idempotency (
    idempotency_key VARCHAR(240) PRIMARY KEY,
    event_id VARCHAR(240) NOT NULL UNIQUE,
    FOREIGN KEY (`event_id`) REFERENCES platform_usage_events(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin""",
    """CREATE TABLE IF NOT EXISTS platform_generation_tasks (
    id VARCHAR(240) PRIMARY KEY,
    owner_user_id BIGINT NOT NULL,
    operation VARCHAR(240) NOT NULL,
    request_id VARCHAR(240) NOT NULL,
    fingerprint VARCHAR(240) NOT NULL,
    status VARCHAR(240) NOT NULL,
    payload_json LONGTEXT NOT NULL DEFAULT ('{}'),
    result_json LONGTEXT NOT NULL DEFAULT ('{}'),
    error LONGTEXT NOT NULL DEFAULT (''),
    external_task_id VARCHAR(240) NOT NULL DEFAULT '',
    usage_event_id VARCHAR(240) NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    UNIQUE(owner_user_id, operation, request_id),
    KEY idx_generation_tasks_owner_status (owner_user_id, status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin""",
    """CREATE TABLE IF NOT EXISTS platform_audit_events (
    id VARCHAR(240) PRIMARY KEY,
    actor_username VARCHAR(240) NOT NULL,
    actor_role VARCHAR(240) NOT NULL,
    action VARCHAR(240) NOT NULL,
    target_type VARCHAR(240) NOT NULL DEFAULT '',
    target_id VARCHAR(240) NOT NULL DEFAULT '',
    field_name VARCHAR(240) NOT NULL DEFAULT '',
    result VARCHAR(240) NOT NULL,
    ip_address VARCHAR(240) NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL,
    KEY idx_platform_audit_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin""",
    """CREATE TABLE IF NOT EXISTS auth_hub_identity_bindings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    provider VARCHAR(240) NOT NULL,
    employee_no VARCHAR(240) NOT NULL,
    local_user_id BIGINT NOT NULL,
    FOREIGN KEY (`local_user_id`) REFERENCES platform_users(id) ON DELETE CASCADE,
    subject VARCHAR(240) NOT NULL DEFAULT '',
    wecom_userid VARCHAR(240) NOT NULL DEFAULT '',
    status VARCHAR(240) NOT NULL DEFAULT 'enabled',
    bound_by VARCHAR(240) NOT NULL DEFAULT '',
    bound_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    disabled_at BIGINT,
    UNIQUE(provider, employee_no),
    UNIQUE(provider, local_user_id),
    KEY idx_auth_hub_binding_user (local_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin""",
    """CREATE TABLE IF NOT EXISTS auth_hub_login_intents (
    intent_hash VARCHAR(240) PRIMARY KEY,
    return_to LONGTEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    consumed_at BIGINT,
    KEY idx_auth_hub_intent_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin""",
]

def initialize_schema(engine):
    with engine.connect() as connection:
        for statement in DDL:
            connection.exec_driver_sql(statement)
        connection.commit()
