#!/bin/bash

set -e  # Exit on error

echo "=== Setup TigerBeetle ==="
echo ""

# Define paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$SCRIPT_DIR/../bin"
SQLITE_DB="$BIN_DIR/accounts.db"
TB_DATA_FILE="$BIN_DIR/0_0.tigerbeetle"
TB_BINARY="$BIN_DIR/tigerbeetle"

# Create bin directory if it doesn't exist
mkdir -p "$BIN_DIR"

echo "Step 1: Cleaning up existing databases..."

# Remove SQLite database if it exists
if [ -f "$SQLITE_DB" ]; then
  echo "  - Removing existing SQLite database: $SQLITE_DB"
  rm "$SQLITE_DB"
fi

# Remove TigerBeetle data file if it exists
if [ -f "$TB_DATA_FILE" ]; then
  echo "  - Removing existing TigerBeetle data file: $TB_DATA_FILE"
  rm "$TB_DATA_FILE"
fi

echo "  ✓ Cleanup complete"
echo ""

echo "Step 2: Setting up TigerBeetle..."

# Check if TigerBeetle binary exists
if [ ! -f "$TB_BINARY" ]; then
  echo "  ✗ TigerBeetle binary not found at: $TB_BINARY"
  echo "  Please download TigerBeetle from https://docs.tigerbeetle.com/quick-start/"
  exit 1
fi

# Format TigerBeetle data file
echo "  - Formatting TigerBeetle data file..."
"$TB_BINARY" format --cluster=0 --replica=0 --replica-count=1 "$TB_DATA_FILE"

echo "=== Setup Sqlite ==="
echo ""


# Create SQLite database with schema
sqlite3 "$SQLITE_DB" <<EOF
CREATE TABLE accounts (
  uuid TEXT PRIMARY KEY,
  guid TEXT NOT NULL UNIQUE,
  ledger INTEGER NOT NULL,
  code INTEGER NOT NULL
);
EOF

echo "  ✓ SQLite database created with accounts table"
echo ""

echo "=== Setup Complete ==="
echo ""
echo "To start TigerBeetle server, run:"
echo "  $TB_BINARY start --addresses=3000 $TB_DATA_FILE"
echo ""
echo "Then run the example:"
echo "  npm run demo"
echo ""
