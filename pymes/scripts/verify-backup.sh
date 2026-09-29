#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Uso: verify-backup.sh <backup.tgz>" >&2
  exit 2
fi
archive="$1"
checksum="${archive}.sha256"
if [[ ! -f "$archive" || ! -f "$checksum" ]]; then
  echo "Backup o checksum no encontrado" >&2
  exit 2
fi
sha256sum --check "$checksum"
tar tzf "$archive" >/dev/null
echo "Backup íntegro y legible: $archive"
