/* PSM-OS v2 — 🕘 Rotina de hora em hora (componente) — v89.40
   O dia dividido em faixas de 1 hora, de segunda a sábado. Usado pela rotina do time
   (passo ④ do Playbook da Venda) e pela rotina individual do corretor no 1:1.
   dias = { "1": [faixa…], … "6": [faixa…] }   (1 = segunda … 6 = sábado)
   faixa = { ini:"09:00", fim:"10:00", bloco, modo:"i|g|s|u", tipo:""|"ouro"|"gold"|"pausa", oque, tarefas:[…] } */

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const DIAS = [['1', 'Segunda'], ['2', 'Terça'], ['3', 'Quarta'], ['4', 'Quinta'], ['5', 'Sexta'], ['6', 'Sábado']];
// laranja = com o gestor (equipe ou 1:1) · azul-petróleo = equipe sem gestor · neutro = individual
export const MODOS = {
  i: { nome: 'Individual', cor: 'var(--border-2, #9aa39d)' },
  g: { nome: 'Equipe com gestor', cor: '#e07b1a' },
  s: { nome: 'Equipe sem gestor', cor: '#0b8a9a' },
  u: { nome: 'Individual com gestor', cor: '#e07b1a' },
};
const GOLD = 'var(--amarelo-ouro, #ca8a04)';

export function diaDeHoje() { const d = new Date().getDay(); return d === 0 ? '1' : String(d); }
const mins = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };

export function legendaModos() {
  return `<div class="tiny muted" style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin:6px 0">
    ${Object.values(MODOS).filter((m, i, a) => a.findIndex(x => x.nome === m.nome) === i).map(m =>
      `<span style="display:inline-flex;align-items:center;gap:5px"><i style="width:10px;height:10px;border-radius:3px;background:${m.cor};display:inline-block"></i>${m.nome}</span>`).join('')}
    <span style="display:inline-flex;align-items:center;gap:5px"><i style="width:10px;height:10px;border-radius:3px;background:${GOLD};display:inline-block"></i>Horário GOLD</span></div>`;
}

/* abas dos dias + as faixas do dia escolhido */
export function gradeHora(dias, sel, { attr = 'data-rh-dia' } = {}) {
  dias = dias || {};
  const hoje = diaDeHoje();
  const agora = new Date(); const hm = agora.getHours() * 60 + agora.getMinutes();
  const ehHoje = sel === hoje && agora.getDay() !== 0;
  const abas = DIAS.map(([k, nome]) => {
    const on = k === sel, n = (dias[k] || []).length;
    return `<button ${attr}="${k}" class="btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}" ${n ? '' : 'style="opacity:.5"'}>${nome}${k === hoje && agora.getDay() !== 0 ? ' · hoje' : ''}</button>`;
  }).join('');
  const faixas = (dias[sel] || []).map(f => {
    const m = MODOS[f.modo] || MODOS.i;
    const cor = f.tipo === 'gold' ? GOLD : f.tipo === 'pausa' ? 'var(--border)' : m.cor;
    const now = ehHoje && hm >= mins(f.ini) && hm < mins(f.fim);
    const fundo = f.tipo === 'gold' ? 'background:linear-gradient(90deg,rgba(202,138,4,.16),var(--bg-2));' : f.tipo === 'ouro' ? 'background:var(--bg-3);' : f.tipo === 'pausa' ? 'opacity:.7;' : '';
    const tarefas = (f.tarefas || []).length ? `<ul style="margin:5px 0 0;padding-left:18px;font-size:13px;line-height:1.45">${f.tarefas.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
    return `<div style="display:flex;gap:10px;align-items:stretch;margin:5px 0">
      <div style="width:64px;flex:none;text-align:right;font-weight:800;font-size:14px;padding-top:8px">${esc(String(f.ini).slice(0, 2))}h<div class="tiny muted" style="font-weight:600">até ${esc(String(f.fim).slice(0, 2))}h</div></div>
      <div style="width:6px;flex:none;border-radius:4px;background:${cor}"></div>
      <div style="flex:1;border:1px solid ${now ? cor : 'var(--border)'};${now ? 'box-shadow:0 0 0 2px ' + cor + ';' : ''}border-radius:10px;padding:8px 12px;${fundo}">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <b style="font-size:14px">${f.tipo === 'gold' ? '⭐ ' : f.tipo === 'ouro' ? '🔥 ' : ''}${esc(f.bloco)}</b>
          ${f.tipo === 'pausa' ? '' : `<span class="tiny" style="border:1px solid ${m.cor};border-radius:999px;padding:0 8px;font-weight:600">${m.nome}</span>`}
          ${now ? `<span class="tiny" style="background:${cor};color:#fff;border-radius:999px;padding:1px 8px;font-weight:800">AGORA</span>` : ''}
        </div>
        ${f.oque ? `<div style="font-size:13px;margin-top:3px"><b>Objetivo:</b> ${esc(f.oque)}</div>` : ''}
        ${tarefas}
        ${f.entrega && f.entrega !== '–' ? `<div class="tiny" style="margin-top:4px"><b>Entrega:</b> ${esc(f.entrega)}</div>` : ''}
      </div></div>`;
  }).join('') || '<div class="tiny muted" style="padding:14px">Sem expediente neste dia.</div>';
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${abas}</div>${faixas}`;
}

/* a semana inteira numa tabela: uma linha por hora (08h–20h), uma coluna por dia */
export function semanaTabela(dias) {
  dias = dias || {};
  const horas = []; for (let h = 8; h < 20; h++) horas.push(h);
  const cel = (k, h) => {
    const f = (dias[k] || []).find(x => mins(x.ini) <= h * 60 && mins(x.fim) > h * 60);
    if (!f) return '<td style="border:1px solid var(--border);padding:3px 5px"></td>';
    const m = MODOS[f.modo] || MODOS.i;
    const cor = f.tipo === 'gold' ? GOLD : f.tipo === 'pausa' ? 'transparent' : m.cor;
    return `<td style="border:1px solid var(--border);border-left:4px solid ${cor};padding:3px 6px;font-size:11.5px;line-height:1.25;${f.tipo === 'pausa' ? 'color:var(--ink-muted,#888)' : 'font-weight:600'}">${esc(f.bloco)}</td>`;
  };
  return `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:760px;table-layout:fixed">
    <thead><tr><th style="width:44px"></th>${DIAS.map(([, n]) => `<th style="text-align:left;padding:5px 6px;font-size:12px;background:var(--bg-3)">${n}</th>`).join('')}</tr></thead>
    <tbody>${horas.map(h => `<tr><td class="tiny muted" style="text-align:right;padding:3px 6px;font-weight:700;vertical-align:top">${String(h).padStart(2, '0')}h</td>${DIAS.map(([k]) => cel(k, h)).join('')}</tr>`).join('')}</tbody></table></div>`;
}
