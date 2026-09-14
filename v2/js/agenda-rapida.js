/* ============================================================================
   PSM-OS v2 — ✍️ Adicionar rápido da Agenda & Tarefas (v87.81)
   ----------------------------------------------------------------------------
   Lê uma frase em português e devolve o que ela quer dizer:
     "Visita com Ana amanhã 15h"          → compromisso · visita · amanhã 15:00
     "Ligar pro João sexta 9h30 !alta"    → tarefa · próxima sexta 09:30 · alta
     "Reunião de equipe seg 9h-10h @Kaue" → compromisso · reunião · seg 09–10 · Kaue
     "Enviar proposta dia 20"             → tarefa · dia 20
   A data/hora/prioridade/@pessoa SAEM do título; o resto vira o título.

   Sem lookbehind de regex de propósito: um erro de sintaxe num módulo derruba o
   app inteiro no Safari antigo (iPhone de corretor), e este arquivo é importado
   pela tela inicial.
============================================================================ */

const L = '[\\p{L}\\p{N}]';
const ANTES = '(^|[^\\p{L}\\p{N}@!])';           // grupo 1 = fronteira à esquerda (não entra no recorte)
const DEPOIS = `(?!${L})`;
const PREP = '(?:(?:at[ée]|para|pra|no|na|nesta|neste|nessa|nesse|dia|de|em)\\s+)?';

const DIAS = { dom: 0, domingo: 0, seg: 1, segunda: 1, ter: 2, terca: 2, qua: 3, quarta: 3, qui: 4, quinta: 4, sex: 5, sexta: 5, sab: 6, sabado: 6 };

const COMPROMISSO = [
  [/^visita|^vistoria/, 'visita'],
  [/^plantao/, 'plantao'],
  [/^evento|^feira|^workshop|^palestra/, 'evento'],
  [/^reuniao|^call|^videochamada|^meet|^almoco|^cafe|^apresentacao|^entrevista|^assinatura|^atendimento/, 'reuniao'],
];

const semAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const deIso = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d, 12); };
const somaDias = (s, n) => { const d = deIso(s); d.setDate(d.getDate() + n); return iso(d); };

function achar(texto, fonte) {
  const rx = new RegExp(ANTES + '(' + fonte + ')' + DEPOIS, 'iu');
  const m = rx.exec(texto);
  if (!m) return null;
  const ini = m.index + m[1].length;
  return { ini, fim: ini + m[2].length, m: m.slice(2) };
}

function horaOk(h, mi) {
  h = Number(h); mi = Number(mi || 0);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 ? `${pad(h)}:${pad(mi)}` : null;
}

/**
 * @param {string} texto
 * @param {{hoje?: string, usuarios?: {id:string,name:string}[]}} opts  hoje = YYYY-MM-DD local
 */
