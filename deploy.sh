#!/usr/bin/env bash
# deploy.sh
# Cross-platform helper to ensure PostgreSQL 14+ is available (prefers Docker).
#
# Usage: ./deploy.sh
# Notes:
#  - If Docker is available, this will create and run a postgres:14 container named "gthack-postgres"
#    with a persistent volume "gt_hack_postgres_data".
#  - If Docker is not available, and apt is present, it will attempt to install postgresql-14 via apt.
#  - On success, the script will create/update a .env.local file with DATABASE_URL.

set -euo pipefail

POSTGRES_CONTAINER_NAME="gthack-postgres"
POSTGRES_VOLUME="gt_hack_postgres_data"
POSTGRES_IMAGE="postgres:14"
POSTGRES_PORT=5432
PG_USER="${PG_USER:-gtuser}"
PG_PASSWORD="${PG_PASSWORD:-gtpass}"
PG_DB="${PG_DB:-gtdb}"
ENV_FILE=".env.local"

info() { echo -e "\033[1;34m[INFO]\033[0m $*"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $*"; }
err() { echo -e "\033[1;31m[ERROR]\033[0m $*"; }

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Wait until psql can connect
wait_for_postgres() {
  local host="${1:-localhost}"
  local port="${2:-$POSTGRES_PORT}"
  local retries=30
  local wait=1

  info "Waiting for Postgres at ${host}:${port} to accept connections..."
  for i in $(seq 1 $retries); do
    if PGPASSWORD="$PG_PASSWORD" psql -h "$host" -p "$port" -U "$PG_USER" -d "$PG_DB" -c '\q' >/dev/null 2>&1; then
      info "Postgres is ready!"
      return 0
    fi
    sleep "$wait"
  done

  return 1
}

# Write DATABASE_URL to .env.local (append if not already present)
write_env() {
  local db_url="postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${POSTGRES_PORT}/${PG_DB}"
  if [ -f "$ENV_FILE" ]; then
    if grep -q "^DATABASE_URL=" "$ENV_FILE"; then
      info "$ENV_FILE already contains DATABASE_URL, leaving it unchanged."
      return
    fi
  fi

  info "Writing DATABASE_URL to $ENV_FILE"
  cat >> "$ENV_FILE" <<EOF

# Added by deploy.sh
DATABASE_URL=${db_url}
PGUSER=${PG_USER}
PGPASSWORD=${PG_PASSWORD}
PGDATABASE=${PG_DB}
PGHOST=localhost
PGPORT=${POSTGRES_PORT}
EOF
}

# 1) Quick check: is psql installed already and can it connect?
if command_exists psql; then
  info "psql command found. Checking Postgres connectivity..."
  if PGPASSWORD="${PG_PASSWORD}" psql -h "localhost" -p "${POSTGRES_PORT}" -U "${PG_USER}" -d "${PG_DB}" -c '\q' >/dev/null 2>&1; then
    info "Local Postgres is reachable and credentials work (user=${PG_USER}, db=${PG_DB})."
    write_env
    info "Prerequisites satisfied. Continue with your deployment steps."
    exit 0
  else
    warn "psql found but cannot connect with default credentials. Will attempt to provision Postgres (Docker or apt)."
  fi
else
  info "psql not found on PATH."
fi

# 2) If Docker exists, use Docker to run Postgres 14
if command_exists docker; then
  info "Docker detected. Using Docker to run postgres:14 container."

  # Ensure Docker daemon is accessible
  if ! docker info >/dev/null 2>&1; then
    err "Docker does not appear to be running or accessible. Please start Docker Desktop / dockerd and re-run."
    exit 1
  fi

  # Create a named volume for persistence if not exists
  if ! docker volume inspect "$POSTGRES_VOLUME" >/dev/null 2>&1; then
    info "Creating docker volume $POSTGRES_VOLUME"
    docker volume create "$POSTGRES_VOLUME" >/dev/null
  fi

  # If the container is already running, skip run
  if docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER_NAME}$"; then
    info "Postgres container '${POSTGRES_CONTAINER_NAME}' is already running."
  else
    # If container exists but stopped, remove it to start fresh
    if docker ps -a --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER_NAME}$"; then
      info "Removing existing stopped container ${POSTGRES_CONTAINER_NAME}"
      docker rm "${POSTGRES_CONTAINER_NAME}" >/dev/null
    fi

    info "Starting postgres container '${POSTGRES_CONTAINER_NAME}' (image ${POSTGRES_IMAGE})..."
    docker run -d \
      --name "${POSTGRES_CONTAINER_NAME}" \
      -e POSTGRES_USER="${PG_USER}" \
      -e POSTGRES_PASSWORD="${PG_PASSWORD}" \
      -e POSTGRES_DB="${PG_DB}" \
      -p "${POSTGRES_PORT}:5432" \
      -v "${POSTGRES_VOLUME}:/var/lib/postgresql/data" \
      --health-cmd='pg_isready -U '"${PG_USER}" \
      --health-interval=5s \
      --health-timeout=5s \
      --health-retries=6 \
      "${POSTGRES_IMAGE}" >/dev/null

    sleep 1
  fi

  # Wait until the DB is ready; ensure psql exists (install psql client if not)
  if ! command_exists psql; then
    warn "psql client not found. Installing minimal 'psql' client inside a temporary container to run checks."
    # Use ephemeral postgres client container to verify readiness
    for i in $(seq 1 30); do
      if docker run --rm --network host "${POSTGRES_IMAGE}" pg_isready -h "localhost" -p "${POSTGRES_PORT}" -U "${PG_USER}" >/dev/null 2>&1; then
        info "Postgres container is accepting connections."
        break
      fi
      sleep 1
    done
  else
    if ! wait_for_postgres "localhost" "${POSTGRES_PORT}"; then
      err "Timed out waiting for Postgres to start in Docker."
      exit 1
    fi
  fi

  write_env
  info "Postgres (Docker) is ready and DATABASE_URL written to ${ENV_FILE}."
  exit 0
