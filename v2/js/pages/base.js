/* PSM-OS v2 — Base de Conhecimento (Sprint 8.0) */

const ITEMS = [
  { id: '/manual',  ico: '📖', t: 'Manual de Cultura',   d: 'Missão, visão, valores e regras de convivência', cor: 'linear-gradient(135deg,#0b1f3a,#1e3a5f)' },
  { id: '/etica',   ico: '⚖️', t: 'Código de Ética',     d: '17 capítulos · 69 artigos · conduta obrigatória', cor: 'linear-gradient(135deg,#7c2d12,#9a3412)' },
  { id: '/formacao',ico: '🎓', t: 'Formação PSM',        d: 'Treinamentos, materiais e capacitação contínua', cor: 'linear-gradient(135deg,#065f46,#047857)' },
  { id: '/canal',   ico: '🔒', t: 'Canal Anônimo',       d: 'Comunicação direta e confidencial com diretoria', cor: 'linear-gradient(135deg,#4338ca,#6366f1)' },
];

export async function pageBase(ctx, root) {
  root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📚 Base de Conhecimento</h2>
      <p class="card-sub">Formação, cultura, playbooks, ética e canal direto.</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:14px;margin-top:14px">
        ${ITEMS.map(i => `
          <div data-nav="${i.id}" style="background:${i.cor};color:#fff;border-radius:14px;padding:24px;cursor:pointer;transition:transform .15s ease;box-shadow:0 4px 14px rgba(0,0,0,.15)" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
            <div style="font-size:36px;margin-bottom:8px">${i.ico}</div>
            <div style="font-size:18px;font-weight:900;margin-bottom:4px">${i.t}</div>
            <div style="opacity:.85;font-size:13px;line-height:1.5">${i.d}</div>
            <div style="margin-top:14px;opacity:.7;font-size:12px">Abrir →</div>
          </div>
        `).join('')}
      </div>

      <div class="mt-4 muted tiny" style="text-align:center">
        Material institucional PSM Imóveis · Atualizado conforme contrato de parceria vigente.
      </div>
    </div>
  `;
  root.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', () => {
    location.hash = el.dataset.nav;
  }));
}
