#!/usr/bin/env bash
set -euo pipefail

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl es obligatorio para validar pymes/k8s" >&2
  exit 2
fi
kubectl kustomize pymes/k8s >/dev/null
echo "Kubernetes overlay OK: pymes/k8s"
