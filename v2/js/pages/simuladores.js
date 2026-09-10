/* PSM-OS v2 — Hub Simuladores (Sprint 8.4)
   v87.73: o card só aparece se o login pode abrir a tela — antes Leads/CAC e
   Criativos (menu Marketing) apareciam para quem não tinha acesso e o clique
   dava em "sem permissão". Entrou o Simulador Conquista (Imóveis & Vendas). */

const SIMS = [
  { id: '/sim-vpl',       ico: '📐', t: 'VPL',           d: 'Valor Presente Líquido do fluxo de pagamentos',     cor: 'linear-gradient(135deg,#0b1f3a,#1e3a5f)' },
  { id: '/sim-incc',      ico: '📊', t: 'INCC',          d: 'Fluxo mês a mês corrigido pelo INCC até as chaves',  cor: 'linear-gradient(135deg,#7c2d12,#9a3412)' },
  { id: '/sim-repasse',   ico: '💰', t: 'Repasse',       d: 'Precificação de repasse com saldo devedor',         cor: 'linear-gradient(135deg,#065f46,#047857)' },
  { id: '/sim-amortizacao', ico: '🏦', t: 'Amortização',  d: 'Financiamento SAC/PRICE + amortização extra (economia de juros)', cor: 'linear-gradient(135deg,#1e3a5f,#2563eb)' },
  { id: '/sim-conquista', ico: '🏠', t: 'Conquista',     d: 'Faixa de renda MCMV: imóvel máximo, parcela e subsídio', cor: 'linear-gradient(135deg,#9a3412,#e06208)' },
  { id: '/sim-energia',   ico: '⚡', t: 'Energia',       d: 'Produtividade do corretor por canal',               cor: 'linear-gradient(135deg,#a16207,#ca8a04)' },
  { id: '/sim-leads',     ico: '🎯', t: 'Leads / CAC',   d: 'Custo por lead, CAC e ROI por canal',               cor: 'linear-gradient(135deg,#4338ca,#6366f1)' },
  { id: '/sim-criativos', ico: '🎨', t: 'Criativos',     d: 'Gerador de copy, headlines e CTA',                  cor: 'linear-gradient(135deg,#be185d,#db2777)' },
];

// Rota com item no menu lateral segue a visibilidade que o main.js já aplicou
// (papel, nível e override por usuário). Sem item no menu = sub-rota do mesmo
// grupo desta tela (Imóveis & Vendas) → quem vê o hub, abre.
function podeAbrir(rota) {
  const link = document.querySelector(`.app-sidebar .sb-link[data-nav="${rota}"]`);
  return !link || link.style.display !== 'none';
}

export async function pageSimuladores(ctx, root) {
  const sims = SIMS.filter(s => podeAbrir(s.id));
  root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🧮 Simuladores PSM</h2>
      <p class="card-sub">Ferramentas de cálculo para orientar o cliente e otimizar a operação</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(260px, 1fr));gap:14px;margin-top:14px">
        ${sims.map(s => `
          <div data-nav="${s.id}" style="background:${s.cor};color:#fff;border-radius:14px;padding:22px;cursor:pointer;transition:transform .15s ease;box-shadow:0 4px 14px rgba(0,0,0,.18)" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
            <div style="font-size:34px;margin-bottom:8px">${s.ico}</div>
            <div style="font-size:18px;font-weight:900;margin-bottom:4px">${s.t}</div>
            <div style="opacity:.85;font-size:13px;line-height:1.5">${s.d}</div>
            <div style="margin-top:12px;opacity:.7;font-size:12px">Abrir →</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  root.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', () => {
    location.hash = el.dataset.nav;
  }));
}
