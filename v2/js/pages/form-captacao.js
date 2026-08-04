/* PSM-OS v2 — 📝 Formulário de Captação (v85.3)
   Os dois Google Forms oficiais (venda + locação) embutidos no sistema:
   o corretor preenche aqui dentro e o envio vai pro Google Forms como
   sempre funcionou — zero mudança no fluxo de respostas. */

const FORMS = {
  venda: {
    nome: '🏷 Captação — VENDA',
    url: 'https://docs.google.com/forms/d/e/1FAIpQLSdcLofTJAEKYnCUVMnuvKD7QJFB_D8SXfcahYYmeCFhy5op0g/viewform',
  },
  locacao: {
    nome: '🔑 Captação — LOCAÇÃO',
    url: 'https://docs.google.com/forms/d/e/1FAIpQLSflYoozPFRs07vE7UO8iz7PJrBhiG5CLvqIrCzr4s6lWJlBqA/viewform',
  },
};

let _root = null, _tipo = 'venda';

export async function pageFormCaptacao(ctx, root) {
  _root = root;
  render();
}

function render() {
  const f = FORMS[_tipo];
  _root.innerHTML = `
    <div class="card" style="padding-bottom:0">
      <div class="flex" style="gap:8px;flex-wrap:wrap;align-items:center">
        ${Object.entries(FORMS).map(([k, v]) => `
          <button class="btn ${_tipo === k ? 'btn-primary' : 'btn-ghost'}" data-fc="${k}">${v.nome}</button>`).join('')}
        <a class="btn btn-ghost btn-sm" style="margin-left:auto" href="${f.url}" target="_blank" rel="noopener" title="se o formulário não carregar aqui dentro">↗ abrir em nova aba</a>
      </div>
      <p class="tiny muted" style="margin:8px 0 10px">Preencha e envie normalmente — as respostas vão pro Google Forms como sempre. Ao terminar, o próprio formulário confirma o envio.</p>
      <div style="margin:0 -16px">
        <iframe src="${f.url}?embedded=true"
                style="width:100%;height:calc(100vh - 230px);min-height:600px;border:0;border-radius:0 0 12px 12px;background:#fff"
                loading="eager" title="${f.nome}">Carregando formulário…</iframe>
      </div>
    </div>`;
  _root.querySelectorAll('[data-fc]').forEach(b => b.onclick = () => { _tipo = b.dataset.fc; render(); });
}
