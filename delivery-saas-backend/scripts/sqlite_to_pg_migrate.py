"""
Migra dados do SQLite (dev.db) para PostgreSQL (Docker dev).

Uso:
  python scripts/sqlite_to_pg_migrate.py [--sqlite prisma/dev.db] [--pg-url postgresql://...]

- Não derruba nem recria tabelas (schema já existe via prisma db push)
- Desativa FK checks durante a migração para evitar erros de ordem de inserção
- Converte tipos: SQLite boolean 0/1 → PG true/false, TEXT → JSONB, etc.
- Ignora tabelas do Prisma (_prisma_migrations)
- INSERT ... ON CONFLICT DO NOTHING (idempotente: pode rodar mais de uma vez)
"""

import sqlite3
import psycopg2
import psycopg2.extras
import json
import sys
import argparse
from datetime import datetime, timezone

DEFAULT_SQLITE = "prisma/dev.db"
DEFAULT_PG = "postgresql://postgres:postgres@localhost:5433/projetodelivery"

SKIP_TABLES = {"_prisma_migrations"}

# Ordem de inserção para respeitar FKs (pais antes dos filhos)
# Tabelas não listadas aqui serão inseridas depois, na ordem que vierem do SQLite
TABLE_ORDER = [
    "Company",
    "Store",
    "SaasModule",
    "SaasPlan",
    "SaasPlanModule",
    "SaasPlanPrice",
    "SaasSubscription",
    "User",
    "Rider",
    "RiderAccount",
    "Menu",
    "MenuCategory",
    "IngredientGroup",
    "Ingredient",
    "OptionGroup",
    "Option",
    "Product",
    "ProductOptionGroup",
    "TechnicalSheet",
    "TechnicalSheetItem",
    "PaymentMethod",
    "Neighborhood",
    "Customer",
    "CustomerAccount",
    "CustomerAddress",
    "CustomerGroup",
    "CustomerGroupRule",
    "CustomerGroupMember",
    "CashbackSetting",
    "CashbackProductRule",
    "CashbackWallet",
    "CashbackTransaction",
    "Affiliate",
    "AffiliateSale",
    "AffiliatePayment",
    "Coupon",
    "Order",
    "OrderItem",
    "OrderStatusHistory",
    "RiderTransaction",
    "PrinterSetting",
    "WhatsAppInstance",
    "ApiIntegration",
    "NfeProtocol",
    "DadosFiscais",
    "EmailVerification",
    "Media",
    "FileSource",
    "MetaPixel",
    "PaymentGatewayConfig",
    "WebhookEvent",
    "FinancialAccount",
    "FinancialTransaction",
    "CostCenter",
    "CashFlowEntry",
    "OfxImport",
    "OfxReconciliationItem",
    "StockMovement",
    "StockMovementItem",
    "CashSession",
    "CashMovement",
    "Ticket",
]


def get_sqlite_tables(conn):
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    return {row[0] for row in cur.fetchall()}


def get_sqlite_columns(conn, table):
    cur = conn.cursor()
    cur.execute(f"PRAGMA table_info(\"{table}\")")
    return [row[1] for row in cur.fetchall()]


def get_pg_columns_info(pg_conn, table):
    """Returns dict: column_name -> data_type"""
    cur = pg_conn.cursor()
    cur.execute("""
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        ORDER BY ordinal_position
    """, (table,))
    return {row[0]: {"data_type": row[1], "udt_name": row[2]} for row in cur.fetchall()}


def convert_value(value, pg_type_info):
    if value is None:
        return None
    data_type = pg_type_info.get("data_type", "")
    udt_name = pg_type_info.get("udt_name", "")

    # Boolean: SQLite stores 0/1
    if data_type == "boolean":
        if isinstance(value, int):
            return bool(value)
        if isinstance(value, str):
            return value.lower() in ("1", "true", "t", "yes")
        return bool(value)

    # JSONB / JSON: SQLite stores as TEXT or Prisma may have parsed it already
    if data_type in ("json",) or udt_name in ("jsonb", "json"):
        if isinstance(value, (dict, list)):
            # Already a Python object — wrap for psycopg2
            return psycopg2.extras.Json(value)
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                return psycopg2.extras.Json(parsed)
            except (json.JSONDecodeError, ValueError):
                return value
        return value

    # Decimal / numeric: ensure string format for psycopg2
    if data_type in ("numeric",):
        if value == "":
            return None
        return value  # psycopg2 handles string → numeric

    # Timestamp: Prisma SQLite stores as Unix ms (bigint) OR as ISO string
    if "timestamp" in data_type:
        if isinstance(value, int):
            # Unix timestamp in milliseconds (Prisma convention for SQLite)
            try:
                return datetime.fromtimestamp(value / 1000, tz=timezone.utc).replace(tzinfo=None)
            except (OSError, OverflowError, ValueError):
                return None
        if isinstance(value, str):
            for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ",
                        "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S",
                        "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
                try:
                    return datetime.strptime(value, fmt)
                except ValueError:
                    continue
            return value
        return value

    return value


