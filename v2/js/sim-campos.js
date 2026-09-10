/* ============================================================================
   PSM-OS v2 — Campos numéricos dos simuladores (v87.73)
   ----------------------------------------------------------------------------
   POR QUE EXISTE: os simuladores usavam <input type="number"> e redesenhavam a
   tela inteira 250ms depois de cada tecla. No pt-BR isso APAGAVA o campo: o
   type=number devolve "" para uma entrada incompleta ("6," ou "1."), o valor
   virava 0 e o redesenho escrevia o campo vazio de volta — no celular ainda
   fechava o teclado. Relato do Paulo, 10/set: "fica quase impossível preencher".

   A regra agora é a do Simulador VPL, o único que nunca teve o problema:
     1. campo numérico = type=text + inputmode=decimal (teclado numérico no
        celular, aceita vírgula, não muda de valor com a roda do mouse);
     2. o formulário é desenhado UMA vez; a digitação só repinta o RESULTADO;
     3. o número volta para o campo no jeito brasileiro: 6,168 — e não 6.168,
        que o parser leria como seis mil cento e sessenta e oito.
============================================================================ */

export const ATTR_NUM = 'type="text" inputmode="decimal" autocomplete="off"';

/* "1.500,50", "1500.5" e "R$ 1500,5" dão o mesmo número. Ponto só vira milhar
   quando vem seguido de exatamente 3 dígitos ("1.500"); "1.5" é um e meio. */
export function parseNum(txt) {
  if (typeof txt !== 'string') return Number(txt) || 0;
  const t = txt.trim().replace(/\s/g, '').replace(/^R\$/i, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(t);
  return isFinite(n) ? n : 0;
}

/* número → texto do campo: vírgula decimal, sem milhar, até 6 casas */
export function numCampo(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  if (!isFinite(n)) return '';
  return String(Math.round(n * 1e6) / 1e6).replace('.', ',');
}

/* dinheiro → texto do campo: "118.110,89" (o parseNum lê de volta igualzinho) */
export function moedaCampo(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  if (!isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
