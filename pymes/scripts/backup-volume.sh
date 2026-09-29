#!/usr/bin/env bash
set -euo pipefail

output_dir="${1:-./backups}"
volume_name="${PYMES_VOLUME_NAME:-agent-world-os_pymes-data}"
mkdir -p "$output_dir"
timestamp="$(date +%Y%m%d-%H%M%S)"
archive="$output_dir/pymes-$timestamp.tgz"

docker run --rm \
  -v "$volume_name:/data:ro" \
  -v "$(cd "$output_dir" && pwd):/backup" \
  alpine sh -c "tar czf /backup/$(basename "$archive") -C /data ."

printf 'Backup creado: %s\n' "$archive"
