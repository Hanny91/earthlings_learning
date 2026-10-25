#!/usr/bin/env bash
# Applies any db/migrations/*.sql files not yet recorded in
# app_private.schema_migrations, in filename order.
# Each file and its tracking row are committed in a single transaction, so a
# failed migration leaves nothing behind and stops the run.
#
# Usage: DATABASE_URL=postgres://... bash db/migrate.sh

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"

migrations_dir="$(dirname "$0")/migrations"
psql_cmd=(psql "$DATABASE_URL" --no-psqlrc --quiet -v ON_ERROR_STOP=1)

"${psql_cmd[@]}" <<'SQL'
create schema if not exists app_private;
create table if not exists app_private.schema_migrations (
    filename   text primary key,
    applied_at timestamptz not null default now()
);
SQL

shopt -s nullglob
files=("$migrations_dir"/*.sql)
if [ ${#files[@]} -eq 0 ]; then
    echo "No migrations found in $migrations_dir"
    exit 0
fi

applied_count=0
for file in "${files[@]}"; do
    name="$(basename "$file")"

    # Names are inlined into SQL below, so only allow the expected pattern.
    if [[ ! "$name" =~ ^[0-9]{3}_[a-z0-9_]+\.sql$ ]]; then
        echo "Refusing unexpected migration filename: $name" >&2
        exit 1
    fi

    already="$("${psql_cmd[@]}" -tA -c \
        "select 1 from app_private.schema_migrations where filename = '$name'")"
    if [ -n "$already" ]; then
        continue
    fi

    echo "Applying $name"
    "${psql_cmd[@]}" --single-transaction \
        -f "$file" \
        -c "insert into app_private.schema_migrations (filename) values ('$name')"
    applied_count=$((applied_count + 1))
done

echo "Done: $applied_count migration(s) applied."
