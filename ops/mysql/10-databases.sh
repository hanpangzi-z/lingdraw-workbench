#!/bin/bash
set -euo pipefail
# Service passwords are URL-safe so the same values can be used in Compose DSNs.
for name in PLATFORM_MYSQL_PASSWORD AGENT_MYSQL_PASSWORD PPT_MYSQL_PASSWORD TEMPORAL_MYSQL_PASSWORD; do
  value="${!name:-}"
  if [[ ${#value} -lt 16 || "$value" == *[!a-zA-Z0-9_-]* ]]; then
    echo "$name must contain at least 16 URL-safe letters, digits, underscores or hyphens" >&2
    exit 1
  fi
done
export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
mysql --protocol=socket -uroot <<SQL
CREATE DATABASE IF NOT EXISTS lingdraw_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE DATABASE IF NOT EXISTS lingdraw_agent CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE DATABASE IF NOT EXISTS folio CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE DATABASE IF NOT EXISTS temporal CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE DATABASE IF NOT EXISTS temporal_visibility CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE USER IF NOT EXISTS 'platform'@'%' IDENTIFIED BY '$PLATFORM_MYSQL_PASSWORD';
CREATE USER IF NOT EXISTS 'agent'@'%' IDENTIFIED BY '$AGENT_MYSQL_PASSWORD';
CREATE USER IF NOT EXISTS 'folio'@'%' IDENTIFIED BY '$PPT_MYSQL_PASSWORD';
CREATE USER IF NOT EXISTS 'temporal'@'%' IDENTIFIED BY '$TEMPORAL_MYSQL_PASSWORD';
GRANT ALL ON lingdraw_platform.* TO 'platform'@'%';
GRANT ALL ON lingdraw_agent.* TO 'agent'@'%';
GRANT ALL ON folio.* TO 'folio'@'%';
GRANT ALL ON temporal.* TO 'temporal'@'%';
GRANT ALL ON temporal_visibility.* TO 'temporal'@'%';
SQL