fi

# 3) If apt-get exists, attempt to install postgresql-14 (Debian/Ubuntu)
if command_exists apt-get; then
  warn "Docker not found. Attempting to install postgresql-14 via apt (requires sudo)."

  if ! command_exists sudo; then
    err "sudo is required to install packages via apt. Please run this script as root or install Docker instead."
    exit 1
  fi

  info "Updating apt repositories..."
  sudo apt-get update

  info "Installing PostgreSQL 14 and contrib packages..."
  # Try explicit package name first
  if sudo apt-get install -y postgresql-14 postgresql-client-14 postgresql-contrib; then
    info "PostgreSQL 14 installed via apt."
  else
    warn "Could not install postgresql-14 package (may not be available on this distro). Trying 'postgresql' (default version from distro)..."
    sudo apt-get install -y postgresql postgresql-contrib
  fi

  info "Starting/restarting PostgreSQL service..."
  sudo systemctl enable --now postgresql

  info "Creating DB user and database (if not exists)..."
  # Create user with password and DB
  sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${PG_USER}'" | grep -q 1 || sudo -u postgres psql -c "CREATE ROLE ${PG_USER} WITH LOGIN PASSWORD '${PG_PASSWORD}';"
  sudo -u postgres psql -lqt | cut -d \| -f 1 | grep -qw "${PG_DB}" || sudo -u postgres createdb -O "${PG_USER}" "${PG_DB}"

  write_env

  info "Postgres installed and configured via apt. DATABASE_URL written to ${ENV_FILE}."
  exit 0
fi

# 4) If none of the above, provide instructions
err "Unable to automatically provision PostgreSQL on this machine."
echo
echo "Options:"
echo "  1) Install Docker and re-run this script (recommended)."
echo "     https://docs.docker.com/get-docker/"
echo "  2) Install PostgreSQL manually for your OS (Postgres 14+)."
echo "     Ubuntu/Debian: sudo apt-get install postgresql-14"
echo "     macOS (Homebrew): brew install postgresql@14"
echo "     Windows: use installer from https://www.postgresql.org/download/windows or use WSL."
echo
echo "After installing Postgres, create a DB/user and set DATABASE_URL in ${ENV_FILE}:"
echo "  DATABASE_URL=postgresql://<user>:<password>@localhost:${POSTGRES_PORT}/<db>"
exit 1
