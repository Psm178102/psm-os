/* PSM-OS v2 — leitor do Playbook da Venda — v88.96
   Pedido do Paulo (28/09): "os scripts e cadências do M.A.P estão com layout bem ruim,
   não dá pra entender o que é script, o que é orientação".
   O conteúdo das etapas veio de PDFs (tabelas achatadas linha a linha, scripts quebrados
   a cada ~50 caracteres). Este leitor reconhece cada tipo de bloco e desenha diferente:
     💬 SCRIPT (balão, com copiar)   💡 POR QUE FUNCIONA / DICA   ⛔ PROIBIDO / REGRA
     📋 FICHA da etapa (quando, objetivo, SLA, canais, regra de ouro)   ▦ TABELAS
   Não altera o texto salvo: é só leitura. Para marcar um script à mão, comece a linha com "> ". */

const FICHA = /^(QUANDO|OBJETIVO|SLA( \(REGRA\))?|CANAIS|REGRA( DE OURO)?|COMO FUNCIONA|QUANDO USAR|META|PRAZO|RESPONS[AÁ]VEL|PERFIS|VOLUME|OBRIGAT[OÓ]RIO)$/;
const valorFicha = v => !!v && !FICHA.test(v) && !(caps(v) && v.length <= 22);
const SCRIPT_HDR = /^(script\b|roteiro\b|whats ?app\b|sms\b|direct\b|mensagem\b|passo \d|por liga|por whats|resposta\b|p[oó]s[ -]no-show|ap[oó]s \d|se n[aã]o respondeu a confirma|na sa[ií]da|indica[cç][aã]o\b|carteira\b|lead que\b|aviso\b|perguntas abertas|posicionamento \(|modelo\b|d\d+ [—-]|pre[cç]o indireto|liga[cç][aã]o\b|e-?mail\b|[aá]udio\b|\(se )/i;
const CALLOUT = /^(POR QUE FUNCIONA|DICA|PROIBIDO|REGRA FINAL|REGRA DE FLUXO|ATEN[CÇ][AÃ]O|IMPORTANTE)\b\s*[—:-]?\s*(.*)$/i;
const SECAO = /^(T\d+\s*[—-]|Estrat[eé]gia \d|Fase \d|Gatilho:|Scripts? (detalhad|prontos|de )|Cad[eê]ncia|Follow-up|Sequ[eê]ncia|Fluxo de)/i;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inl = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const caps = t => /[A-ZÀ-Ý]/.test(t) && t === t.toUpperCase();
const ehHdrScript = t => (t.length <= 70 && /:$/.test(t) && SCRIPT_HDR.test(t)) || /^Script \d+\s*:/i.test(t);
const iconeCanal = t => /whats/i.test(t) ? '💬' : /sms/i.test(t) ? '✉️' : /direct|instagram/i.test(t) ? '📸' : /liga|roteiro/i.test(t) ? '📞' : /v[ií]deo/i.test(t) ? '🎥' : '💬';

/* uma linha encerra o corpo do script? */
function fimDoScript(t) {
  if (!t) return true;
  if (ehHdrScript(t) || CALLOUT.test(t) || SECAO.test(t) || FICHA.test(t)) return true;
  if (t.length > 62 && !/^['"\[(]/.test(t)) return true;               // parágrafo longo = orientação
  if (caps(t) && !/^[('\[]/.test(t) && !t.includes('[')) return true;   // rótulo em CAIXA ALTA
  return false;
}

export function playbookHTML(src) {
  // limpeza do texto vindo de PDF: tira rodapé de página ("… ─ 3@guiwohlke") e junta
  // frases que o PDF quebrou no meio (linha longa sem ponto final + próxima em minúscula)
  const L = [];
  for (const raw of String(src || '').split('\n')) {
    const l = raw.trim();
    if (/[─—-]\s*\d+\s*@\w+$/.test(l)) continue;
    const ant = L[L.length - 1];
    if (ant && l && /^[a-zà-ú]/.test(l) && ant.length > 58 && !/[.!?:]$/.test(ant) && !/^['"\[(>]/.test(ant)) L[L.length - 1] = ant + ' ' + l;
    else L.push(l);
  }
  const out = [], copias = [];
  let lista = false;
  const fechaLista = () => { if (lista) { out.push('</ul>'); lista = false; } };
  const item = h => { if (!lista) { out.push('<ul class="pb-ul">'); lista = true; } out.push(`<li>${h}</li>`); };

  for (let i = 0; i < L.length; i++) {
    const t = L[i];
    if (!t) { fechaLista(); continue; }

    // ── script marcado à mão: linhas começando com "> "
    if (/^>\s?/.test(t)) {
      const corpo = [];
      while (i < L.length && /^>\s?/.test(L[i])) corpo.push(L[i++].replace(/^>\s?/, ''));
      i--; fechaLista(); out.push(balao('Script', corpo, copias)); continue;
    }

    // ── cabeçalho de script (WhatsApp T01:, Script 1: Consultivo, Roteiro de ligacao:, (SE DISSER…):)
    if (ehHdrScript(t)) {
      const corpo = [];
      let j = i + 1;
      while (j < L.length && !fimDoScript(L[j])) corpo.push(L[j++]);
      if (corpo.length) { fechaLista(); out.push(balao(t.replace(/:$/, ''), corpo, copias)); i = j - 1; continue; }
    }

    // ── caixas de orientação
    const c = t.match(CALLOUT);
    if (c) {
      const tipo = c[1].toUpperCase();
      const k = /PROIBIDO/.test(tipo) ? 'err' : /REGRA|ATEN|IMPORTANTE/.test(tipo) ? 'warn' : /DICA/.test(tipo) ? 'dica' : 'why';
      const ico = { err: '⛔', warn: '⚠️', dica: '💡', why: '🧠' }[k];
      const rot = { err: 'Proibido', warn: tipo.startsWith('REGRA') ? 'Regra' : 'Atenção', dica: 'Dica', why: 'Por que funciona' }[k];
      let titulo = c[2] || '', corpo = [];
      if (titulo.length > 70) { corpo.push(titulo); titulo = ''; }
      let j = i + 1;
      while (j < L.length && L[j] && corpo.length < 4 && (L[j].length > 62 || /^CAMINHO [A-Z]:/.test(L[j])) && !CALLOUT.test(L[j]) && !ehHdrScript(L[j])) corpo.push(L[j++]);
      i = j - 1; fechaLista();
      out.push(`<div class="pb-box pb-${k}"><div class="pb-box-t">${ico} ${rot}${titulo ? ` · <span>${inl(titulo)}</span>` : ''}</div>${corpo.map(p => `<p>${rotulo(p)}</p>`).join('')}</div>`);
      continue;
    }

    // ── gatilho da tentativa
    const g = t.match(/^Gatilho:\s*(.+)$/i);
    if (g) { fechaLista(); out.push(`<div class="pb-gat">🎯 <b>Gatilho:</b> ${inl(g[1])}</div>`); continue; }

    // ── ficha da etapa (QUANDO / OBJETIVO / SLA / CANAIS / REGRA DE OURO…)
    if (FICHA.test(t) && valorFicha(L[i + 1])) {
      const pares = [];
      let j = i;
      while (j < L.length && FICHA.test(L[j]) && valorFicha(L[j + 1])) { pares.push([L[j], L[j + 1]]); j += 2; }
      i = j - 1; fechaLista();
      out.push(`<div class="pb-ficha">${pares.map(([k, v]) => `<div class="pb-fk${/REGRA/.test(k) ? ' pb-ouro' : ''}"><span>${esc(k)}</span><b>${inl(v)}</b></div>`).join('')}</div>`);
      continue;
    }

    // ── tabela achatada: ≥3 cabeçalhos curtos em CAIXA ALTA seguidos, depois linhas de N células.
    //    A 1ª célula (D1, T01, PRODUTO…) também é caixa alta — testa cada N e fica com o que rende mais linhas.
    let nMax = 0;
    while (i + nMax < L.length && L[i + nMax] && L[i + nMax].length <= 22 && caps(L[i + nMax])) nMax++;
    if (nMax >= 3) {
      let melhor = null;
      for (let n = 3; n <= Math.min(nMax, 6); n++) {
        const d0 = L[i + n] || '';
        const pad = /^\d+$/.test(d0) ? /^\d+$/ : /^D\d+/.test(d0) ? /^D\d+/ : /^T\d+/.test(d0) ? /^T\d+/ : (caps(d0) && d0.length <= 22) ? /^[A-ZÀ-Ý0-9 .+\/-]{1,22}$/ : null;
        const linhas = [];
        let j = i + n;
        while (pad && j + n <= L.length && pad.test(L[j]) && L.slice(j, j + n).every(Boolean)) { linhas.push(L.slice(j, j + n)); j += n; }
        if (linhas.length && (!melhor || linhas.length > melhor.linhas.length)) melhor = { n, linhas, j };
      }
      if (melhor) {
        const { n, linhas, j } = melhor;
        fechaLista();
        out.push(`<div class="pb-tab"><table><thead><tr>${L.slice(i, i + n).map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
          linhas.map(r => `<tr>${r.map((x, ci) => `<td${ci === 0 ? ' class="pb-td0"' : ''}>${/^'/.test(x) ? `<span class="pb-fala">${inl(x.replace(/^'|'$/g, ''))}</span>` : inl(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        i = j - 1; continue;
      }
    }

    // ── rótulo de público antes de um script (MORADIA / INVESTIMENTO / MIX)
    if (caps(t) && t.length <= 14 && !/\s{2}/.test(t) && L[i + 1] && ehHdrScript(L[i + 1])) { fechaLista(); out.push(`<div class="pb-tag">🏷 ${esc(t)}</div>`); continue; }

    // ── títulos
    if (/^#{1,3}\s/.test(t)) { fechaLista(); out.push(`<div class="pb-h2">${inl(t.replace(/^#{1,3}\s/, ''))}</div>`); continue; }
    if (caps(t) && t.length <= 80 && !/[.;,?]$/.test(t)) { fechaLista(); out.push(`<div class="pb-h1">${inl(t)}</div>`); continue; }
    if (SECAO.test(t) && t.length <= 90) { fechaLista(); out.push(`<div class="pb-h2">${inl(t)}</div>`); continue; }

    // ── listas
    if (/^[-•▸*]\s+/.test(t)) { item(rotulo(t.replace(/^[-•▸*]\s+/, ''))); continue; }
    if (/^\d+\)\s*/.test(t)) { item(`<b class="pb-num">${t.match(/^\d+/)[0]}</b> ${rotulo(t.replace(/^\d+\)\s*/, ''))}`); continue; }
    if (/^[^:]{2,32}:\s+\S/.test(t) && t.split(':')[0].split(' ').length <= 5) { item(rotulo(t)); continue; }

    // ── subtítulo curto (sem pontuação final) ou parágrafo
    fechaLista();
    if (t.length <= 60 && /^[A-ZÀ-Ý]/.test(t) && !/[.,;:!?'")]$/.test(t)) out.push(`<div class="pb-h3">${inl(t)}</div>`);
    else out.push(`<p class="pb-p">${inl(t)}</p>`);
  }
  fechaLista();
  return { html: out.join(''), copias };
}

/* "Rótulo: texto" → rótulo em negrito */
function rotulo(t) {
  const m = t.match(/^([^:]{2,40}):\s+(.+)$/);
  return m && m[1].split(' ').length <= 6 ? `<b>${inl(m[1])}:</b> ${inl(m[2])}` : inl(t);
}

/* balão de script: reconstrói as linhas quebradas do PDF em parágrafos */
function balao(titulo, linhas, copias) {
  const paras = [];
  let cur = null;
  for (const raw of linhas) {
    const dir = /^\(.*\)$/.test(raw);
    const t = raw.replace(/^'(.*)'$/, '$1').replace(/^'|'$/g, '');
    if (dir) { paras.push({ dir: true, t }); cur = null; continue; }
    if (!cur || /[.?!:)]$/.test(cur.t) || /^(\d\)|\[|-)/.test(t)) { cur = { t }; paras.push(cur); }
    else cur.t += ' ' + t;
  }
  const k = copias.length;
  copias.push(paras.filter(p => !p.dir).map(p => p.t).join('\n'));
  return `<div class="pb-script"><div class="pb-sh"><span>${iconeCanal(titulo)} ${inl(titulo)}</span><button class="pb-cp" data-cp="${k}" type="button">📋 Copiar</button></div>
    <div class="pb-sb">${paras.map(p => p.dir ? `<div class="pb-dir">${inl(p.t)}</div>` : `<div>${inl(p.t).replace(/\[([^\]]+)\]/g, '<span class="pb-var">[$1]</span>')}</div>`).join('')}</div></div>`;
}

export const PB_LEGENDA = `<div class="pb-leg">
  <span class="pb-lg pb-lg-s">💬 Script · copie e envie</span>
  <span class="pb-lg pb-lg-w">🧠 Por que funciona</span>
  <span class="pb-lg pb-lg-d">💡 Dica</span>
  <span class="pb-lg pb-lg-e">⛔ Proibido / regra</span>
  <span class="pb-lg">📋 Ficha da etapa</span>
</div>`;

export const PB_CSS = `
  .pb{font-size:13.5px;line-height:1.55}
  .pb-leg{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .pb-lg{font-size:11.5px;padding:2px 8px;border-radius:999px;background:var(--bg-3);color:var(--ink-2)}
  .pb-lg-s{background:color-mix(in srgb,var(--ok) 14%,transparent)}
  .pb-lg-w{background:color-mix(in srgb,#3b82f6 14%,transparent)}
  .pb-lg-d{background:color-mix(in srgb,var(--warn) 16%,transparent)}
  .pb-lg-e{background:color-mix(in srgb,var(--err) 12%,transparent)}
  .pb-h1{font-weight:700;font-size:14px;letter-spacing:.3px;margin:18px 0 8px;padding:6px 10px;border-radius:var(--radius-sm);background:var(--bg-3);color:var(--ink)}
  .pb-h1:first-child{margin-top:0}
  .pb-h2{font-weight:700;font-size:14.5px;margin:18px 0 6px;padding-bottom:4px;border-bottom:2px solid var(--c,var(--border));color:var(--ink)}
  .pb-h3{font-weight:600;margin:12px 0 4px;color:var(--ink)}
  .pb-p{margin:4px 0;color:var(--ink-2)}
  .pb-ul{margin:4px 0 8px 18px;padding:0}.pb-ul li{margin:3px 0}
  .pb-num{display:inline-block;min-width:18px;color:var(--c,var(--ink))}
  .pb-ficha{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin:8px 0 12px}
  .pb-fk{border:1px solid var(--border);border-radius:var(--radius-md);padding:8px 10px;background:var(--bg-2,transparent)}
  .pb-fk span{display:block;font-size:10.5px;font-weight:700;letter-spacing:.5px;color:var(--ink-muted);text-transform:uppercase;margin-bottom:2px}
  .pb-fk b{font-weight:600;font-size:13px}
  .pb-ouro{grid-column:1/-1;border-color:var(--warn);background:color-mix(in srgb,var(--warn) 10%,transparent)}
  .pb-script{margin:8px 0 12px;border-radius:12px;border:1px solid color-mix(in srgb,var(--ok) 35%,transparent);background:color-mix(in srgb,var(--ok) 8%,transparent);max-width:640px;overflow:hidden}
  .pb-sh{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 10px;font-size:12px;font-weight:700;color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,transparent)}
  .pb-cp{border:none;background:var(--bg-1,#fff);color:var(--ink);font:inherit;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;cursor:pointer}
  .pb-sb{padding:9px 12px;display:grid;gap:5px;color:var(--ink)}
  .pb-var{background:color-mix(in srgb,var(--warn) 22%,transparent);border-radius:4px;padding:0 3px;font-weight:600;font-size:12.5px}
  .pb-dir{font-style:italic;font-size:12px;color:var(--ink-muted)}
  .pb-dir::before{content:'↳ '}
  .pb-tag{display:inline-block;margin:10px 0 0;font-size:11px;font-weight:700;letter-spacing:.5px;padding:2px 9px;border-radius:999px;background:var(--bg-3);color:var(--ink-2)}
  .pb-gat{margin:4px 0 6px;font-size:12.5px;padding:5px 10px;border-radius:var(--radius-sm);background:var(--bg-3);display:inline-block}
  .pb-box{margin:8px 0 12px;border-radius:var(--radius-md);padding:9px 12px;border-left:4px solid}
  .pb-box p{margin:4px 0 0;color:var(--ink-2)}
  .pb-box-t{font-weight:700;font-size:12.5px}.pb-box-t span{font-weight:600;color:var(--ink)}
  .pb-why{border-color:#3b82f6;background:color-mix(in srgb,#3b82f6 8%,transparent)}.pb-why .pb-box-t{color:#3b82f6}
  .pb-dica{border-color:var(--warn);background:color-mix(in srgb,var(--warn) 9%,transparent)}.pb-dica .pb-box-t{color:var(--warn)}
  .pb-err{border-color:var(--err);background:color-mix(in srgb,var(--err) 7%,transparent)}.pb-err .pb-box-t{color:var(--err)}
  .pb-warn{border-color:var(--warn);background:color-mix(in srgb,var(--warn) 7%,transparent)}.pb-warn .pb-box-t{color:var(--warn)}
  .pb-tab{overflow-x:auto;margin:8px 0 12px}
  .pb-tab table{border-collapse:collapse;width:100%;font-size:12.5px}
  .pb-tab th{text-align:left;font-size:10.5px;letter-spacing:.4px;color:var(--ink-muted);padding:6px 8px;border-bottom:2px solid var(--border);white-space:nowrap}
  .pb-tab td{padding:7px 8px;border-bottom:1px solid var(--border);vertical-align:top}
  .pb-td0{font-weight:700;white-space:nowrap;color:var(--c,var(--ink))}
  .pb-fala{display:inline-block;font-style:italic;background:color-mix(in srgb,var(--ok) 9%,transparent);border-radius:6px;padding:1px 6px}
  .pb.pb-so > :not(.pb-script):not(.pb-h1):not(.pb-h2):not(.pb-tag):not(.pb-vazio){display:none}
`;