def migrate_table(sqlite_conn, pg_conn, table, pg_cols_info):
    sqlite_cols = get_sqlite_columns(sqlite_conn, table)
    # Only migrate columns that exist in BOTH SQLite and PostgreSQL
    common_cols = [c for c in sqlite_cols if c in pg_cols_info]

    if not common_cols:
        print(f"  SKIP {table}: no common columns")
        return 0, 0

    sqlite_cur = sqlite_conn.cursor()
    sqlite_cur.execute(f"SELECT {', '.join(chr(34)+c+chr(34) for c in common_cols)} FROM \"{table}\"")
    rows = sqlite_cur.fetchall()

    if not rows:
        print(f"  {table}: 0 rows (empty)")
        return 0, 0

    pg_cur = pg_conn.cursor()
    col_list = ", ".join(f'"{c}"' for c in common_cols)
    placeholders = ", ".join(["%s"] * len(common_cols))
    sql = f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'

    inserted = 0
    errors = 0
    for row in rows:
        converted = tuple(
            convert_value(val, pg_cols_info[col])
            for val, col in zip(row, common_cols)
        )
        try:
            pg_cur.execute(sql, converted)
            if pg_cur.rowcount > 0:
                inserted += 1
        except Exception as e:
            errors += 1
            if errors <= 3:
                print(f"    ERROR inserting into {table}: {e}")
                print(f"    Row (first 3 cols): {converted[:3]}")
            pg_conn.rollback()
            # Try to recover and continue
            pg_conn.autocommit = False

    pg_conn.commit()
    return inserted, errors


def main():
    parser = argparse.ArgumentParser(description="Migrate SQLite dev.db to PostgreSQL")
    parser.add_argument("--sqlite", default=DEFAULT_SQLITE, help="Path to SQLite dev.db")
    parser.add_argument("--pg-url", default=DEFAULT_PG, help="PostgreSQL connection URL")
    args = parser.parse_args()

    print(f"SQLite: {args.sqlite}")
    print(f"PostgreSQL: {args.pg_url}")
    print()

    sqlite_conn = sqlite3.connect(args.sqlite)
    sqlite_conn.row_factory = sqlite3.Row

    pg_conn = psycopg2.connect(args.pg_url)
    pg_conn.autocommit = False

    # Disable FK checks during migration (session_replication_role = replica)
    pg_cur = pg_conn.cursor()
    pg_cur.execute("SET session_replication_role = 'replica'")
    pg_conn.commit()
    print("FK constraints disabled for migration session.\n")

    sqlite_tables = get_sqlite_tables(sqlite_conn)
    print(f"Tables in SQLite: {sorted(sqlite_tables)}\n")

    # Build ordered list: first the explicitly ordered tables (that exist), then the rest
    existing_ordered = [t for t in TABLE_ORDER if t in sqlite_tables]
    remaining = sorted(sqlite_tables - set(existing_ordered) - SKIP_TABLES)
    all_tables = existing_ordered + remaining

    total_inserted = 0
    total_errors = 0

    for table in all_tables:
        if table in SKIP_TABLES:
            continue
        pg_cols_info = get_pg_columns_info(pg_conn, table)
        if not pg_cols_info:
            print(f"  SKIP {table}: table not found in PostgreSQL")
            continue

        try:
            inserted, errors = migrate_table(sqlite_conn, pg_conn, table, pg_cols_info)
            total_inserted += inserted
            total_errors += errors
            status = "OK" if errors == 0 else f"({errors} errors)"
            print(f"  {table}: {inserted} inserted {status}")
        except Exception as e:
            print(f"  ERROR in table {table}: {e}")
            pg_conn.rollback()
            total_errors += 1

    # Re-enable FK constraints
    pg_cur = pg_conn.cursor()
    pg_cur.execute("SET session_replication_role = 'origin'")
    pg_conn.commit()
    print(f"\nFK constraints re-enabled.")
    print(f"\nMigration complete: {total_inserted} rows inserted, {total_errors} errors.")

    sqlite_conn.close()
    pg_conn.close()


if __name__ == "__main__":
    main()
