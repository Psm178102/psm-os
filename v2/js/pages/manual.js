/* PSM-OS v2 — Manual de Cultura (Sprint 8.0) */
import { auth } from '../auth.js';

const VALORES = [
  { ico: '🎯', t: 'Foco no Resultado',  d: 'Metas claras, ação consistente, entrega excepcional' },
  { ico: '🤝', t: 'Ética & Transparência', d: 'Agir com integridade em cada negociação' },
  { ico: '🔥', t: 'Alta Performance',    d: 'Busca constante por evolução e excelência' },
  { ico: '💛', t: 'Espírito de Equipe',  d: 'Colaboração, respeito e crescimento juntos' },
  { ico: '📚', t: 'Aprendizado Contínuo', d: 'Formação, capacitação e desenvolvimento' },
  { ico: '🏆', t: 'Meritocracia',         d: 'Reconhecimento baseado em resultados reais' },
];

const REGRAS = [
  'Pontualidade e comprometimento com horários',
  'Respeito aos colegas, líderes e clientes',
  'Uso adequado do CRM e ferramentas do sistema',
  'Participação ativa em treinamentos e reuniões',
  'Comunicação clara e profissional',
  'Vestimenta e apresentação alinhadas à marca PSM',
];

export async function pageManual(ctx, root) {
  root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📖 Manual de Cultura PSM Imóveis</h2>
      <p class="card-sub">Valores, missão e visão que guiam a equipe PSM</p>

      <div class="mt-4">
        <h3 style="color:var(--psm-gold);font-size:15px;margin-bottom:8px">🎯 Nossa Missão</h3>
        <p style="line-height:1.7">Transformar sonhos em endereços, conectando pessoas ao imóvel ideal com excelência, ética e resultado. Atuamos como uma assessoria imobiliária completa, oferecendo segurança e transparência em cada negociação.</p>
      </div>

      <div class="mt-4">
        <h3 style="color:var(--psm-gold);font-size:15px;margin-bottom:8px">👁 Nossa Visão</h3>
        <p style="line-height:1.7">Ser a assessoria imobiliária mais admirada e respeitada de São José do Rio Preto, reconhecida pela alta performance, inovação tecnológica e formação de profissionais de excelência no mercado imobiliário.</p>
      </div>

      <div class="mt-4">
        <h3 style="color:var(--psm-gold);font-size:15px;margin-bottom:8px">💛 Nossos Valores</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(180px, 1fr));gap:10px">
          ${VALORES.map(v => `
            <div style="background:var(--bg-3);border-radius:10px;padding:14px;text-align:center">
              <div style="font-size:28px;margin-bottom:6px">${v.ico}</div>
              <div style="font-weight:800;color:var(--psm-gold);font-size:13px">${v.t}</div>
              <div class="tiny muted mt-1">${v.d}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="mt-4">
        <h3 style="color:var(--psm-gold);font-size:15px;margin-bottom:8px">🏢 Sobre a PSM</h3>
        <p style="line-height:1.7">A PSM Assessoria Imobiliária atua no mercado de São José do Rio Preto com foco em lançamentos, imóveis de terceiros, locação e conquista. Nossa equipe é formada por profissionais treinados e comprometidos com os mais altos padrões de atendimento.</p>
      </div>

      <div class="mt-4">
        <h3 style="color:var(--psm-gold);font-size:15px;margin-bottom:8px">📋 Regras de Convivência</h3>
        <ul style="list-style:none;padding:0;line-height:2">
          ${REGRAS.map(r => `<li>✅ ${r}</li>`).join('')}
        </ul>
      </div>

      <div class="mt-4" style="background:linear-gradient(135deg, #0b1f3a 0%, #1e3a5f 100%);color:#fff;padding:24px;border-radius:12px;text-align:center">
        <div style="font-size:20px;font-weight:900;margin-bottom:6px">PSM Assessoria Imobiliária</div>
        <div style="font-size:13px;opacity:.8;max-width:500px;margin:0 auto">Transformamos sonhos em endereços. Cada negociação é uma oportunidade de impactar vidas com ética, excelência e resultado.</div>
      </div>

      <div class="mt-4 flex gap-2" style="flex-wrap:wrap">
        <button class="btn btn-primary" data-nav="/etica">⚖️ Ver Código de Ética →</button>
        <button class="btn btn-ghost" data-nav="/base">📚 Voltar pra Base de Conhecimento</button>
      </div>
    </div>
  `;
  root.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
    location.hash = b.dataset.nav;
  }));
}
