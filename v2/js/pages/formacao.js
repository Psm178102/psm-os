/* PSM-OS v2 — Formação PSM (Sprint 8.1 · v88.58: aulas tocam dentro do House)
   Os vídeos são os mesmos da Kiwify, hospedados no YouTube como "não listado".
   Para plugar/trocar uma aula: preencha `url` (link normal do YouTube) na lista abaixo.
   Aula sem `url` aparece como "em breve" com atalho para a Kiwify. */
import { embedInfo, embedIframe } from './academy.js';

const KIWIFY_URL = 'https://members.kiwify.com/?club=ccdc35d2-08c0-47cd-8268-4bf2c30ca597';
const LS_DONE = 'psm_formacao_done';

const yt = (id) => `https://www.youtube.com/watch?v=${id}`;
const MODULOS = [
  { nome: 'ONBOARDING PSM', desc: 'Como a PSM funciona: funil, roletas e perfil', aulas: [
    { titulo: 'Novo funil PSM — parte 1',                  url: yt('oIsM0NDZ9Hg') },
    { titulo: 'Novo funil PSM — parte 2',                  url: yt('76XxtaNwRjY') },
    { titulo: 'Funil lançamento: tentativa de contato',    url: yt('hNIbXNQHhMU') },
    { titulo: 'Roletas PSM: tipos, regras etc.',           url: yt('I7DgzrrR2GA') },
    { titulo: 'Perfil comportamental',                     url: yt('T2VZuw7zCE0') },
  ] },
  { nome: 'TUTORIAIS PSM', desc: 'Guias rápidos das ferramentas', aulas: [
    { titulo: 'Como cadastrar imóvel à venda no Kenlo',    url: yt('pP98IFFSK94') },
    { titulo: 'Cadastro de imóvel para locação no Kenlo',  url: yt('URoa1-Ww0uE') },
    { titulo: 'Como assinar o calendário de outra pessoa no Zoho', url: yt('Sxpywzai0RY') },
  ] },
  { nome: 'MERCADO BÁSICO', desc: 'Fundamentos do mercado imobiliário', aulas: [
    { titulo: 'Mercado imobiliário e seus nichos',         url: yt('721HILu6ke4') },
    { titulo: 'O que é o CRECI e o COFECI? Como tirar o CRECI', url: yt('NWemQCOLw60') },
    { titulo: 'Cartório e suas funções',                   url: yt('7Wtp_BCR78E') },
    { titulo: 'Certidão Negativa de Débitos: o quê, quais, quando', url: yt('iY_dN33NuE4') },
    { titulo: 'ITBI',                                      url: yt('8ozKYqnzfHM') },
    { titulo: 'Habite-se',                                 url: yt('Dh-L_DHpeP8') },
    { titulo: 'INCC',                                      url: yt('lgawxX9wImc') },
    { titulo: 'Inflação x valorização',                    url: yt('nY1qkkJYQAM') },
    { titulo: 'Captação de imóveis',                       url: yt('nNYJpl_fpBU') },
    { titulo: 'Precificação de imóvel com saldo devedor',  url: yt('j8DtKHEHHbY') },
    { titulo: 'Comprar imóvel na planta é seguro?',        url: yt('P6pRLIPw1cE') },
    { titulo: 'Contabilidade para corretores: noções essenciais e impostos', url: yt('0npz7ohuS38') },
  ] },
  { nome: 'LANÇAMENTOS E EMPREENDIMENTOS', desc: 'Repasse, curva de vendas e entrega', aulas: [
    { titulo: 'A diferença entre repasse imediato e repasse futuro', url: yt('5euu-ZEpeT0') },
    { titulo: 'Curva de velocidade de vendas e etapas de entrega (repasse futuro)', url: yt('qulQ7mAghb0') },
  ] },
  { nome: 'MCMV + FINANCIAMENTOS', desc: 'Programas de financiamento', aulas: [
    { titulo: 'Treinamento MCMV — Galo',                   url: yt('qrgnIsoXXFg') },
  ] },
  { nome: 'MENTORIA — PAULO', desc: 'Sessões de mentoria com o Paulo', aulas: [
    { titulo: 'Mentoria coletiva PSM 001',                 url: yt('pTwCLyxTgvY') },
  ] },
];

let _root = null;
let _sel = null; // { m, a } — aula aberta

const key = (m, a) => `${m}.${a}`;
function lerDone() { try { return new Set(JSON.parse(localStorage.getItem(LS_DONE) || '[]')); } catch { return new Set(); } }
function gravarDone(s) { try { localStorage.setItem(LS_DONE, JSON.stringify([...s])); } catch {} }

export async function pageFormacao(ctx, root) {
  _root = root;
  _sel = null;
  render();
}

