#!/usr/bin/env bash
set -euo pipefail

spec="pymes/openclaw-ingress.openapi.yaml"
[[ -f "$spec" ]] || { echo "Missing $spec" >&2; exit 2; }

python3 - "$spec" <<'PY'
from pathlib import Path
import sys

text = Path(sys.argv[1]).read_text(encoding="utf-8")
required = (
    "openapi: 3.1.0",
    "/v1/workspaces/{tenant}/ingress/openclaw:",
    "operationId: ingestOpenClawEvent",
    "X-PYMES-Ingress-Token",
    "X-PYMES-Ingress-Signature",
    "OpenClawEnvelope",
    "OpenClawInboundEvent",
    "'201':",
    "'409':",
    "'422':",
)
missing = [item for item in required if item not in text]
if missing:
    print("OpenClaw OpenAPI contract missing: " + ", ".join(missing), file=sys.stderr)
    raise SystemExit(1)
print("OpenClaw ingress contract OK: " + sys.argv[1])
PY
