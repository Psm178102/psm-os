/* PSM-OS v2 — Hub Central de Agentes IA (Sprint 8.2) */
import { auth } from '../auth.js';

const AGENTS = [
  // v87.31: Agentes Diretoria — C-level IA interligado pela Rede de Agentes (sócio)
  { id: 'ceo',          name: 'CEO PSM',       line: 'Diretoria · rede de agentes', ico: '🎩', color: '#806d50',
    desc: 'Braço direito executivo: visão do todo, prioridades, preparo de decisão e fiscalização do Plano de Resgate',
    channels: ['House PSM Chat', 'Rede de Agentes'], status: 'active', page: '/agente-ceo' },
  { id: 'cfo',          name: 'Sr. CFO',       line: 'Diretoria · rede de agentes', ico: '💰', color: '#239a5b',
    desc: 'Cérebro financeiro: caixa, dívida, margens, break-even e auditoria de incongruências',
    channels: ['House PSM Chat', 'Rede de Agentes'], status: 'active', page: '/agente-cfo' },
  { id: 'cmo',          name: 'CMO PSM',       line: 'Diretoria · rede de agentes', ico: '📣', color: '#c7861a',
    desc: 'Estratégia de marketing integrada: budget por nicho, CAC/ROAS e arbitragem dos executores',
    channels: ['House PSM Chat', 'Rede de Agentes'], status: 'active', page: '/agente-cmo' },
  { id: 'vera',         name: 'Vera',          line: 'PSM Assessoria Imobiliária', ico: '💜', color: '#806d50',
    desc: 'Atendimento de leads, qualificação, nutrição e captação para assessoria imobiliária',
    channels: ['WhatsApp', 'Instagram DM'], status: 'config', page: '/agente-vera' },
  { id: 'sol',          name: 'Sol',           line: 'PSM Conquista',              ico: '☀️', color: '#c7861a',
    desc: 'Prospecção, atendimento e nutrição de leads para incorporação e loteamento',
    channels: ['WhatsApp', 'Instagram DM'], status: 'pending', page: '/agente-sol' },
  { id: 'performance',  name: 'Sr. Performance', line: 'Mentor de Corretores',     ico: '🤖', color: '#0f172a',
    desc: 'Treina corretores do zero ao nível expert com dados reais do CRM',
    channels: ['House PSM Chat'], status: 'active', page: '/sr-performance' },
  { id: 'gerencia',     name: 'Sr. Gerência',  line: 'Gestão Operacional',         ico: '👔', color: '#806d50',
    desc: 'Organiza operação, corrige e orienta corretores com foco em resultados',
    channels: ['House PSM Chat'], status: 'pending', page: '/sr-gerencia' },
  { id: 'intelligence', name: 'Sr. Intelligence', line: 'Inteligência Estratégica', ico: '🔍', color: '#239a5b',
    desc: 'Audita, analisa concorrentes e orienta sócios e diretores com dados',
    channels: ['House PSM Chat'], status: 'pending', page: null },
];

const STATUS_MAP = { active: '🟢 Ativo', config: '🟡 Configurando', pending: '⚪ Aguardando' };

const ARCH = [
  { ico: '🧠', t: 'Motor IA',     d: 'Claude/Gemini/OpenAI fallback — raciocínio para vendas consultivas' },
  { ico: '📱', t: 'WhatsApp',     d: 'Evolution API — atendimento via WhatsApp Business' },
  { ico: '📸', t: 'Instagram DM', d: 'Meta Graph API — respostas automáticas via Direct' },
  { ico: '🔗', t: 'CRM',          d: 'RD Station — criação e atualização automática de leads' },
  { ico: '🌐', t: 'Deploy',       d: 'Vercel Serverless — escalável sem servidor' },
  { ico: '🔒', t: 'Segurança',    d: 'Tokens em env vars, CORS, webhook verification' },
];

