#!/usr/bin/env bash
# DEV-ONLY helper for air-gapped environments: symlinks a pre-installed node_modules
# tree (default /opt/npm-tools/node_modules) into the repo instead of `npm install`.
# On a normal machine just run `npm install` and ignore this script.
set -euo pipefail
SRC="${1:-/opt/npm-tools/node_modules}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/node_modules/@forgehse"
for entry in "$SRC"/* "$SRC"/.bin; do
  name="$(basename "$entry")"
  [ -e "$ROOT/node_modules/$name" ] || ln -s "$entry" "$ROOT/node_modules/$name"
done
ln -sfn "$ROOT/packages/shared" "$ROOT/node_modules/@forgehse/shared"
echo "Linked offline deps from $SRC"
