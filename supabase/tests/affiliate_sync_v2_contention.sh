#!/usr/bin/env bash
set -euo pipefail

# Local/disposable only. Run inside the local Supabase Postgres container,
# where psql connects over the container's Unix socket. The database name is
# deliberately restricted so this harness cannot target the normal local DB.
test_db=${1:-}
db_user=${A9C_R1_DB_USER:-supabase_admin}

if [[ ! "$test_db" =~ ^a9c_r1_[a-z0-9_]+$ ]]; then
  echo "expected disposable database name matching a9c_r1_[a-z0-9_]+" >&2
  exit 2
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
fixture_path="$script_dir/affiliate_sync_v2_contention_fixture.psql"
if [[ ! -f "$fixture_path" ]]; then
  echo "missing contention fixture: $fixture_path" >&2
  exit 2
fi

psql_base=(psql -X -qAt -v ON_ERROR_STOP=1 -U "$db_user" -d "$test_db")
if [[ "$("${psql_base[@]}" -c "select current_database() = '$test_db' and current_database() like 'a9c_r1_%' and inet_server_addr() is null")" != "t" ]]; then
  echo "refusing non-disposable or TCP-connected database" >&2
  exit 2
fi

temp_root=$(mktemp -d /tmp/a9c-r1-contention.XXXXXX)
cleanup() {
  rm -rf -- "$temp_root"
}
trap cleanup EXIT

"${psql_base[@]}" -f "$fixture_path"

wait_for_sql_true() {
  local sql=$1
  local attempts=${2:-200}
  local value
  for ((attempt = 0; attempt < attempts; attempt += 1)); do
    value=$("${psql_base[@]}" -c "$sql")
    if [[ "$value" == "t" ]]; then
      return 0
    fi
    sleep 0.02
  done
  return 1
}

run_pair() {
  local case_id=$1
  local app_case=${case_id//-/_}
  local winner_app="a9c_r1_${app_case}_a"
  local contender_app="a9c_r1_${app_case}_b"
  local winner_sql="$temp_root/${case_id}-a.psql"
  local contender_sql="$temp_root/${case_id}-b.psql"
  local winner_out="$temp_root/${case_id}-a.out"
  local winner_err="$temp_root/${case_id}-a.err"
  local contender_out="$temp_root/${case_id}-b.out"
  local contender_err="$temp_root/${case_id}-b.err"

  cat > "$winner_sql" <<SQL
SET application_name = '$winner_app';
SET statement_timeout = '20s';
SET lock_timeout = '12s';
SET ROLE service_role;
BEGIN;
WITH response AS (
  SELECT a9c_r1_test.execute_request('$case_id', 'A') AS result
)
INSERT INTO a9c_r1_test.results (case_id, side, result)
SELECT '$case_id', 'A', result FROM response
RETURNING result::text;
SELECT pg_sleep(3);
COMMIT;
SQL

  cat > "$contender_sql" <<SQL
SET application_name = '$contender_app';
SET statement_timeout = '20s';
SET lock_timeout = '12s';
SET ROLE service_role;
WITH response AS (
  SELECT a9c_r1_test.execute_request('$case_id', 'B') AS result
)
INSERT INTO a9c_r1_test.results (case_id, side, result)
SELECT '$case_id', 'B', result FROM response
RETURNING result::text;
SQL

  "${psql_base[@]}" -f "$winner_sql" > "$winner_out" 2> "$winner_err" &
  local winner_process=$!

  if ! wait_for_sql_true "select exists (select 1 from pg_stat_activity where application_name = '$winner_app' and wait_event_type = 'Timeout' and wait_event = 'PgSleep')"; then
    wait "$winner_process" || true
    cat "$winner_err" >&2
    echo "$case_id: winner never reached the transaction hold" >&2
    exit 1
  fi

  "${psql_base[@]}" -f "$contender_sql" > "$contender_out" 2> "$contender_err" &
  local contender_process=$!

  if ! wait_for_sql_true "select coalesce((select wait_event_type = 'Lock' and wait_event = 'transactionid' and cardinality(pg_blocking_pids(pid)) > 0 from pg_stat_activity where application_name = '$contender_app'), false)"; then
    wait "$winner_process" || true
    wait "$contender_process" || true
    cat "$winner_err" >&2
    cat "$contender_err" >&2
    echo "$case_id: contender completed without proven lock contention" >&2
    exit 1
  fi

  if [[ "$case_id" == "same-1" ]]; then
    "${psql_base[@]}" -c "
      with contender as (
        select pid, wait_event_type, wait_event, pg_blocking_pids(pid) as blockers
        from pg_stat_activity where application_name = '$contender_app'
      )
      select jsonb_build_object(
        'case', '$case_id',
        'winner', '$winner_app',
        'contender', '$contender_app',
        'waitEventType', contender.wait_event_type,
        'waitEvent', contender.wait_event,
        'blockingPidCount', cardinality(contender.blockers),
        'ungrantedTransactionShareLock', exists (
          select 1 from pg_locks
          where pid = contender.pid and granted = false
            and locktype = 'transactionid' and mode = 'ShareLock'
        ),
        'storesRowExclusiveLock', exists (
          select 1 from pg_locks
          where pid = contender.pid and granted = true
            and relation = 'public.stores'::regclass
            and mode = 'RowExclusiveLock'
        )
      )::text
      from contender
    " > "$temp_root/lock-evidence.out"
  fi

  if ! wait "$winner_process"; then
    cat "$winner_err" >&2
    exit 1
  fi
  if ! wait "$contender_process"; then
    cat "$contender_err" >&2
    exit 1
  fi
}

for case_id in \
  same-1 same-2 same-3 \
  different-offers offer-compatible kind-conflict slug-conflict
do
  run_pair "$case_id"
done

validation_result=$("${psql_base[@]}" -c "select a9c_r1_test.validate_results()")
if [[ "$validation_result" != "A9C-R1 contention matrix passed" ]]; then
  echo "unexpected validation result: $validation_result" >&2
  exit 1
fi

echo "LOCK_EVIDENCE|$(<"$temp_root/lock-evidence.out")"
"${psql_base[@]}" -c "
  select concat_ws('|',
    case_id,
    side,
    result->>'status',
    coalesce(result->>'stage', ''),
    coalesce(result->>'reason', ''),
    coalesce(result#>>'{counts,actual,storesCreated}', ''),
    coalesce(result#>>'{counts,actual,storesNoopExisting}', ''),
    coalesce(result#>>'{counts,actual,offersCreated}', ''),
    coalesce(result#>>'{counts,actual,offersNoopExisting}', ''),
    coalesce(result#>>'{counts,actual,ledgerRows}', '')
  )
  from a9c_r1_test.results
  order by case_id, side
"
echo "$validation_result"
