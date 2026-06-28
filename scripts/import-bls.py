#!/usr/bin/env python3
"""Import Bundeslebensmittelschluessel rows into the Food Tracker SQLite DB."""

from __future__ import annotations

import argparse
import html
import re
import shutil
import sqlite3
import tempfile
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

try:
    import openpyxl
except ImportError as exc:  # pragma: no cover - operator setup failure
    raise SystemExit("Missing dependency: python3 -m pip install openpyxl") from exc


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = PROJECT_ROOT / "data" / "food-tracker.sqlite"
DOWNLOAD_PAGE = "https://blsdb.de/download"
DEFAULT_VERSION = "4.0"
DEFAULT_SOURCE_UPDATED_AT = "2025-12-11"


def main() -> None:
    parser = argparse.ArgumentParser(description="Import BLS 4.0 food data into Food Tracker.")
    parser.add_argument("--db", default=str(DEFAULT_DB), help=f"SQLite DB path (default: {DEFAULT_DB})")
    parser.add_argument("--source", help="BLS ZIP/XLSX path or URL. Omit to discover the current download.")
    parser.add_argument("--version", default=DEFAULT_VERSION, help="BLS source version stored per row.")
    parser.add_argument("--source-updated-at", default=DEFAULT_SOURCE_UPDATED_AT, help="BLS data date stored per row.")
    parser.add_argument("--dry-run", action="store_true", help="Parse only; do not write to the database.")
    args = parser.parse_args()

    tmpdir = Path(tempfile.mkdtemp(prefix="food-tracker-bls-"))
    try:
        source_path, source_url = resolve_source(args.source, tmpdir)
        workbook_path = extract_workbook(source_path, tmpdir)
        foods = parse_bls_workbook(workbook_path)

        if args.dry_run:
            print(f"Parsed {len(foods)} BLS foods from {workbook_path.name}; database unchanged.")
            return

        db_path = Path(args.db)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        count = import_foods(db_path, foods, args.version, args.source_updated_at, source_url)
        print(f"Imported {count} BLS foods into {db_path}")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def resolve_source(source: str | None, tmpdir: Path) -> tuple[Path, str]:
    if source:
        if re.match(r"^https?://", source):
            target = tmpdir / source.rsplit("/", 1)[-1].split("?", 1)[0]
            download(source, target)
            return target, source
        return Path(source).expanduser().resolve(), str(Path(source).expanduser().resolve())

    page_html = urllib.request.urlopen(DOWNLOAD_PAGE, timeout=30).read().decode("utf-8", errors="replace")
    hrefs = [html.unescape(match) for match in re.findall(r'href="([^"]+)"', page_html, flags=re.IGNORECASE)]
    href = next((value for value in hrefs if "BLS" in value and ".zip" in value.lower()), "")
    if not href:
        raise SystemExit("Could not find a BLS ZIP download link on blsdb.de/download")

    source_url = urllib.parse.urljoin(DOWNLOAD_PAGE, href)
    target = tmpdir / "bls.zip"
    download(source_url, target)
    return target, DOWNLOAD_PAGE


def download(url: str, target: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "FoodTracker-BLS-Importer/0.1"})
    with urllib.request.urlopen(request, timeout=120) as response, target.open("wb") as handle:
        shutil.copyfileobj(response, handle)


def extract_workbook(source: Path, tmpdir: Path) -> Path:
    if source.suffix.lower() == ".xlsx":
        return source
    if source.suffix.lower() != ".zip":
        raise SystemExit(f"Unsupported BLS source file: {source}")

    with zipfile.ZipFile(source) as archive:
        candidates = [
            name for name in archive.namelist()
            if name.lower().endswith(".xlsx") and "daten" in Path(name).name.lower()
        ]
        if not candidates:
            raise SystemExit("BLS ZIP did not contain a *_Daten_*.xlsx workbook")
        archive.extract(candidates[0], tmpdir)
        return tmpdir / candidates[0]


def parse_bls_workbook(path: Path) -> list[dict[str, object]]:
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    rows = sheet.iter_rows(values_only=True)
    headers = [str(value or "") for value in next(rows)]
    columns = find_columns(headers)
    foods: list[dict[str, object]] = []

    for row in rows:
        code = clean_text(row[columns["code"]])
        name_de = clean_text(row[columns["name_de"]])
        name_en = clean_text(row[columns["name_en"]])
        calories = numeric(row[columns["calories"]])
        protein = numeric(row[columns["protein"]])
        carbs = numeric(row[columns["carbs"]])
        fat = numeric(row[columns["fat"]])

        if not code or not name_de:
            continue
        if any(value is None or value < 0 for value in [calories, protein, carbs, fat]):
            continue

        foods.append({
            "id": f"bls:{code.lower()}",
            "code": code,
            "name": name_de,
            "brand": "",
            "calories": round(float(calories), 1),
            "protein": round(float(protein), 1),
            "carbs": round(float(carbs), 1),
            "fat": round(float(fat), 1),
            "priority": bls_priority(name_de),
            "aliases": list(build_aliases(name_de, name_en, code)),
        })

    return foods