export async function pageAgentes(ctx, root) {
  const ativos = AGENTS.filter(a => a.status === 'active').length;
  const config = AGENTS.filter(a => a.status === 'config').length;

  root.innerHTML = `
    <div class="card" style="background:var(--surface-2);color:var(--ink);border-radius:var(--radius-lg);padding:24px">
      <h2 style="margin:0;font-size:20px;color:var(--ink)">🧠 Central de Agentes PSM</h2>
      <p style="margin:6px 0 18px;color:var(--ink-muted)">Inteligência artificial a serviço da sua operação imobiliária</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:12px;margin-bottom:24px">
        ${kpi('🧠', 'Agentes Totais', AGENTS.length, '#806d50')}
        ${kpi('🟢', 'Ativos', ativos, '#239a5b')}
        ${kpi('🟡', 'Configurando', config, '#c7861a')}
        ${kpi('💬', 'Conversas Ativas', '—', '#806d50')}
        ${kpi('📡', 'Canais Conectados', 1, '#806d50')}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:14px">
        ${AGENTS.map(a => agentCard(a)).join('')}
      </div>

      <div style="margin-top:24px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-md);padding:20px">
        <div style="font-weight:600;color:var(--ink);margin-bottom:12px">⚡ Arquitetura dos Agentes</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px">
          ${ARCH.map(a => `
            <div style="background:var(--surface-2);border-radius:var(--radius-md);padding:12px">
              <div style="font-size:16px;margin-bottom:6px">${a.ico}</div>
              <div style="font-weight:600;color:var(--ink);font-size:12px;margin-bottom:4px">${a.t}</div>
              <div style="font-size:11px;color:var(--ink-muted);line-height:1.5">${a.d}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  root.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
    location.hash = b.dataset.nav;
  }));
}

function kpi(ico, label, value, color) {
  return `
    <div style="background:var(--surface-2);border-radius:var(--radius-md);padding:14px;border-left:4px solid ${color}">
      <div style="font-size:11px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">${ico} ${label}</div>
      <div style="font-size:26px;font-weight:600;color:${color}">${value}</div>
    </div>
  `;
}

function agentCard(a) {
  const status = STATUS_MAP[a.status] || '⚪ —';
  const statusColor = a.status === 'active' ? '#239a5b' : a.status === 'config' ? '#c7861a' : '#8a8579';
  return `
    <div style="background:var(--surface-2);border-radius:var(--radius-lg);padding:20px;border:1px solid ${a.color}33">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <div style="width:50px;height:50px;border-radius:var(--radius-md);background:${a.color}22;display:flex;align-items:center;justify-content:center;font-size:26px">${a.ico}</div>
        <div style="flex:1">
          <div style="font-size:16px;font-weight:600;color:var(--ink)">${a.name}</div>
          <div style="font-size:11px;color:${a.color};font-weight:600">${a.line}</div>
        </div>
        <span style="font-size:11px;font-weight:600;padding:4px 10px;border-radius:var(--radius-lg);background:${statusColor}22;color:${statusColor}">${status}</span>
      </div>
      <p style="color:var(--ink-muted);font-size:12px;line-height:1.5;margin:0 0 12px">${a.desc}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        ${a.channels.map(ch => `<span style="font-size:11px;padding:3px 8px;border-radius:var(--radius-sm);background:var(--surface-2);color:var(--ink-muted);border:1px solid var(--border)">${ch}</span>`).join('')}
      </div>
      ${a.page
        ? `<button data-nav="${a.page}" style="width:100%;padding:10px;background:${a.color};color:#fff;border:none;border-radius:var(--radius-md);font-size:12px;font-weight:600;cursor:pointer">${a.status === 'active' ? 'Abrir Painel' : 'Configurar'} →</button>`
        : `<button disabled style="width:100%;padding:10px;background:#334155;color:var(--ink-muted);border:none;border-radius:var(--radius-md);font-size:12px;cursor:not-allowed">Em breve</button>`
      }
    </div>
  `;
}
