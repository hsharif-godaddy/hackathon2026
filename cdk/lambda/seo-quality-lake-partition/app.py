"""
Hourly DLMS partition registration for SEO quality lake tables.

Registers the previous UTC hour via LakeApiClient.add_partition using
partition_utc_year/month/day/hour keys aligned with BFF S3 writes.

Env:
  LAKE_API_ENV          dev | test | prod — DLMS host (laketest tables use test)
  LAKE_DATABASE_NAME    e.g. airo_builder_cln_laketest
  LAKE_TABLE_NAME       e.g. airo_builder_seo_quality_cln_laketest
"""

import datetime as dt
import logging
import os

from lake.client import LakeApiClient

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def _register_partition(year: str, month: str, day: str, hour: str) -> None:
    response = LakeApiClient(env=os.environ["LAKE_API_ENV"]).add_partition(
        database_name=os.environ["LAKE_DATABASE_NAME"],
        table_name=os.environ["LAKE_TABLE_NAME"],
        new_partitions=[{
            "partition_utc_year": year,
            "partition_utc_month": month,
            "partition_utc_day": day,
            "partition_utc_hour": hour,
        }],
        metadata={
            "year": year,
            "month": month,
            "day": day,
            "hour": hour,
        },
    )
    logger.info(
        "registered lake partition db=%s table=%s year=%s month=%s day=%s hour=%s response=%s",
        os.environ["LAKE_DATABASE_NAME"],
        os.environ["LAKE_TABLE_NAME"],
        year,
        month,
        day,
        hour,
        response,
    )


def lambda_handler(event, context):  # noqa: ARG001
    lake_api_env = os.environ["LAKE_API_ENV"]
    lake_database = os.environ["LAKE_DATABASE_NAME"]
    lake_table = os.environ["LAKE_TABLE_NAME"]
    ts = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)
    year = ts.strftime("%Y")
    month = ts.strftime("%m")
    day = ts.strftime("%d")
    hour = ts.strftime("%H")

    startup_msg = (
        "seo-quality-lake-partition v2 "
        f"lake_api_env={lake_api_env} db={lake_database} table={lake_table} "
        f"partition_utc_year={year} partition_utc_month={month} "
        f"partition_utc_day={day} partition_utc_hour={hour}"
    )
    logger.info(startup_msg)
    print(startup_msg)

    _register_partition(year, month, day, hour)
    return {
        "lake_api_env": lake_api_env,
        "lake_database": lake_database,
        "lake_table": lake_table,
        "partition": {"year": year, "month": month, "day": day, "hour": hour},
    }