def find_columns(headers: list[str]) -> dict[str, int]:
    normalized = [normalize_header(header) for header in headers]

    def find(*needles: str) -> int:
        for index, header in enumerate(normalized):
            if all(needle in header for needle in needles):
                return index
        raise SystemExit(f"Missing BLS column matching: {' '.join(needles)}")

    return {
        "code": find("bls code"),
        "name_de": find("lebensmittelbezeichnung"),
        "name_en": find("food name"),
        "calories": find("enercc", "kilokalorien"),
        "protein": find("prot625", "protein"),
        "fat": find("fat", "fett"),
        "carbs": find("cho", "kohlenhydrate"),
    }


def import_foods(db_path: Path, foods: list[dict[str, object]], version: str, source_updated_at: str, source_url: str) -> int:
    imported_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        ensure_schema(conn)
        conn.execute("BEGIN")
        conn.execute("DELETE FROM food_aliases WHERE food_id IN (SELECT id FROM foods WHERE source = 'BLS')")
        conn.execute("DELETE FROM foods WHERE source = 'BLS'")
        for food in foods:
            conn.execute(
                """
                INSERT INTO foods (
                  id, name, normalized_name, brand, normalized_brand, calories_per_100g,
                  protein_per_100g, carbs_per_100g, fat_per_100g, image_url, source,
                  source_version, source_updated_at, priority
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'BLS', ?, ?, ?)
                """,
                (
                    food["id"],
                    food["name"],
                    normalize_food_key(food["name"]),
                    food["brand"],
                    normalize_food_key(food["brand"]),
                    food["calories"],
                    food["protein"],
                    food["carbs"],
                    food["fat"],
                    version,
                    source_updated_at,
                    food["priority"],
                ),
            )
            for alias in food["aliases"]:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO food_aliases (food_id, alias, normalized_alias)
                    VALUES (?, ?, ?)
                    """,
                    (food["id"], alias, normalize_food_key(alias)),
                )
        conn.execute(
            """
            INSERT INTO food_source_imports (source, source_version, source_url, imported_at, record_count)
            VALUES ('BLS', ?, ?, ?, ?)
            ON CONFLICT(source) DO UPDATE SET
              source_version = excluded.source_version,
              source_url = excluded.source_url,
              imported_at = excluded.imported_at,
              record_count = excluded.record_count
            """,
            (version, source_url, imported_at, len(foods)),
        )
    return len(foods)


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS foods (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          normalized_name TEXT NOT NULL,
          brand TEXT NOT NULL DEFAULT '',
          normalized_brand TEXT NOT NULL DEFAULT '',
          calories_per_100g REAL NOT NULL,
          protein_per_100g REAL NOT NULL,
          carbs_per_100g REAL NOT NULL,
          fat_per_100g REAL NOT NULL,
          image_url TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'SQLite',
          source_version TEXT NOT NULL DEFAULT '',
          source_updated_at TEXT NOT NULL DEFAULT '',
          priority INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS food_aliases (
          food_id TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
          alias TEXT NOT NULL,
          normalized_alias TEXT NOT NULL,
          PRIMARY KEY (food_id, normalized_alias)
        );
        CREATE INDEX IF NOT EXISTS idx_foods_normalized_name ON foods(normalized_name);
        CREATE INDEX IF NOT EXISTS idx_food_aliases_normalized_alias ON food_aliases(normalized_alias);
        CREATE TABLE IF NOT EXISTS food_source_imports (
          source TEXT PRIMARY KEY,
          source_version TEXT NOT NULL DEFAULT '',
          source_url TEXT NOT NULL DEFAULT '',
          imported_at TEXT NOT NULL,
          record_count INTEGER NOT NULL DEFAULT 0
        );
        """
    )
    add_column_if_missing(conn, "foods", "image_url", "TEXT NOT NULL DEFAULT ''")
    add_column_if_missing(conn, "foods", "source_version", "TEXT NOT NULL DEFAULT ''")
    add_column_if_missing(conn, "foods", "source_updated_at", "TEXT NOT NULL DEFAULT ''")


def add_column_if_missing(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def build_aliases(name_de: str, name_en: str, code: str) -> Iterable[str]:
    seen: set[str] = set()
    for alias in [name_de, name_en, code, strip_trailing_state(name_de), strip_trailing_state(name_en)]:
        alias = clean_text(alias)
        if not alias:
            continue
        for candidate in [alias, compact_alias(alias)]:
            normalized = normalize_food_key(candidate)
            if len(normalized) < 2 or normalized in seen:
                continue
            seen.add(normalized)
            yield candidate


def strip_trailing_state(value: str) -> str:
    value = clean_text(value)
    value = re.sub(r",\s*(roh|raw|gegart|cooked|tiefgefroren|frozen)$", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s+(roh|raw)$", "", value, flags=re.IGNORECASE)
    return value


def bls_priority(name_de: str) -> int:
    normalized = normalize_food_key(name_de)
    if normalized.endswith(" roh"):
        return 80
    if re.search(r"\b(frisch|natur)$", normalized):
        return 40
    if any(word in normalized for word in ["melba", "torte", "kompott", "konserve", "nektar", "suess"]):
        return 5
    return 10


def compact_alias(value: str) -> str:
    compact = re.sub(r"[\s\-]+", "", value)
    return compact if compact != value else ""


def normalize_header(value: str) -> str:
    return normalize_food_key(value)


def normalize_food_key(value: object) -> str:
    text = unicodedata.normalize("NFD", str(value or "").lower())
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = text.replace("ß", "ss")
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def clean_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def numeric(value: object) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        value = value.replace(",", ".")
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number


if __name__ == "__main__":
    main()
