#!/usr/bin/env bash
# Sends n8n/sample-lead.json to the n8n webhook.
# Usage: ./n8n/send-test-lead.sh [webhook-url] [payload-file]
# Default URL is the editor's test URL (click "Execute workflow" in n8n first).
# After activation use http://localhost:5678/webhook/leadpilot-intake instead.
# The webhook requires Header Auth: export N8N_WEBHOOK_HEADER="X-LeadPilot-Token: <value>" (the value of
# the "LeadPilot webhook token" credential selected on the webhook node).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="${1:-${N8N_WEBHOOK_URL:-http://localhost:5678/webhook-test/leadpilot-intake}}"
PAYLOAD="${2:-$DIR/sample-lead.json}"

args=(-sS -w '\nHTTP %{http_code}\n' -X POST "$URL" -H 'Content-Type: application/json' --data-binary "@$PAYLOAD")
if [[ -z "${N8N_WEBHOOK_HEADER:-}" ]]; then
  echo 'N8N_WEBHOOK_HEADER is not set; n8n will reject the request. Example: export N8N_WEBHOOK_HEADER="X-LeadPilot-Token: <value>"' >&2
else
  args+=(-H "$N8N_WEBHOOK_HEADER")
fi

curl "${args[@]}"
