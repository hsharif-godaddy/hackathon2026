"""
Budget service lake export Lambda.

Daily full-table snapshot of budget-service Postgres tables to S3 as Parquet
files with Hive-style date partitions and the GoDaddy "_cln" clean-layer.

Env:
  DB_URL_SECRET_NAME  Secrets Manager secret name (path) whose SecretString is
                      a libpq connection URL
  OUTPUT_BUCKET       Destination S3 bucket.
  EXPORT_DATE         Optional YYYY-MM-DD; defaults to today (UTC).
"""

import datetime as dt
import logging
import os
import uuid

import boto3
import psycopg
from psycopg import sql
import pyarrow as pa
import pyarrow.parquet as pq
from lake.client import LakeApiClient

logger = logging.getLogger()
logger.setLevel(logging.INFO)

LAKE_PREFIX = "budget_management_system_cln"
LAKE_DATABASE_NAME = "budget_management_system_cln"
LAKE_API_ENV = "prod"

TABLE_COLUMNS: dict[str, dict] = {
    "budget_cln": {
        "pg_table": "budgets",
        "columns": [
            ("id", "budget_id"),
            ("product_key", "product_key"),
            ("created_at", "create_utc_ts"),
            ("updated_at", "update_utc_ts"),
            ("deleted_at", "delete_utc_ts"),
        ],
    },
    "budget_item_cln": {
        "pg_table": "budget_items",
        "columns": [
            ("id", "budget_item_id"),
            ("budget_id", "budget_id"),
            ("credits_total", "credit_total"),
            ("credits_used", "credit_used"),
            ("cost_credit_ratio", "cost_credit_usd_rate"),
            ("label", "pool_type_name"),
            ("expires_at", "expire_utc_ts"),
            ("starts_at", "start_utc_ts"),
            ("resets_at", "reset_utc_ts"),
            ("reset_interval", "reset_interval"),
            ("deleted_at", "delete_utc_ts"),
            ("created_at", "create_utc_ts"),
            ("updated_at", "update_utc_ts"),
        ],
    },
    "budget_session_report_item_cln": {
        "pg_table": "budget_session_report_items",
        "columns": [
            ("id", "report_item_id"),
            ("report_id", "report_id"),
            ("budget_cost", "budget_cost_usd_amt"),
            ("product_cost", "product_cost_usd_amt"),
            ("label", "spend_label_name"),
            ("created_at", "create_utc_ts"),
        ],
    },
    "budget_session_report_item_allocation_cln": {
        "pg_table": "budget_session_report_item_allocations",
        "columns": [
            ("report_item_id", "report_item_id"),
            ("budget_item_id", "budget_item_id"),
            ("credits_used", "credit_used"),
        ],
    },
}


def _db_url(secret_id: str) -> str:
    sm = boto3.client("secretsmanager")
    resp = sm.get_secret_value(SecretId=secret_id)
    # The Katana DATABASE_URL secret stores a plain libpq URL, not JSON.
    return resp["SecretString"].strip()


def _connect() -> psycopg.Connection:
    return psycopg.connect(
        _db_url(os.environ["DB_URL_SECRET_NAME"]),
        connect_timeout=10,
    )


def _normalize(value: object) -> object:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (bytearray, memoryview)):
        return bytes(value)
    return value


def _register_lake_partition(table_lake_name: str, year: str, month: str, day: str) -> None:
    if os.environ.get("ENV_NAME") != "prod":
        logger.info("skipping lake partition registration in non-prod env table=%s", table_lake_name)
        return

    response = LakeApiClient(env=LAKE_API_ENV).add_partition(
        database_name=LAKE_DATABASE_NAME,
        table_name=table_lake_name,
        new_partitions=[{"partition_utc_year": year, "partition_utc_month": month, "partition_utc_day": day}],
        metadata={
            "year": year,
            "month": month,
            "day": day,
        },
    )
    logger.info(
        "registered lake partition table=%s year=%s month=%s day=%s response=%s",
        table_lake_name, year, month, day, response,
    )


def _export_table(
    conn: psycopg.Connection,
    lake_table: str,
    pg_table: str,
    columns: list[tuple[str, str]],
    bucket: str,
    export_date: str,
) -> int:
    year, month, day = export_date.split("-")
    key = (
        f"{LAKE_PREFIX}/{lake_table}/"
        f"partition_utc_year={year}/"
        f"partition_utc_month={month}/"
        f"partition_utc_day={day}/data.parquet"
    )

    select_list = sql.SQL(", ").join(
        sql.SQL("{src} AS {dst}").format(
            src=sql.Identifier(src),
            dst=sql.Identifier(dst),
        )
        for src, dst in columns
    )
    query = sql.SQL("SELECT {fields} FROM {table}").format(
        fields=select_list,
        table=sql.Identifier(pg_table),
    )

    rows: list[dict] = []
    with conn.cursor(name=f"export_{lake_table}") as cur:
        cur.itersize = 1000
        # `query` is a psycopg.sql.Composed object built from sql.Identifier
        # over a TABLE_COLUMNS allowlist literal — no user input. Suppress
        # the SQLAlchemy-specific raw-query rule (false positive on psycopg).
        # nosemgrep
        cur.execute(query)
        for row in cur:
            rows.append({dst: _normalize(val) for (_, dst), val in zip(columns, row)})

    arrow_table = pa.Table.from_pylist(rows)

    buf = pa.BufferOutputStream()
    pq.write_table(arrow_table, buf, compression="snappy")
    body = buf.getvalue().to_pybytes()

    boto3.client("s3").put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/vnd.apache.parquet",
    )
    logger.info(
        "exported table=%s rows=%d bytes=%d key=s3://%s/%s",
        lake_table,
        len(rows),
        len(body),
        bucket,
        key,
    )

    _register_lake_partition(lake_table, year, month, day)
    return len(rows)


def lambda_handler(event, context):  # noqa: ARG001
    bucket = os.environ["OUTPUT_BUCKET"]
    export_date = os.environ.get("EXPORT_DATE") or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")

    summary: dict[str, int | str] = {}
    errors: list[str] = []

    with _connect() as conn:
        conn.read_only = True
        for lake_table, spec in TABLE_COLUMNS.items():
            try:
                summary[lake_table] = _export_table(
                    conn, lake_table, spec["pg_table"], spec["columns"], bucket, export_date,
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception("export failed for table=%s", lake_table)
                summary[lake_table] = f"error: {exc}"
                errors.append(lake_table)

    result = {"export_date": export_date, "bucket": bucket, "tables": summary}
    if errors:
        result["failed"] = errors
        raise RuntimeError(f"export failed for tables: {errors}")
    return result
