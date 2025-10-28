#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$SCRIPT_DIR/../bin"
SQLITE_DB="$BIN_DIR/accounts.db"
TB_BINARY="$BIN_DIR/tigerbeetle"

echo "=== SQLite (System of Reference) ==="
echo ""

sqlite3 -header -column "$SQLITE_DB" "SELECT * FROM accounts;" 2>/dev/null || echo "No accounts found"

echo ""
echo "=== TigerBeetle (System of Record) ==="
echo ""

"$TB_BINARY" repl --cluster=0 --addresses=3000 --command="query_accounts limit=100"
