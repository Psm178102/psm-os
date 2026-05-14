#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# House PSM · gen-admin-hash.sh
# Gera o SHA-256 hex de uma senha para colar em ADMIN_SHA256 (Vercel env var).
#
# Uso:
#   bash scripts/gen-admin-hash.sh                    # pergunta a senha (oculta)
#   bash scripts/gen-admin-hash.sh "minha-senha"      # passa direto (NÃO recomendado)
#
# A senha NÃO é armazenada em lugar nenhum — só o hash de 64 chars é gerado.
# ═════════════════════════════════════════════════════════════════════════════
set -euo pipefail

if [ -n "${1:-}" ]; then
  PW="$1"
  echo "⚠️  Senha passada via argumento (pode ficar no history do shell)"
else
  echo "Digite a senha do admin (mínimo 12 caracteres, mistura letras/números/símbolos):"
  read -rs PW
  echo
  echo "Confirme a senha:"
  read -rs PW2
  echo
  if [ "$PW" != "$PW2" ]; then
    echo "❌ Senhas não conferem. Aborte."
    exit 1
  fi
fi

if [ ${#PW} -lt 8 ]; then
  echo "❌ Senha muito curta (mínimo 8 chars). Aborte."
  exit 1
fi

if [ ${#PW} -lt 12 ]; then
  echo "⚠️  Senha tem menos de 12 caracteres. Recomenda-se mais para produção."
fi

# Gera SHA-256 hex
if command -v shasum >/dev/null 2>&1; then
  HASH=$(printf '%s' "$PW" | shasum -a 256 | awk '{print $1}')
elif command -v sha256sum >/dev/null 2>&1; then
  HASH=$(printf '%s' "$PW" | sha256sum | awk '{print $1}')
else
  echo "❌ Nem 'shasum' nem 'sha256sum' disponíveis. Instale um deles."
  exit 1
fi

echo
echo "✅ Hash gerado (cole em ADMIN_SHA256 no Vercel):"
echo
echo "   $HASH"
echo
echo "⚠️  GUARDE A SENHA original em local seguro (1Password, Bitwarden, etc)."
echo "    O hash é one-way — sem a senha original não tem como recuperar o admin."
echo

# Limpa a variavel da memoria
unset PW PW2
