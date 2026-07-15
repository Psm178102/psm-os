/* ============================================================================
   PSM-OS v2 — Arrastar card de kanban  v84.62
   ----------------------------------------------------------------------------
   POR QUE ISSO EXISTE: os kanbans usavam HTML5 drag nativo (draggable="true"
   + dragstart/dragover/drop). Esse mecanismo NÃO EXISTE em toque (celular/
   tablet) e falha em várias configurações de trackpad — por isso a Leire nunca
   conseguiu arrastar um lead. Na v84.44 eu contornei com um seletor "mover
   para" DENTRO do modal, mas contorno não é conserto: quem tenta arrastar
   continua sem conseguir, e ninguém adivinha que precisa abrir o card.

   Pointer Events funciona em mouse, trackpad e dedo com o mesmo código.

   Uso:
     ativarDrag({
       host,                      // container do kanban
       card: '.rk-card',          // seletor do card
       coluna: '.rk-col',         // seletor da coluna
       colDe: el => el.dataset.col,
       aoSoltar: async (id, destino) => {...},
       aoClicar: id => {...},     // clique sem arrastar = abre o card
     });
============================================================================ */

const LIMIAR = 6;   // px antes de virar arrasto — abaixo disso ainda é clique

export function ativarDrag({ host, card, coluna, colDe, aoSoltar, aoClicar }) {
  if (!host) return;
  let alvo = null, x0 = 0, y0 = 0, arrastando = false, ghost = null, colAtual = null;

  const realce = col => {
    if (col === colAtual) return;
    if (colAtual) colAtual.style.outline = '';
    colAtual = col;
    if (colAtual) colAtual.style.outline = '2px dashed #2563eb';
  };

  const limpar = () => {
    if (ghost) ghost.remove();
    ghost = null;
    if (alvo) alvo.style.opacity = '';
    if (colAtual) colAtual.style.outline = '';
    alvo = null; colAtual = null; arrastando = false;
  };

  host.addEventListener('pointerdown', e => {
    const el = e.target.closest(card);
    if (!el || !host.contains(el)) return;
    // não sequestra clique em controle dentro do card (botão, link, select…)
    if (e.target.closest('button, a, select, input, textarea, label')) return;
    alvo = el; x0 = e.clientX; y0 = e.clientY; arrastando = false;
  });

  // move/up no WINDOW: se ficasse no host, soltar fora do kanban deixaria o
  // fantasma preso na tela pra sempre
  window.addEventListener('pointermove', e => {
    if (!alvo) return;
    if (!arrastando) {
      if (Math.hypot(e.clientX - x0, e.clientY - y0) < LIMIAR) return;
      arrastando = true;
      try { alvo.setPointerCapture(e.pointerId); } catch (_) {}
      alvo.style.opacity = '.4';
      ghost = alvo.cloneNode(true);
      Object.assign(ghost.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '9999',
        width: alvo.offsetWidth + 'px', opacity: '.92',
        transform: 'rotate(2deg)', boxShadow: '0 12px 26px rgba(0,0,0,.3)',
        left: '-9999px', top: '-9999px', margin: '0',
      });
      document.body.appendChild(ghost);
      document.body.style.userSelect = 'none';   // não seleciona texto ao arrastar
    }
    e.preventDefault();
    ghost.style.left = (e.clientX - 40) + 'px';
    ghost.style.top = (e.clientY - 18) + 'px';
    // o fantasma tem pointerEvents:none, então não atrapalha o elementFromPoint
    const sob = document.elementFromPoint(e.clientX, e.clientY);
    realce(sob ? sob.closest(coluna) : null);
  }, { passive: false });

  window.addEventListener('pointerup', async e => {
    if (!alvo) return;
    const el = alvo, col = colAtual, era = arrastando;
    document.body.style.userSelect = '';
    limpar();
    if (!era) { if (aoClicar) aoClicar(el.dataset.id); return; }   // foi só um clique
    if (col && aoSoltar) await aoSoltar(el.dataset.id, colDe(col));
  });

  window.addEventListener('pointercancel', () => {
    document.body.style.userSelect = '';
    limpar();
  });
}
