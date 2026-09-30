#!/usr/bin/env bash
set -euo pipefail

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl es obligatorio para validar pymes/k8s" >&2
  exit 2
fi
kubectl kustomize pymes/k8s >/dev/null
manifest="$(kubectl kustomize pymes/k8s)"
for required in "replicas: 1" "readinessProbe" "livenessProbe" "readOnlyRootFilesystem: true" "automountServiceAccountToken: false" "pymes-workspace-secrets" "pymes-workspace-data" "PYMES_OPENCLAW_SIGNING_SECRET"; do
  if ! grep -Fq "${required}" <<<"${manifest}"; then
    echo "Falta requisito Kubernetes: ${required}" >&2
    exit 2
  fi
done
echo "Kubernetes overlay OK: pymes/k8s"
