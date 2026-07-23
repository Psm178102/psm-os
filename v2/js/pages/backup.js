/* PSM-OS v2 — Backup & Restore (Sprint 7.27) */
import { api, tokenStore } from '../api.js';
import { auth } from '../auth.js';

let _root = null;

export async function pageBackup(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio (lvl 7+).</div>';
    return;
  }
  render();
}

function render() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">💾 Backup & Restore</h2>
      <p class="card-sub">Exportar/importar snapshot completo do banco. Só Sócios. Toda ação é auditada.</p>

      <h3 class="card-title mt-4">⬇️ Exportar backup manual</h3>
      <p class="tiny muted">Baixa JSON com dump de 16 tabelas (users, imoveis, lancamentos, locacoes, metas, deals, dir_tasks, eventos, audit_log últimos 1000, concorrentes, shared_kv, one_on_ones, plantoes, notifications últimas 1000, tarefas, comentarios). Limit 5000 linhas/tabela.</p>
      <div class="card" style="background:var(--bg-3);margin:8px 0;padding:14px">
        <button class="btn btn-primary" id="bk-export">📥 Baixar backup agora</button>
        <div id="bk-export-msg" class="mt-2"></div>
      </div>

      <h3 class="card-title mt-4">⬆️ Restaurar backup</h3>
      <p class="tiny muted">⚠️ Upload de JSON exportado. Faz <b>upsert</b> (atualiza existentes, insere novos). Não deleta. Audit log NÃO é restaurável.</p>
      <div class="card" style="background:var(--bg-3);margin:8px 0;padding:14px">
        <input type="file" id="bk-file" accept="application/json" class="input" style="margin-bottom:8px">
        <div class="flex gap-2" style="flex-wrap:wrap;align-items:center">
          <label class="tiny" style="display:flex;align-items:center;gap:6px"><input type="radio" name="bk-mode" value="upsert" checked> Upsert (padrão)</label>
          <label class="tiny" style="display:flex;align-items:center;gap:6px"><input type="radio" name="bk-mode" value="insert"> Insert only</label>
          <button class="btn btn-warn" id="bk-restore" style="margin-left:auto" disabled>🔄 Restaurar</button>
        </div>
        <div id="bk-restore-msg" class="mt-2"></div>
      </div>

      <h3 class="card-title mt-4">🛟 Backup automático interno (Supabase Storage)</h3>
      <p class="tiny muted">v84.90 — roda SOZINHO 1×/dia (heartbeat), sem credencial nenhuma: snapshot completo comprimido no Storage privado do projeto, rotação de 30 dias. Nasceu do incidente de 22/07 (config perdida sem backup pra restaurar). O Drive abaixo vira a cópia EXTERNA opcional.</p>
      <div class="card" style="background:var(--bg-3);margin:8px 0;padding:14px">
        <div class="flex gap-2" style="flex-wrap:wrap;align-items:center">
          <button class="btn btn-primary" id="bk-auto">🛟 Rodar backup agora</button>
          <button class="btn btn-ghost" id="bk-auto-list">📄 Ver backups guardados</button>
        </div>
        <div id="bk-auto-msg" class="mt-2"></div>
      </div>

      <h3 class="card-title mt-4">☁️ Backup automático Google Drive</h3>
      <p class="tiny muted">Dispara backup pro Drive. Requer GOOGLE_DRIVE_TOKEN + GOOGLE_DRIVE_FOLDER_ID nas env vars Vercel. Pode ser agendado via Cron diário.</p>
      <div class="card" style="background:var(--bg-3);margin:8px 0;padding:14px">
        <button class="btn btn-primary" id="bk-drive">☁️ Disparar backup Drive</button>
        <div id="bk-drive-msg" class="mt-2"></div>
      </div>
    </div>
  `;

  document.getElementById('bk-export').addEventListener('click', exportBackup);
  document.getElementById('bk-drive').addEventListener('click', driveBackup);
  document.getElementById('bk-auto').addEventListener('click', autoBackup);
  document.getElementById('bk-auto-list').addEventListener('click', autoBackupList);

  const fileInput = document.getElementById('bk-file');
  const restoreBtn = document.getElementById('bk-restore');
  fileInput.addEventListener('change', () => { restoreBtn.disabled = !fileInput.files.length; });
  restoreBtn.addEventListener('click', restoreBackup);
}

async function exportBackup() {
  const btn = document.getElementById('bk-export');
  const msg = document.getElementById('bk-export-msg');
  btn.disabled = true;
  msg.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Gerando dump…</div>';
  try {
    const tok = tokenStore.get();
    const resp = await fetch('/api/v3/backup/export', { headers: { 'Authorization': 'Bearer ' + tok } });
    if (!resp.ok) {
      const t = await resp.text();
      msg.innerHTML = `<div class="alert alert-err">HTTP ${resp.status}: ${escapeHtml(t.substring(0,200))}</div>`;
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `psm_os_backup_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'')}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    msg.innerHTML = `<div class="alert alert-ok">✅ Backup baixado · ${(blob.size/1024).toFixed(1)} KB</div>`;
  } catch (e) {
    msg.innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

async function restoreBackup() {
  const file = document.getElementById('bk-file').files[0];
  const mode = document.querySelector('input[name="bk-mode"]:checked').value;
  const btn = document.getElementById('bk-restore');
  const msg = document.getElementById('bk-restore-msg');
  if (!file) return;

  if (!confirm(`⚠️ Restaurar backup em modo ${mode.toUpperCase()}?\n\nIsso vai aplicar todos os dados do arquivo no banco. Confirma?`)) return;

  btn.disabled = true;
  msg.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Lendo arquivo…</div>';
  try {
    const text = await file.text();
    let dump;
    try { dump = JSON.parse(text); } catch(e) {
      msg.innerHTML = '<div class="alert alert-err">JSON inválido</div>';
      btn.disabled = false; return;
    }
    if (!dump.tables) {
      msg.innerHTML = '<div class="alert alert-err">Arquivo sem campo "tables" — não é backup PSM-OS</div>';
      btn.disabled = false; return;
    }
    msg.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Restaurando…</div>';
    const r = await api.request('/api/v3/backup/restore', { method: 'POST', body: {
      tables: dump.tables,
      options: { mode },
    }});
    const okTables = Object.entries(r.tables || {}).filter(([,v]) => !v.error).length;
    const errTables = Object.entries(r.tables || {}).filter(([,v]) => v.error);
    const skipped = (r.skipped_tables || []).length;
    msg.innerHTML = `
      <div class="alert ${r.ok ? 'alert-ok' : 'alert-warn'}">
        ${r.ok ? '✅' : '⚠️'} ${r.total_rows} linhas restauradas · ${okTables} tabelas OK
        ${errTables.length ? ` · ${errTables.length} com erro` : ''}
        ${skipped ? ` · ${skipped} ignoradas` : ''}
      </div>
      <pre class="tiny" style="background:#0b1220;color:#cbd5e1;padding:8px;border-radius:6px;max-height:200px;overflow:auto;margin-top:6px">${escapeHtml(JSON.stringify(r, null, 2))}</pre>
    `;
  } catch (e) {
    msg.innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

/* v84.90 — 🛟 backup interno (Storage do Supabase, sem credencial de usuário) */
async function autoBackup() {
  const msg = document.getElementById('bk-auto-msg');
  msg.innerHTML = '<span class="spinner"></span> <span class="tiny muted">Coletando e comprimindo tudo…</span>';
  try {
    const r = await api.request('/api/v3/backup/auto');
    msg.innerHTML = r.ok
      ? `<div class="alert alert-ok tiny">✅ <b>${r.arquivo}</b> — ${r.linhas} linhas, ${(r.bytes_gz / 1024).toFixed(0)} KB comprimido${r.rotacao_apagados ? ` · ${r.rotacao_apagados} antigo(s) rotacionado(s)` : ''}${(r.erros || []).length ? ` · ⚠️ ${r.erros.length} tabela(s) com erro` : ''}</div>`
      : `<div class="alert alert-err tiny">${r.error || 'falhou'}</div>`;
  } catch (e) { msg.innerHTML = `<div class="alert alert-err tiny">${e?.message || e}</div>`; }
}

async function autoBackupList() {
  const msg = document.getElementById('bk-auto-msg');
  msg.innerHTML = '<span class="spinner"></span>';
  try {
    const r = await api.request('/api/v3/backup/auto?status=1');
    const bks = r.backups || [];
    msg.innerHTML = bks.length
      ? `<table class="tiny" style="width:100%;margin-top:6px"><tr class="muted"><th style="text-align:left">Arquivo</th><th>Tamanho</th><th>Criado</th></tr>
         ${bks.map(b => `<tr><td>${b.nome}</td><td style="text-align:center">${b.bytes ? (b.bytes / 1024).toFixed(0) + ' KB' : '—'}</td><td style="text-align:center">${b.criado ? new Date(b.criado).toLocaleString('pt-BR') : '—'}</td></tr>`).join('')}</table>`
      : '<div class="tiny muted">Nenhum backup automático ainda — o primeiro roda no próximo ciclo do heartbeat (ou clique em Rodar agora).</div>';
  } catch (e) { msg.innerHTML = `<div class="alert alert-err tiny">${e?.message || e}</div>`; }
}

async function driveBackup() {
  const btn = document.getElementById('bk-drive');
  const msg = document.getElementById('bk-drive-msg');
  btn.disabled = true;
  msg.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Disparando…</div>';
  try {
    const r = await api.request('/api/v3/backup/drive', { method: 'POST', body: {} });
    msg.innerHTML = `<div class="alert alert-ok">✅ ${escapeHtml(JSON.stringify(r))}</div>`;
  } catch (e) {
    msg.innerHTML = `<div class="alert alert-warn"><b>${escapeHtml(e.message)}</b><br><span class="tiny">${(e.data?.instructions || []).map(i => '<br>' + escapeHtml(i)).join('') || ''}</span></div>`;
  } finally {
    btn.disabled = false;
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
