#!/bin/sh
# Only the private GitHub Actions service; no external URL or caller DB accepted.
set -eu
fixture=viewer/tests/sql/review-aggregate-postgres.sql
error_log=$(mktemp)
trap 'rm -f "$error_log"' EXIT HUP INT TERM

fixture_psql() {
  database=$1
  shift
  case "$database" in uttu_review_aggregate_fixture|postgres) ;; *) exit 1 ;; esac
  command psql -X --no-password --host=postgres --port=5432 \
    --username=fixture_admin --dbname="$database" --set=ON_ERROR_STOP=1 "$@"
}

assert_sql() {
  result=$(fixture_psql uttu_review_aggregate_fixture -Atc "$1")
  test "$result" = t || { printf '%s\n' 'Fixture assertion failed'; exit 1; }
}

expect_guard() {
  database=$1
  expected=$2
  if fixture_psql "$database" --file="$fixture" >"$error_log" 2>&1; then
    printf '%s\n' 'Guard unexpectedly accepted fixture'
    exit 1
  fi
  if ! grep -Fq "$expected" "$error_log"; then
    cat "$error_log"
    exit 1
  fi
}

assert_clean() {
  assert_sql "SELECT to_regclass('public.reviews') IS NULL
    AND to_regprocedure('public.get_review_stats_v1(date)') IS NULL
    AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname IN ('authenticated','anon'));"
}

assert_clean
expect_guard postgres 'Disposable fixture database required'
test "$(fixture_psql postgres -Atc "SELECT to_regclass('public.reviews') IS NULL AND to_regprocedure('public.get_review_stats_v1(date)') IS NULL;")" = t
assert_clean

fixture_psql uttu_review_aggregate_fixture -c 'CREATE TABLE public.reviews(marker integer);'
expect_guard uttu_review_aggregate_fixture 'Fixture requires absent reviews table'
assert_sql "SELECT to_regclass('public.reviews') IS NOT NULL
  AND to_regprocedure('public.get_review_stats_v1(date)') IS NULL
  AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname IN ('authenticated','anon'));"
fixture_psql uttu_review_aggregate_fixture -c 'DROP TABLE public.reviews;'
assert_clean

fixture_psql uttu_review_aggregate_fixture -c "CREATE FUNCTION public.get_review_stats_v1(date) RETURNS integer LANGUAGE sql SECURITY INVOKER AS 'SELECT 0';"
expect_guard uttu_review_aggregate_fixture 'Fixture requires absent aggregate routine'
assert_sql "SELECT public.get_review_stats_v1(NULL)=0 AND to_regclass('public.reviews') IS NULL
  AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname IN ('authenticated','anon'));"
fixture_psql uttu_review_aggregate_fixture -c 'DROP FUNCTION public.get_review_stats_v1(date);'
assert_clean

# These names and attributes are fixed fixture values, never supplied as inputs.
for role in authenticated anon; do
  for privilege in SUPERUSER BYPASSRLS; do
    fixture_psql uttu_review_aggregate_fixture -c "CREATE ROLE $role NOLOGIN $privilege;"
    expect_guard uttu_review_aggregate_fixture 'Fixture roles must be NOSUPERUSER and NOBYPASSRLS'
    assert_sql "SELECT to_regclass('public.reviews') IS NULL
      AND to_regprocedure('public.get_review_stats_v1(date)') IS NULL
      AND EXISTS (SELECT FROM pg_roles WHERE rolname='$role' AND (rolsuper OR rolbypassrls));"
    fixture_psql uttu_review_aggregate_fixture -c "DROP ROLE $role;"
    assert_clean
  done
done

fixture_psql uttu_review_aggregate_fixture --file="$fixture"
assert_clean
printf '%s\n' 'PostgreSQL aggregate, ACL, caller RLS, negative guards and rollback absence passed'