function render() {
  if (_sel) return renderAula();
  const done = lerDone();
  const totalA = MODULOS.reduce((t, m) => t + m.aulas.length, 0);
  const feitas = MODULOS.reduce((t, m, mi) => t + m.aulas.filter((_, ai) => done.has(key(mi, ai))).length, 0);
  const pct = totalA ? Math.round((feitas / totalA) * 100) : 0;

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📚 Formação PSM</h2>
      <p class="card-sub">${MODULOS.length} módulos · ${totalA} aulas — assista aqui mesmo, sem sair do House</p>
      <div style="margin:14px 0 4px;display:flex;justify-content:space-between" class="tiny muted"><span>Seu progresso</span><b>${feitas}/${totalA} · ${pct}%</b></div>
      <div style="height:8px;background:var(--bg-3);border-radius:8px;overflow:hidden"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#d4a843,#e8c263)"></div></div>

      <div style="display:grid;gap:10px;margin-top:18px">
        ${MODULOS.map((m, mi) => {
          const ok = m.aulas.filter((_, ai) => done.has(key(mi, ai))).length;
          return `
          <details style="background:var(--bg-3);border-left:4px solid var(--psm-gold);border-radius:10px;padding:12px 14px" ${mi === 0 ? 'open' : ''}>
            <summary style="cursor:pointer;display:flex;align-items:center;gap:12px;list-style:none">
              <div style="flex:1">
                <div style="font-weight:800">${mi + 1}. ${esc(m.nome)}</div>
                <div class="tiny muted mt-1">${esc(m.desc)}</div>
              </div>
              <span style="background:var(--psm-navy);color:var(--psm-cream);font-weight:800;padding:4px 12px;border-radius:20px;font-size:12px;white-space:nowrap">${ok}/${m.aulas.length} aulas</span>
            </summary>
            <div style="display:grid;gap:6px;margin-top:10px">
              ${m.aulas.map((a, ai) => {
                const feito = done.has(key(mi, ai));
                const tem = !!embedInfo(a.url);
                return `
                <div data-open="${mi}.${ai}" style="display:flex;gap:10px;align-items:center;background:var(--bg-2, #fff1);border-radius:8px;padding:9px 12px;cursor:pointer">
                  <span style="width:20px;text-align:center">${feito ? '✅' : (tem ? '▶️' : '⏳')}</span>
                  <span style="flex:1;min-width:0;font-size:13px;font-weight:600;${feito ? 'opacity:.55' : ''}">${esc(a.titulo)}</span>
                  <span class="tiny muted">${tem ? (feito ? 'rever' : 'assistir') + ' →' : 'em breve'}</span>
                </div>`;
              }).join('')}
            </div>
          </details>`;
        }).join('')}
      </div>
      <div class="tiny muted" style="margin-top:14px">Progresso salvo neste aparelho. Outras aulas (mentorias seguintes, Paulo Cuenca — Branding) seguem na <a href="${KIWIFY_URL}" target="_blank" rel="noopener">Kiwify ↗</a>.</div>
    </div>
  `;
  _root.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => {
    const [m, a] = el.dataset.open.split('.').map(Number);
    _sel = { m, a };
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

function renderAula() {
  const { m, a } = _sel;
  const mod = MODULOS[m];
  const aula = mod.aulas[a];
  const info = embedInfo(aula.url);
  const done = lerDone();
  const feito = done.has(key(m, a));
  const temProx = a + 1 < mod.aulas.length;

  _root.innerHTML = `
    <div class="card" style="max-width:900px">
      <button class="btn btn-ghost btn-sm" id="fm-volta">← Formação PSM</button>
      <div style="margin-top:14px">
        <span class="tiny" style="font-weight:800;color:var(--psm-gold);text-transform:uppercase;letter-spacing:1px">${esc(mod.nome)}</span>
        <h2 style="margin:6px 0 2px;font-size:22px;line-height:1.25">${esc(aula.titulo)}</h2>
        <div class="tiny muted">aula ${a + 1} de ${mod.aulas.length}</div>
      </div>
      ${info
        ? `<div style="margin-top:16px">${embedIframe(info, aula.titulo)}</div>`
        : `<div class="alert alert-warn" style="margin-top:16px">📦 Esta aula ainda não foi trazida para o House. Enquanto isso, <a href="${KIWIFY_URL}" target="_blank" rel="noopener">assista na Kiwify ↗</a>.</div>`}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
        <button class="btn ${feito ? 'btn-ghost' : 'btn-primary'}" id="fm-done">${feito ? '↩️ Desmarcar concluída' : '✅ Marcar como concluída'}</button>
        ${a > 0 ? `<button class="btn btn-ghost" id="fm-ant">← Aula anterior</button>` : ''}
        ${temProx ? `<button class="btn btn-ghost" id="fm-prox">Próxima aula →</button>` : ''}
      </div>
    </div>
  `;
  document.getElementById('fm-volta').addEventListener('click', () => { _sel = null; render(); });
  document.getElementById('fm-done').addEventListener('click', () => {
    const s = lerDone();
    s.has(key(m, a)) ? s.delete(key(m, a)) : s.add(key(m, a));
    gravarDone(s);
    if (!feito && temProx) _sel = { m, a: a + 1 };
    render();
  });
  const ant = document.getElementById('fm-ant'); if (ant) ant.addEventListener('click', () => { _sel = { m, a: a - 1 }; render(); });
  const prox = document.getElementById('fm-prox'); if (prox) prox.addEventListener('click', () => { _sel = { m, a: a + 1 }; render(); });
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
