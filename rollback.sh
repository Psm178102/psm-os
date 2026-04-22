#!/usr/bin/env bash
# PSM-OS Rollback Script
# Uso: ./rollback.sh <versao_alvo> (ex: ./rollback.sh 27.8)
#      ./rollback.sh --last (ultima versao estavel do GitHub Release)
set -euo pipefail

SITE_ID="${NETLIFY_PROD_SITE_ID:-}"
AUTH="${NETLIFY_AUTH_TOKEN:-}"
PAGERDUTY_KEY="${PAGERDUTY_ROUTING_KEY:-}"
REPO="${GH_REPO:-seu-usuario/psm-os}"

if [ -z "$SITE_ID" ] || [ -z "$AUTH" ]; then
  echo "ERR: exportar NETLIFY_PROD_SITE_ID e NETLIFY_AUTH_TOKEN"
  exit 1
fi

TARGET="${1:---last}"

echo "=== PSM-OS ROLLBACK ==="
echo "Alvo: $TARGET"
date

# Pega lista de deploys Netlify
DEPLOYS=$(curl -s -H "Authorization: Bearer $AUTH" \
  "https://api.netlify.com/api/v1/sites/$SITE_ID/deploys?per_page=20&state=ready")

if [ "$TARGET" = "--last" ]; then
  # Pega penultimo deploy (ultimo estavel)
  DEPLOY_ID=$(echo "$DEPLOYS" | jq -r '.[1].id')
  DEPLOY_VER=$(echo "$DEPLOYS" | jq -r '.[1].commit_ref')
else
  # Busca release GitHub com tag v$TARGET
  ASSET_URL=$(curl -s "https://api.github.com/repos/$REPO/releases/tags/v$TARGET" | \
    jq -r '.assets[] | select(.name == "index.html") | .browser_download_url')

  if [ -z "$ASSET_URL" ] || [ "$ASSET_URL" = "null" ]; then
    echo "ERR: release v$TARGET nao encontrado"
    exit 1
  fi

  # Baixa e redeployеа manual
  mkdir -p /tmp/psm-rollback
  cd /tmp/psm-rollback
  curl -L -o index.html "$ASSET_URL"
  curl -L -o sw.js "${ASSET_URL%index.html}sw.js"
  mkdir -p lib
  for f in psm-supabase.js psm-native.js psm-ia.js psm-offline.js psm-backup.js psm-monitor.js; do
    curl -L -o "lib/$f" "${ASSET_URL%index.html}lib/$f" || true
  done

  # Deploy via Netlify CLI
  echo "Deploy manual v$TARGET"
  npx netlify-cli deploy --dir=. --prod --site "$SITE_ID" --auth "$AUTH"

  DEPLOY_ID="manual-v$TARGET"
  DEPLOY_VER="v$TARGET"
fi

echo "Rollback para: $DEPLOY_VER (deploy $DEPLOY_ID)"

if [ "$TARGET" = "--last" ]; then
  # Restaura deploy anterior
  curl -s -X POST \
    -H "Authorization: Bearer $AUTH" \
    "https://api.netlify.com/api/v1/sites/$SITE_ID/deploys/$DEPLOY_ID/restore"
fi

# Notificar PagerDuty
if [ -n "$PAGERDUTY_KEY" ]; then
  curl -s -X POST https://events.pagerduty.com/v2/enqueue \
    -H "Content-Type: application/json" \
    -d "{
      \"routing_key\": \"$PAGERDUTY_KEY\",
      \"event_action\": \"trigger\",
      \"payload\": {
        \"summary\": \"PSM-OS ROLLBACK para $DEPLOY_VER\",
        \"severity\": \"warning\",
        \"source\": \"rollback-script\"
      }
    }"
fi

echo "Rollback concluido. Verificar https://psm-os.netlify.app"