export function interpretar(texto, opts = {}) {
  const hoje = opts.hoje || iso(new Date());
  const cortes = [];
  const out = { titulo: '', tipo: 'tarefa', tipoEvento: null, data: null, hora_inicio: null, hora_fim: null,
    prioridade: null, responsavel_id: null, responsavel_nome: null };
  let t = String(texto || '');

  // ── data ────────────────────────────────────────────────────────────────
  const regrasData = [
    [PREP + 'depois\\s+de\\s+amanh[ãa]', () => somaDias(hoje, 2)],
    [PREP + 'amanh[ãa]', () => somaDias(hoje, 1)],
    [PREP + 'hoje(?:\\s+[àa]\\s+noite|\\s+[àa]\\s+tarde)?', () => hoje],
    [PREP + '(?:semana\\s+que\\s+vem|pr[óo]xima\\s+semana)', () => {
      const d = deIso(hoje).getDay(); return somaDias(hoje, ((8 - d) % 7) || 7);
    }],
    [PREP + '(?:fim\\s+de\\s+semana|final\\s+de\\s+semana)', () => {
      const d = deIso(hoje).getDay(); return somaDias(hoje, d === 6 ? 0 : (6 - d));
    }],
    [PREP + '(?:daqui\\s+a|em)\\s+(\\d{1,2})\\s+dias?', m => somaDias(hoje, Number(m[1]))],
    [PREP + '(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4}))?', m => {
      const dia = Number(m[1]), mes = Number(m[2]);
      if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
      let ano = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : deIso(hoje).getFullYear();
      let r = `${ano}-${pad(mes)}-${pad(dia)}`;
      if (!m[3] && r < hoje) r = `${ano + 1}-${pad(mes)}-${pad(dia)}`;
      return deIso(r).getDate() === dia ? r : null;
    }],
    [PREP + 'dia\\s+(\\d{1,2})', m => {
      const dia = Number(m[1]); if (dia < 1 || dia > 31) return null;
      const h = deIso(hoje);
      let r = `${h.getFullYear()}-${pad(h.getMonth() + 1)}-${pad(dia)}`;
      if (r < hoje) { const n = new Date(h.getFullYear(), h.getMonth() + 1, dia, 12); r = iso(n); }
      return deIso(r).getDate() === dia ? r : null;
    }],
    // "segunda via", "quinta parcela" não são dia da semana; abreviação só vale colada num horário ("ter 14h")
    [PREP + '(?:pr[óo]xim[oa]\\s+)?(?:(segunda|ter[çc]a|quarta|quinta|sexta)(?:-feira)?(?!\\s+(?:via|op[çc][ãa]o|etapa|parcela|vez|fase|chamada|rodada|chance|tentativa|proposta|reuni[ãa]o|visita|vistoria|semana|quinzena|feira\\s+de))|(s[áa]bado|domingo))|(seg|ter|qua|qui|sex|s[áa]b|dom)\\.?(?=\\s+(?:[àa]s\\s+)?\\d)', (m, bruto) => {
      const nome = semAcento(m[1] || m[2] || m[3]).replace('-feira', '').replace('.', '');
      const alvo = DIAS[nome];
      if (alvo == null) return null;
      const d = deIso(hoje).getDay();
      let n = (alvo - d + 7) % 7;
      if (/pr[óo]xim/i.test(bruto) && n === 0) n = 7;
      return somaDias(hoje, n);
    }],
  ];
  for (const [fonte, fn] of regrasData) {
    const a = achar(t, fonte);
    if (!a) continue;
    const v = fn(a.m, t.slice(a.ini, a.fim));
    if (!v) continue;
    out.data = v; cortes.push([a.ini, a.fim]); break;
  }

  // ── horário ─────────────────────────────────────────────────────────────
  const semData = cortar(t, cortes);   // não deixa "20/09" virar hora
  const faixa = achar(semData.txt, '(?:das\\s+|de\\s+)?(\\d{1,2})(?:[:h](\\d{2}))?h?\\s*(?:-|–|[àa]s|at[ée]|a)\\s*(\\d{1,2})(?:[:h](\\d{2}))?h?');
  if (faixa && /[h:]|^das\s/i.test(semData.txt.slice(faixa.ini, faixa.fim))) {
    const hi = horaOk(faixa.m[1], faixa.m[2]), hf = horaOk(faixa.m[3], faixa.m[4]);
    if (hi && hf && hf > hi) {
      out.hora_inicio = hi; out.hora_fim = hf;
      cortes.push(semData.mapa(faixa.ini, faixa.fim));
    }
  }
  if (!out.hora_inicio) {
    const s2 = cortar(t, cortes);
    const umaH = achar(s2.txt, '(?:(?:[àa]s|a\\s+partir\\s+das)\\s+)?(\\d{1,2})(?::(\\d{2})|h(\\d{2})?)')
      || achar(s2.txt, '(?:[àa]s)\\s+(\\d{1,2})(?!\\d)');
    const meioDia = achar(s2.txt, '(?:(?:ao|[àa]o)\\s+)?meio[-\\s]dia');
    if (umaH) {
      const h = horaOk(umaH.m[1], umaH.m[2] || umaH.m[3]);
      if (h) { out.hora_inicio = h; cortes.push(s2.mapa(umaH.ini, umaH.fim)); }
    } else if (meioDia) {
      out.hora_inicio = '12:00'; cortes.push(s2.mapa(meioDia.ini, meioDia.fim));
    }
  }

  // ── prioridade ──────────────────────────────────────────────────────────
  const s3 = cortar(t, cortes);
  const pr = achar(s3.txt, '!!!|!!|!cr[íi]tic[ao]|!urgente|!alta|!m[ée]dia|!baixa|urgente|prioridade\\s+(?:alta|m[ée]dia|baixa)');
  if (pr) {
    const v = semAcento(s3.txt.slice(pr.ini, pr.fim));
    out.prioridade = /!!!|critic/.test(v) ? 'critica' : /baixa/.test(v) ? 'baixa' : /media/.test(v) ? 'media' : 'alta';
    cortes.push(s3.mapa(pr.ini, pr.fim));
  }

  // ── @pessoa ─────────────────────────────────────────────────────────────
  const s4 = cortar(t, cortes);
  const at = /@([\p{L}.]{2,})/u.exec(s4.txt);
  if (at && Array.isArray(opts.usuarios)) {
    const alvo = semAcento(at[1]).replace(/\./g, ' ').trim();
    const achados = opts.usuarios.filter(u => {
      const n = semAcento(u.name);
      return n.startsWith(alvo) || n.split(/\s+/).some(p => p.startsWith(alvo));
    });
    if (achados.length === 1) {
      out.responsavel_id = achados[0].id; out.responsavel_nome = achados[0].name;
      cortes.push(s4.mapa(at.index, at.index + at[0].length));
    }
  }

  // ── título + tipo ──────────────────────────────────────────────────────
  let titulo = cortar(t, cortes).txt
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();
  const conectores = /^(?:(?:[àa]s|as|no|na|dia|em|de|para|pra|at[ée]|com|e|[-–,;])\s+)+|(?:\s+(?:[àa]s|no|na|dia|em|de|para|pra|at[ée]|com|e|[-–,;]))+$/iu;
  if (cortes.length) for (let i = 0; i < 3; i++) titulo = titulo.replace(conectores, '').trim();
  titulo = titulo.replace(/[,;\-–]+$/, '').trim();
  out.titulo = titulo ? titulo.charAt(0).toUpperCase() + titulo.slice(1) : '';

  const primeira = semAcento(out.titulo);
  for (const palavra of primeira.split(/[^a-z0-9]+/).slice(0, 3)) {
    const hit = COMPROMISSO.find(([rx]) => rx.test(palavra));
    if (hit) { out.tipo = 'compromisso'; out.tipoEvento = hit[1]; break; }
  }
  return out;
}

/* Remove os trechos já reconhecidos (troca por espaço, preservando posições
   pra que o próximo passo não "reconheça de novo" o mesmo pedaço) e devolve
   um mapa de volta pras posições do texto original. */
function cortar(texto, cortes) {
  const arr = texto.split('');
  for (const [a, b] of cortes) for (let i = a; i < b; i++) arr[i] = ' ';
  const txt = arr.join('');
  return { txt, mapa: (a, b) => [a, b] };
}

/** "Hoje", "Amanhã", "Ontem" ou "Ter, 15/09" (ano só se for outro). */
export function rotuloData(isoData, hojeIso) {
  if (!isoData) return 'Sem data';
  const hoje = hojeIso || iso(new Date());
  if (isoData === hoje) return 'Hoje';
  if (isoData === somaDias(hoje, 1)) return 'Amanhã';
  if (isoData === somaDias(hoje, -1)) return 'Ontem';
  const d = deIso(isoData);
  const sem = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d.getDay()];
  const ano = d.getFullYear() !== deIso(hoje).getFullYear() ? '/' + d.getFullYear() : '';
  return `${sem}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}${ano}`;
}

export const datas = { iso, deIso, somaDias };
