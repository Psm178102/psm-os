# PSM OS - One-liner: configura Vercel env vars + dispara redeploy
# Uso:
#   $env:V="vcp_xxx"; $env:U="https://xxxx.supabase.co"; $env:A="eyJhbGc..."; iex(irm "https://raw.githubusercontent.com/Psm178102/psm-os/main/scripts/oneliner.ps1")
$ErrorActionPreference = "Stop"
$V = $env:V; $U = $env:U; $A = $env:A
if (-not $V -or -not $U -or -not $A) { Write-Host "ERRO: defina V, U, A antes" -ForegroundColor Red; return }
$H = @{ "Authorization"="Bearer $V"; "Content-Type"="application/json" }
Write-Host "==> validando Vercel token..." -ForegroundColor Cyan
$u = Invoke-RestMethod "https://api.vercel.com/v2/user" -Headers $H
Write-Host "   OK: $($u.user.username)" -ForegroundColor Green
Write-Host "==> achando projeto psm-os..." -ForegroundColor Cyan
$p = (Invoke-RestMethod "https://api.vercel.com/v9/projects?limit=100" -Headers $H).projects | Where-Object name -eq "psm-os"
if (-not $p) { Write-Host "ERRO: projeto nao encontrado" -ForegroundColor Red; return }
$projId = $p.id; $rid = $p.link.repoId
Write-Host "   OK: $projId (repo=$rid)" -ForegroundColor Green
Write-Host "==> removendo env vars antigas..." -ForegroundColor Cyan
$ex = (Invoke-RestMethod "https://api.vercel.com/v10/projects/$projId/env?decrypt=false" -Headers $H).envs
foreach ($n in @("SUPABASE_URL","SUPABASE_ANON_KEY","PSM_SYNC_MODE")) {
  foreach ($e in ($ex | Where-Object key -eq $n)) {
    try { Invoke-RestMethod "https://api.vercel.com/v9/projects/$projId/env/$($e.id)" -Headers $H -Method DELETE | Out-Null; Write-Host "   - $n" -ForegroundColor DarkGray } catch {}
  }
}
function Mk($k,$v){ $b=@{key=$k;value=$v;type="encrypted";target=@("production","preview","development")}|ConvertTo-Json; Invoke-RestMethod "https://api.vercel.com/v10/projects/$projId/env" -Headers $H -Method POST -Body $b|Out-Null; Write-Host "   + $k" -ForegroundColor Green }
Mk "SUPABASE_URL" $U
Mk "SUPABASE_ANON_KEY" $A
Mk "PSM_SYNC_MODE" "parallel"
Write-Host "==> disparando redeploy em main..." -ForegroundColor Cyan
$d = @{ name="psm-os"; target="production"; gitSource=@{ type="github"; ref="main"; repoId=$rid } } | ConvertTo-Json -Depth 5
try {
  $r = Invoke-RestMethod "https://api.vercel.com/v13/deployments?forceNew=1" -Headers $H -Method POST -Body $d
  Write-Host "   OK: https://$($r.url)" -ForegroundColor Green
} catch { Write-Host "   AVISO: falhou disparar; va em Vercel Dashboard -> Redeploy" -ForegroundColor Yellow }
Write-Host ""
Write-Host "PRONTO! Em ~2 min abre https://housepsm.com.br" -ForegroundColor Green
Write-Host "F12 -> Console -> window.psmDb.isReady()  (deve retornar True)" -ForegroundColor Green
Write-Host "REVOGA o token Vercel em https://vercel.com/account/tokens" -ForegroundColor Yellow
