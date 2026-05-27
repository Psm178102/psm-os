/* PSM-OS v2 — Simulador Criativos (gerador de copy/headlines/CTA) (Sprint 8.4) */
import { api } from '../api.js';
import { auth } from '../auth.js';

const KEY = 'psm_v2_sim_criativos';
const DEFAULTS = {
  empreendimento: '',
  segmento: 'MAP',
  bairro: '',
  diferenciais: '',
  preco: 480000,
  pagamento: 'Entrada de 5% + 42x s/ juros',
  publico: 'morar',
};

const SEGMENTOS = ['MAP', 'MCMV', 'Terceiros', 'Locação', 'Conquista'];
const PUBLICOS = [
  { id: 'morar', lbl: 'Pra morar' },
  { id: 'investir', lbl: 'Pra investir' },
  { id: 'troca', lbl: 'Troca/Upgrade' },
];

let _root, _s, _busy = false, _output = '';

export async function pageSimCriativos(ctx, root) {
  _root = root;
  try { _s = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { _s = { ...DEFAULTS }; }
  render();
}

function save() { try { localStorage.setItem(KEY, JSON.stringify(_s)); } catch {} }

function render() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🎨 Simulador Criativos</h2>
      <p class="card-sub">Gerador de copy, headlines e CTA pra anúncios e posts — turbinado pela IA Sol</p>

      <div style="display:grid;grid-template-columns:320px 1fr;gap:14px;margin-top:12px">
        <div style="background:var(--bg-3);border-radius:10px;padding:14px">
          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin-bottom:6px">Briefing</div>
          ${inp('Empreendimento', 'empreendimento', 'text')}
          <div style="margin-bottom:6px">
            <label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">Segmento</label>
            <select class="select" data-key="segmento" data-type="text">
              ${SEGMENTOS.map(s => `<option value="${s}" ${_s.segmento === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          ${inp('Bairro / Localização', 'bairro', 'text')}
          <div style="margin-bottom:6px">
            <label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">Público-alvo</label>
            <select class="select" data-key="publico" data-type="text">
              ${PUBLICOS.map(p => `<option value="${p.id}" ${_s.publico === p.id ? 'selected' : ''}>${p.lbl}</option>`).join('')}
            </select>
          </div>
          ${inp('Diferenciais (separar por vírgula)', 'diferenciais', 'text')}
          ${inp('Preço médio', 'preco', 'num')}
          ${inp('Condição de pagamento', 'pagamento', 'text')}

          <button class="btn btn-primary mt-3" id="gerar" ${_busy ? 'disabled' : ''} style="width:100%">${_busy ? '⏳ Gerando…' : '✨ Gerar Criativos via IA'}</button>

          <div class="tiny muted mt-2" style="text-align:center">Powered by /api/v3/ia/chat (Sol)</div>
        </div>

        <div>
          <div class="card" style="padding:14px;min-height:480px">
            <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:10px">
              <div style="font-weight:800">📝 Criativos Gerados</div>
              ${_output ? '<button class="btn btn-ghost btn-sm" id="copy-all">📋 Copiar tudo</button>' : ''}
            </div>
            ${_output ? `
              <pre id="output-text" style="white-space:pre-wrap;background:var(--bg-3);padding:14px;border-radius:8px;font-family:inherit;font-size:13px;line-height:1.6;max-height:520px;overflow:auto">${esc(_output)}</pre>
            ` : `
              <div style="text-align:center;padding:60px 20px;color:var(--muted)">
                <div style="font-size:48px;margin-bottom:10px">✨</div>
                <div>Preencha o briefing e clique em "Gerar Criativos"</div>
                <div class="tiny mt-2">A IA Sol vai criar 5 headlines + 3 copies + 5 CTAs prontos pra usar.</div>
              </div>
            `}
          </div>

          <div class="flex gap-2 mt-3">
            <button class="btn btn-ghost" data-back>← Voltar Simuladores</button>
          </div>
        </div>
      </div>
    </div>
  `;
  bind();
}

function bind() {
  _root.querySelectorAll('[data-key]').forEach(el => el.addEventListener('input', e => {
    const k = el.dataset.key, t = el.dataset.type;
    _s[k] = t === 'num' ? (parseFloat(e.target.value) || 0) : e.target.value;
    save();
  }));
  _root.querySelectorAll('select[data-key]').forEach(el => el.addEventListener('change', e => {
    _s[el.dataset.key] = e.target.value;
    save();
  }));
  const gerar = document.getElementById('gerar');
  if (gerar) gerar.addEventListener('click', gerarCriativos);
  const copy = document.getElementById('copy-all');
  if (copy) copy.addEventListener('click', () => {
    navigator.clipboard.writeText(_output).then(() => {
      copy.textContent = '✅ Copiado!';
      setTimeout(() => { copy.textContent = '📋 Copiar tudo'; }, 1500);
    });
  });
  const back = _root.querySelector('[data-back]'); if (back) back.addEventListener('click', () => location.hash = '/simuladores');
}

async function gerarCriativos() {
  if (_busy) return;
  _busy = true;
  render();
  const briefing = `
EMPREENDIMENTO: ${_s.empreendimento || '(não informado)'}
SEGMENTO: ${_s.segmento}
BAIRRO: ${_s.bairro || '(não informado)'}
PÚBLICO: ${_s.publico === 'morar' ? 'Pra morar' : _s.publico === 'investir' ? 'Pra investir' : 'Troca/Upgrade'}
DIFERENCIAIS: ${_s.diferenciais || '(não informado)'}
PREÇO MÉDIO: R$ ${_s.preco.toLocaleString('pt-BR')}
PAGAMENTO: ${_s.pagamento}
`.trim();

  const prompt = `Você é a IA Sol da PSM Conquista (loteamento/incorporação). Crie criativos pra Instagram + Meta Ads baseado no briefing abaixo.

${briefing}

Formato da resposta (português brasileiro, tom direto e quente):

📌 5 HEADLINES (chamadas curtas, máx 60 caracteres cada)
1. ...
2. ...
3. ...
4. ...
5. ...

📝 3 COPIES (textos pra Instagram, 80-120 palavras, com emojis e quebras de linha)
Copy 1: ...
Copy 2: ...
Copy 3: ...

🎯 5 CTAs (call-to-action curtos e diretos)
1. ...
2. ...
3. ...
4. ...
5. ...

💡 HASHTAGS (10 hashtags relevantes pro segmento ${_s.segmento})
#... #... #...

Não inclua texto fora desse formato.`;

  try {
    const r = await api.request('/api/v3/ia/chat', { method: 'POST', body: {
      agent: 'sol',
      messages: [{ role: 'user', content: prompt }],
    }});
    _output = r.reply || '(IA não retornou resposta)';
  } catch (e) {
    _output = '⚠ Erro ao gerar: ' + (e.message || 'falha desconhecida');
  } finally {
    _busy = false;
    render();
  }
}

function inp(label, key, type) {
  const val = _s[key] ?? '';
  const inputType = type === 'text' ? 'text' : 'number';
  return `<div style="margin-bottom:6px"><label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label><input type="${inputType}" class="input" data-key="${key}" data-type="${type}" value="${esc(val)}" style="width:100%;font-size:12px;padding:6px 8px"></div>`;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
