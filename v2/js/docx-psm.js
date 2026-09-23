/* ============================================================================
   PSM-OS v2 — Gerador de Word (.docx de verdade) para documentos da PSM  v88.12
   ----------------------------------------------------------------------------
   Mesmo motor das minutas da Morimatsu (zip "store" + CRC32 + WordprocessingML,
   sem CDN — a CSP do House não deixa carregar lib), com duas coisas a mais:
   CABEÇALHO com a logo da imobiliária e RODAPÉ com endereço + nº da página.
   O arquivo abre no Word/Google Docs e pode ser editado à vontade.

   Formato do corpo (texto puro):
     # Título            → título centralizado
     ## Subtítulo        → seção em negrito
     ---                 → linha em branco
     **negrito**         → negrito no meio da linha
     | a | b |           → tabela (1ª linha = cabeçalho)
     [[ASSINATURAS]]l1|l2||outra   → blocos de assinatura (colunas separadas por ||)
     {{variavel}}        → trocado pelo dado real (vazio vira __________)
     {{#var}} … {{/var}} → trecho só aparece se a variável tiver valor
   Sem dependência de DOM na montagem (montarDocx) — dá pra testar no Node.
============================================================================ */

const TXT = new TextEncoder();
let _crcT = null;
function crcTab() {
  if (_crcT) return _crcT;
  _crcT = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); _crcT[i] = c >>> 0; }
  return _crcT;
}
function crc32(u8) { const t = crcTab(); let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = t[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {
  const chunks = [], central = []; let off = 0;
  const w32 = (a, v) => { a.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); };
  const w16 = (a, v) => { a.push(v & 255, (v >>> 8) & 255); };
  for (const f of files) {
    const name = TXT.encode(f.name), data = f.data, crc = crc32(data);
    const h = []; w32(h, 0x04034b50); w16(h, 20); w16(h, 0x0800); w16(h, 0); w16(h, 0); w16(h, 0);
    w32(h, crc); w32(h, data.length); w32(h, data.length); w16(h, name.length); w16(h, 0);
    const head = new Uint8Array(h);
    chunks.push(head, name, data);
    const c = []; w32(c, 0x02014b50); w16(c, 20); w16(c, 20); w16(c, 0x0800); w16(c, 0); w16(c, 0); w16(c, 0);
    w32(c, crc); w32(c, data.length); w32(c, data.length); w16(c, name.length); w16(c, 0); w16(c, 0); w16(c, 0); w16(c, 0); w32(c, 0); w32(c, off);
    central.push(new Uint8Array(c), name);
    off += head.length + name.length + data.length;
  }
  const cdSize = central.reduce((s, a) => s + a.length, 0);
  const e = []; w32(e, 0x06054b50); w16(e, 0); w16(e, 0); w16(e, files.length); w16(e, files.length); w32(e, cdSize); w32(e, off); w16(e, 0);
  return new Blob([...chunks, ...central, new Uint8Array(e)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

const xml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ─────────────── preenchimento ─────────────── */
export const VAZIO = '__________';
const temValor = v => v !== undefined && v !== null && String(v).trim() !== '';
export function preencher(corpo, ctx) {
  let t = String(corpo || '');
  // blocos condicionais (aceita aninhados de variáveis diferentes)
  for (let i = 0; i < 6; i++) {
    const antes = t;
    // a quebra de linha depois do {{/x}} só some quando o bloco ocupa linhas inteiras
    // ({{#x}} no começo da linha) — bloco no meio da linha não pode colar a linha seguinte
    t = t.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}(\n?)/g, (m, k, dentro, nl, off, str) => {
      const inicioDeLinha = off === 0 || str[off - 1] === '\n';
      return temValor(ctx[k]) ? dentro + nl : (inicioDeLinha ? '' : nl);
    });
    if (t === antes) break;
  }
  return t.replace(/\{\{(\w+)\}\}/g, (m, k) => (temValor(ctx[k]) ? String(ctx[k]) : VAZIO));
}
/* variáveis que o corpo usa (na ordem em que aparecem) */
export function varsDoCorpo(corpo) {
  const vistos = new Set(), out = [];
  String(corpo || '').replace(/\{\{[#/]?(\w+)\}\}/g, (m, k) => { if (!vistos.has(k)) { vistos.add(k); out.push(k); } return m; });
  return out;
}

/* ─────────────── corpo → WordprocessingML ─────────────── */
function montarParas(corpo, fonte) {
  const F = `<w:rFonts w:ascii="${fonte}" w:hAnsi="${fonte}" w:cs="${fonte}"/>`;
  const runs = (txt, sz) => String(txt).split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(p => {
    const b = p.startsWith('**') && p.endsWith('**');
    const t = b ? p.slice(2, -2) : p;
    return `<w:r><w:rPr>${F}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>${b ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${xml(t)}</w:t></w:r>`;
  }).join('');
  const celulas = l => l.replace(/^\||\|$/g, '').split('|').map(x => x.trim());
  const tabela = linhas => {
    const bord = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(b => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="BFC5CC"/>`).join('') + '</w:tblBorders>';
    const tr = (cs, head) => '<w:tr>' + cs.map(t => {
      const dir = /^R\$|^-?[\d.,]+%?$/.test(t.trim());
      return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF1F4"/>' : ''}</w:tcPr>`
        + `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>${dir ? '<w:jc w:val="right"/>' : ''}</w:pPr>`
        + runs(head ? '**' + t + '**' : t, 20) + '</w:p></w:tc>';
    }).join('') + '</w:tr>';
    return '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>' + bord + '</w:tblPr>'
      + linhas.map((c, i) => tr(c, i === 0)).join('') + '</w:tbl>';
  };
  const out = [];
  const P = (inner, jc, after, junto) => out.push(`<w:p><w:pPr>${junto ? '<w:keepNext/><w:keepLines/>' : ''}${jc ? `<w:jc w:val="${jc}"/>` : ''}<w:spacing w:after="${after ?? 120}" w:line="276" w:lineRule="auto"/></w:pPr>${inner}</w:p>`);
  const linhas = String(corpo).split('\n');
  for (let n = 0; n < linhas.length; n++) {
    const l = linhas[n].trimEnd();
    if (l.trim().startsWith('|')) {
      const bloco = [];
      while (n < linhas.length && linhas[n].trim().startsWith('|')) bloco.push(celulas(linhas[n].trim())), n++;
      n--;
      out.push(tabela(bloco)); P('', null, 120);
      continue;
    }
    if (l.startsWith('[[ASSINATURAS]]')) {
      const cols = l.slice(15).split('||').map(c => c.split('|'));
      // cada assinatura fica inteira na mesma página (keepNext até a última linha)
      P('', null, 360, true);
      cols.forEach((c, ci) => {
        P(runs('_________________________________________', 22), 'center', 0, true);
        c.forEach((x, xi) => P(runs(x, 20), 'center', 40, ci < cols.length - 1 || xi < c.length - 1));
        if (ci < cols.length - 1) P('', null, 300, true); else P('', null, 200);
      });
      continue;
    }
    if (l === '---') { P('', null, 120); continue; }
    if (l.startsWith('## ')) { P(runs('**' + l.slice(3) + '**', 22), null, 100, true); continue; }   // título nunca fica sozinho no pé da página
    if (l.startsWith('# ')) { P(runs('**' + l.slice(2) + '**', 26), 'center', 240); continue; }
    if (!l.trim()) { P('', null, 40); continue; }
    P(runs(l, 22), 'both');
  }
  return out.join('');
}

/* dimensões de um PNG (lidas do IHDR) */
export function pngDim(u8) {
  if (!u8 || u8.length < 24 || u8[1] !== 0x50) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const NS_IMG = ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * Monta o .docx (Blob).
 * @param {object} o
 * @param {string} o.corpo      texto JÁ preenchido
 * @param {string} [o.fonte]    fonte do corpo (padrão Arial)
 * @param {{bytes:Uint8Array, alturaCm?:number}} [o.logo]  PNG do cabeçalho
 * @param {string[]} [o.rodape] linhas do rodapé (a última ganha "· pág. N")
 */
export function montarDocx({ corpo, fonte = 'Arial', logo = null, rodape = [] }) {
  const temLogo = !!(logo && logo.bytes && pngDim(logo.bytes));
  const temRodape = rodape.length > 0;
  const F = `<w:rFonts w:ascii="${fonte}" w:hAnsi="${fonte}" w:cs="${fonte}"/>`;

  let header = '';
  if (temLogo) {
    const d = pngDim(logo.bytes);
    const cy = Math.round((logo.alturaCm || 0.9) * 360000);
    const cx = Math.round(cy * d.w / d.h);
    header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${NS}${NS_IMG}><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="200"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Logo"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:hdr>`;
  }
  let footer = '';
  if (temRodape) {
    const rp = `<w:rPr>${F}<w:color w:val="6B7280"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>`;
    const linhas = rodape.map((l, i) => {
      const ult = i === rodape.length - 1;
      return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:r>${rp}<w:t xml:space="preserve">${xml(l)}${ult ? '  ·  pág. ' : ''}</w:t></w:r>`
        + (ult ? `<w:r>${rp}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rp}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r>${rp}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rp}<w:t>1</w:t></w:r><w:r>${rp}<w:fldChar w:fldCharType="end"/></w:r>` : '') + '</w:p>';
    }).join('');
    footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${NS}><w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="BFC5CC"/></w:pBdr><w:spacing w:after="0"/></w:pPr></w:p>${linhas}</w:ftr>`;
  }

  const refs = (temLogo ? '<w:headerReference w:type="default" r:id="rIdHdr"/>' : '') + (temRodape ? '<w:footerReference w:type="default" r:id="rIdFtr"/>' : '');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${montarParas(corpo, fonte)}<w:sectPr>${refs}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1134" w:left="1418" w:header="567" w:footer="454" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${temLogo ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ''}${temRodape ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ''}</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${temLogo ? `<Relationship Id="rIdHdr" Type="${REL}/header" Target="header1.xml"/>` : ''}${temRodape ? `<Relationship Id="rIdFtr" Type="${REL}/footer" Target="footer1.xml"/>` : ''}</Relationships>`;

  const files = [
    { name: '[Content_Types].xml', data: TXT.encode(ct) },
    { name: '_rels/.rels', data: TXT.encode(rels) },
    { name: 'word/document.xml', data: TXT.encode(doc) },
    { name: 'word/_rels/document.xml.rels', data: TXT.encode(docRels) },
  ];
  if (temLogo) {
    files.push({ name: 'word/header1.xml', data: TXT.encode(header) });
    files.push({ name: 'word/_rels/header1.xml.rels', data: TXT.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLogo" Type="${REL}/image" Target="media/logo.png"/></Relationships>`) });
    files.push({ name: 'word/media/logo.png', data: logo.bytes });
  }
  if (temRodape) files.push({ name: 'word/footer1.xml', data: TXT.encode(footer) });
  return zipStore(files);
}

/* ─────────────── navegador: logo + download ─────────────── */
const _logoCache = {};
export async function carregarLogo(url) {
  if (!url) return null;
  if (_logoCache[url]) return _logoCache[url];
  try {
    const r = await fetch(url, { cache: 'force-cache' });
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!pngDim(bytes)) return null;
    return (_logoCache[url] = bytes);
  } catch { return null; }
}
export function baixarBlob(blob, nomeArquivo) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = String(nomeArquivo).replace(/[^\w\s.\-–—áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ&]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) + '.docx';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

/* ─────────────── formatação (valor por extenso, datas) ─────────────── */
const UN = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CT = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function ate999(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100, p = [];
  if (c) p.push(CT[c]);
  if (r) p.push(r < 20 ? UN[r] : DZ[Math.floor(r / 10)] + (r % 10 ? ' e ' + UN[r % 10] : ''));
  return p.join(' e ');
}
function inteiroExtenso(n) {
  if (n === 0) return 'zero';
  const esc = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
  const grupos = []; let x = n;
  while (x > 0) { grupos.push(x % 1000); x = Math.floor(x / 1000); }
  const partes = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i]; if (!g) continue;
    let t = (i === 1 && g === 1) ? 'mil' : ate999(g) + (i ? ' ' + (g === 1 ? esc[i][0] : esc[i][1]) : '');
    partes.push({ t, g, i });
  }
  // "e" antes do último bloco só se ele for < 100 ou múltiplo de 100
  return partes.map((p, k) => {
    if (k === 0) return p.t;
    const ultimo = k === partes.length - 1;
    return (ultimo && (p.g < 100 || p.g % 100 === 0) ? ' e ' : ', ') + p.t;
  }).join('');
}
export function extensoReais(v) {
  const n = Math.round((+v || 0) * 100);
  if (!n) return '';
  const reais = Math.floor(n / 100), cent = n % 100;
  let t = '';
  if (reais) {
    t = inteiroExtenso(reais);
    const redondoMilhao = reais >= 1000000 && reais % 1000000 === 0;
    t += (redondoMilhao ? ' de ' : ' ') + (reais === 1 ? 'real' : 'reais');
  }
  if (cent) t += (reais ? ' e ' : '') + inteiroExtenso(cent) + (cent === 1 ? ' centavo' : ' centavos');
  return t;
}
export const moeda = v => (+v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/* "R$ 190.000,00 (cento e noventa mil reais)" */
export const valorComExtenso = v => (+v ? `R$ ${moeda(v)} (${extensoReais(v)})` : '');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function dataExtenso(iso) {
  const d = iso ? new Date(String(iso).slice(0, 10) + 'T12:00') : new Date();
  if (isNaN(d)) return '';
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}
export function dataBR(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}
/* aceita "190.000,00", "190000", "R$ 190 mil" (só dígitos/.,) */
export function numBR(s) {
  if (typeof s === 'number') return s;
  let t = String(s ?? '').replace(/[^\d.,-]/g, '');
  if (!t) return 0;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(t)) t = t.replace(/\./g, '');
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}
