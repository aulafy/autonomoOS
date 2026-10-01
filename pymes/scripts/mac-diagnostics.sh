#!/usr/bin/env bash
set -euo pipefail
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Este diagnóstico requiere macOS.' >&2
  exit 2
fi
printf 'Sistema: macOS %s\n' "$(sw_vers -productVersion)"
printf 'Arquitectura: %s\n' "$(uname -m)"
bytes="$(sysctl -n hw.memsize)"
printf 'Memoria física: %s GiB\n' "$((bytes / 1024 / 1024 / 1024))"
for tool in node npm ollama; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf '%s: instalado\n' "$tool"
  else
    printf '%s: pendiente de instalar\n' "$tool"
  fi
done
printf 'Espacio disponible en la carpeta actual:\n'
df -h . | tail -1
printf 'Este diagnóstico no comprueba APIs ni credenciales.\n'
