#!/usr/bin/env bash
# Downloads the official PostgREST release binary into .tools/ (used only by local API integration tests
# and the local preview stack). Source: https://github.com/PostgREST/postgrest/releases
set -euo pipefail
VERSION="${POSTGREST_VERSION:-v16.5}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.tools"
mkdir -p "$DEST"
if [[ -x "$DEST/postgrest" ]]; then "$DEST/postgrest" --version; exit 0; fi
case "$(uname -s)-$(uname -m)" in
  Darwin-x86_64) ASSET="postgrest-$VERSION-macos-x86-64.tar.xz" ;;
  Darwin-arm64) ASSET="postgrest-$VERSION-macos-aarch64.tar.xz" ;;
  Linux-x86_64) ASSET="postgrest-$VERSION-linux-static-x86-64.tar.xz" ;;
  Linux-aarch64) ASSET="postgrest-$VERSION-linux-static-aarch64.tar.xz" ;;
  *) echo "Unsupported platform $(uname -s)-$(uname -m)"; exit 1 ;;
esac
TMP="$(mktemp -d)"
curl -fsSL -o "$TMP/$ASSET" "https://github.com/PostgREST/postgrest/releases/download/$VERSION/$ASSET"
tar -xJf "$TMP/$ASSET" -C "$DEST"
chmod +x "$DEST/postgrest"
"$DEST/postgrest" --version
