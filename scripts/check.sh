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

# Build lookup commands from SQLite IDs
CMDS=$(sqlite3 "$SQLITE_DB" "SELECT 'lookup_accounts id=' || guid || ';' FROM accounts;" 2>/dev/null)
if [ -n "$CMDS" ]; then
  echo -e "${CMDS}\nexit" | "$TB_BINARY" repl --cluster=0 --addresses=3000
else
  echo "No accounts found"
fi
