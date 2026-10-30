// =====================================================================
// PLANILHAS EXCEL (.xlsx) SEM BIBLIOTECA EXTERNA
//
// Um arquivo .xlsx é um ZIP com arquivos XML dentro. Este módulo:
//   - ESCREVE planilhas formatadas (título, logo, cabeçalho verde, R$, datas,
//     linha de TOTAL com fórmulas SOMA, filtro e cabeçalho congelado);
//   - LÊ planilhas enviadas (todas as abas, com datas e números de verdade).
// Usa só o zlib que já vem no Node: nada para instalar.
//
//   const pasta = novaPasta();
//   pasta.aba('Clientes', { titulo, subtitulo, logo, colunas, linhas, total: true });
//   const buffer = pasta.gerar();
//
//   const { abas } = lerPasta(buffer);   // [{ nome, linhas: [[valor, ...], ...] }]
// =====================================================================
const zlib = require('zlib');

// ---------------------------------------------------------------------
// ZIP (escrever e ler)
// ---------------------------------------------------------------------
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipar(arquivos) { // arquivos: [{ nome, dados: Buffer|string }]
  const locais = [];
  const centrais = [];
  let offset = 0;
  const agora = new Date();
  const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
  const dia = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8');
    const dados = Buffer.isBuffer(a.dados) ? a.dados : Buffer.from(a.dados, 'utf8');
    const comprimido = zlib.deflateRawSync(dados, { level: 6 });
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); // utf-8
    local.writeUInt16LE(8, 8); local.writeUInt16LE(hora, 10); local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comprimido.length, 18); local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nome.length, 26); local.writeUInt16LE(0, 28);
    locais.push(local, nome, comprimido);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(hora, 12); central.writeUInt16LE(dia, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(comprimido.length, 20); central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nome.length, 28); central.writeUInt32LE(offset, 42);
    centrais.push(central, nome);
    offset += 30 + nome.length + comprimido.length;
  }
  const tamCentral = centrais.reduce((t, b) => t + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(tamCentral, 12); fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, ...centrais, fim]);
}

function deszipar(buf) { // -> Map(nome -> Buffer)
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error('O arquivo não é uma planilha .xlsx válida.');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const arquivos = new Map();
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Planilha corrompida.');
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const tamNome = buf.readUInt16LE(p + 28);
    const tamExtra = buf.readUInt16LE(p + 30);
    const tamComent = buf.readUInt16LE(p + 32);
    const offLocal = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + tamNome).toString('utf8');
    const ini = offLocal + 30 + buf.readUInt16LE(offLocal + 26) + buf.readUInt16LE(offLocal + 28);
    const bruto = buf.subarray(ini, ini + tamComp);
    if (metodo === 0) arquivos.set(nome, bruto);
    else if (metodo === 8) arquivos.set(nome, zlib.inflateRawSync(bruto, { maxOutputLength: 200 * 1024 * 1024 }));
    p += 46 + tamNome + tamExtra + tamComent;
  }
  return arquivos;
}

// ---------------------------------------------------------------------
// ESCRITA
// ---------------------------------------------------------------------
const xml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); // caracteres que o XML não aceita
const letra = (i) => { let s = ''; i += 1; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
const serialData = (iso) => { const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number); return (Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };

// Estilos (índices do cellXfs abaixo)
const E = {
  padrao: 0, titulo: 1, subtitulo: 2, cabecalho: 3,
  texto: 4, inteiro: 5, decimal: 6, moeda: 7, data: 8, percentual: 9,
  totTexto: 10, totInteiro: 11, totDecimal: 12, totMoeda: 13, totPercentual: 14,
  // linhas de demonstrativo (DRE): título de grupo, resultado final e itens recuados
  grpTexto: 15, grpMoeda: 16, grpPercentual: 17, resTexto: 18, resMoeda: 19, resPercentual: 20,
  item1: 21, item2: 22, item2Moeda: 23, item2Percentual: 24,
};
// Estilo da célula conforme o destaque da linha (l._estilo) e o formato da coluna
function estiloDaLinha(destaque, formato, coluna) {
  const num = formato === 'percentual' ? 'Percentual' : ['moeda', 'decimal', 'inteiro'].includes(formato) ? 'Moeda' : 'Texto';
  if (destaque === 'grupo') return E[`grp${num}`] ?? E.grpTexto;
  if (destaque === 'subtotal') return E[`tot${num}`] ?? E.totTexto;
  if (destaque === 'resultado') return E[`res${num}`] ?? E.resTexto;
  if (destaque === 'detalhe') return coluna === 0 ? E.item2 : num === 'Percentual' ? E.item2Percentual : num === 'Moeda' ? E.item2Moeda : E.texto;
  if (destaque === 'item' && coluna === 0) return E.item1;
  return null;
}
const ESTILO_DO_FORMATO = { texto: 'texto', inteiro: 'inteiro', decimal: 'decimal', moeda: 'moeda', data: 'data', percentual: 'percentual' };
const ESTILO_TOTAL = { texto: 'totTexto', inteiro: 'totInteiro', decimal: 'totDecimal', moeda: 'totMoeda', data: 'totTexto', percentual: 'totPercentual' };

const ESTILOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4">
<numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00;[Red]\\-&quot;R$&quot;\\ #,##0.00"/>
<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>
<numFmt numFmtId="166" formatCode="0.0%"/>
<numFmt numFmtId="167" formatCode="#,##0.00"/>
</numFmts>
<fonts count="6">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="15"/><color rgb="FF14532D"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="10"/><color rgb="FF4B5563"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF166534"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF0FDF4"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFE5E7EB"/></bottom><diagonal/></border>
<border><left/><right/><top style="medium"><color rgb="FF166534"/></top><bottom style="medium"><color rgb="FF166534"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="25">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="4" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="3" fontId="4" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="167" fontId="4" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="4" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="166" fontId="4" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="4" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="166" fontId="4" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="3" fillId="2" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="166" fontId="3" fillId="2" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment indent="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment indent="3"/></xf>
<xf numFmtId="164" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="166" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function celula(ref, valor, estilo) {
  const s = estilo ? ` s="${estilo}"` : '';
  if (valor === null || valor === undefined || valor === '') return estilo ? `<c r="${ref}"${s}/>` : '';
  if (typeof valor === 'object' && valor.formula) {
    return `<c r="${ref}"${s}><f>${xml(valor.formula)}</f>${Number.isFinite(valor.valor) ? `<v>${valor.valor}</v>` : ''}</c>`;
  }
  if (typeof valor === 'number' && Number.isFinite(valor)) return `<c r="${ref}"${s}><v>${valor}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(valor)}</t></is></c>`;
}

// Converte "data:image/png;base64,..." em { ext, dados, largura, altura }
function lerLogo(dataUrl) {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const dados = Buffer.from(m[2], 'base64');
  let largura = 0; let altura = 0;
  if (m[1] === 'png' && dados.length > 24) { largura = dados.readUInt32BE(16); altura = dados.readUInt32BE(20); }
  if (m[1] === 'jpeg') { // procura o marcador SOF
    for (let i = 2; i < dados.length - 9;) {
      if (dados[i] !== 0xff) { i++; continue; }
      const marcador = dados[i + 1];
      if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) { altura = dados.readUInt16BE(i + 5); largura = dados.readUInt16BE(i + 7); break; }
      i += 2 + dados.readUInt16BE(i + 2);
    }
  }
  if (!largura || !altura) return null;
  return { ext: m[1] === 'jpeg' ? 'jpeg' : 'png', dados, largura, altura };
}

function novaPasta() {
  const abas = [];
  return {
    // colunas: [{ titulo, campo|valor(linha), formato: texto|inteiro|decimal|moeda|data|percentual, largura, total: 'soma'|'texto'|valor }]
    // filtro: false tira o filtro do cabeçalho · rodape: [textos] depois da tabela · paisagem: false = retrato
    // Linha com l._estilo ('grupo'|'subtotal'|'resultado'|'item'|'detalhe') ganha o destaque de demonstrativo.
    // Fórmula com {L3} = a célula da MESMA coluna na 4ª linha de dados (contando do 0); {B:L3} = da coluna B.
    aba(nome, { titulo, subtitulo, logo, colunas, linhas, total = false, notas = [], filtro = true, rodape = [], paisagem = true }) {
      abas.push({ nome: String(nome).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), titulo, subtitulo, logo: lerLogo(logo), colunas, linhas, total, notas, filtro, rodape, paisagem });
      return this;
    },
    gerar() {
      const arquivos = [];
      const tipos = [];
      let imagens = 0;
      const abasXml = abas.map((a, i) => {
        const nCol = a.colunas.length;
        const linhasXml = [];
        const mesclas = [];
        let r = 1;
        // Com logo, o título começa na primeira coluna que fica livre depois dela
        let colTexto = 0;
        if (a.logo) {
          const larguraLogo = Math.round(a.logo.largura * (Math.min(56, a.logo.altura) / a.logo.altura));
          let px = 0;
          while (colTexto < nCol - 1 && px < Math.min(larguraLogo, 170) + 10) { px += Math.round((a.colunas[colTexto].largura || 14) * 7 + 5); colTexto++; }
          colTexto = Math.max(colTexto, 1);
        }
        const ultima = letra(Math.max(nCol - 1, colTexto));
        // Cabeçalho do relatório: título, subtítulo, linha em branco
        const topo = [[a.titulo, E.titulo, 24], [a.subtitulo, E.subtitulo, 16], ...a.notas.map((n) => [n, E.subtitulo, 15])].filter((x) => x[0]);
        const alturaTopo = a.logo ? Math.max(topo.length, 3) : topo.length;
        for (let k = 0; k < alturaTopo; k++) {
          const [texto, estilo, alt] = topo[k] || ['', 0, 16];
          linhasXml.push(`<row r="${r}" ht="${alt}" customHeight="1">${celula(`${letra(colTexto)}${r}`, texto, estilo)}</row>`);
          if (texto && nCol - 1 > colTexto) mesclas.push(`${letra(colTexto)}${r}:${ultima}${r}`);
          r++;
        }
        if (alturaTopo) r++; // linha em branco
        const linhaCab = r;
        linhasXml.push(`<row r="${r}" ht="22" customHeight="1">${a.colunas.map((c, j) => celula(`${letra(j)}${r}`, c.titulo, E.cabecalho)).join('')}</row>`);
        r++;
        const primeiraDado = r;
        for (const l of a.linhas) {
          const cels = a.colunas.map((c, j) => {
            let v = c.valor ? c.valor(l) : l[c.campo];
            const formato = c.formato || 'texto';
            if (v && typeof v === 'object' && typeof v.formula === 'string') {
              v = { ...v, formula: v.formula.replace(/\{(?:([A-Z]{1,3}):)?L(\d+)\}/g, (_, col, k) => `${col || letra(j)}${primeiraDado + Number(k)}`) };
            } else if (v !== null && v !== undefined && v !== '' && formato === 'data') v = serialData(v);
            else if (['inteiro', 'decimal', 'moeda', 'percentual'].includes(formato) && v !== null && v !== '' && v !== undefined) v = Number(v);
            const estilo = estiloDaLinha(l._estilo, formato, j) ?? E[ESTILO_DO_FORMATO[formato]];
            return celula(`${letra(j)}${r}`, v, estilo);
          }).join('');
          linhasXml.push(`<row r="${r}">${cels}</row>`);
          r++;
        }
        const ultimaDado = r - 1;
        if (a.total && a.linhas.length) {
          const cels = a.colunas.map((c, j) => {
            const ref = `${letra(j)}${r}`;
            const estilo = E[ESTILO_TOTAL[c.formato || 'texto']];
            if (j === 0) return celula(ref, 'TOTAL', E.totTexto);
            if (c.total === 'soma') {
              const soma = a.linhas.reduce((t, l) => t + Number((c.valor ? c.valor(l) : l[c.campo]) || 0), 0);
              return celula(ref, { formula: `SUM(${letra(j)}${primeiraDado}:${letra(j)}${ultimaDado})`, valor: Math.round(soma * 100) / 100 }, estilo);
            }
            if (c.total && typeof c.total === 'object') return celula(ref, c.total, estilo); // fórmula pronta
            return celula(ref, c.total ?? '', estilo);
          }).join('');
          linhasXml.push(`<row r="${r}" ht="20" customHeight="1">${cels}</row>`);
          r++;
        }
        // textos depois da tabela (notas, assinaturas)
        if (a.rodape.length) {
          r++;
          for (const texto of a.rodape) {
            linhasXml.push(`<row r="${r}">${celula(`A${r}`, texto, E.subtitulo)}</row>`);
            if (nCol > 1) mesclas.push(`A${r}:${letra(nCol - 1)}${r}`);
            r++;
          }
        }
        const cols = a.colunas.map((c, j) => `<col min="${j + 1}" max="${j + 1}" width="${c.largura || 14}" customWidth="1"/>`).join('');
        const filtro = a.filtro && a.linhas.length ? `<autoFilter ref="A${linhaCab}:${letra(nCol - 1)}${ultimaDado}"/>` : '';
        let desenho = '';
        if (a.logo) {
          imagens++;
          // até 56 px de altura e 170 px de largura, mantendo a proporção
          let alt = Math.min(56, a.logo.altura);
          let larg = Math.round(a.logo.largura * (alt / a.logo.altura));
          if (larg > 170) { alt = Math.round(alt * (170 / larg)); larg = 170; }
          const EMU = 9525;
          arquivos.push({ nome: `xl/media/logo${imagens}.${a.logo.ext}`, dados: a.logo.dados });
          arquivos.push({ nome: `xl/drawings/drawing${imagens}.xml`, dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>${4 * EMU}</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>${4 * EMU}</xdr:rowOff></xdr:from>
<xdr:ext cx="${larg * EMU}" cy="${alt * EMU}"/>
<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${imagens + 1}" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>
<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${larg * EMU}" cy="${alt * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>
<xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>` });
          arquivos.push({ nome: `xl/drawings/_rels/drawing${imagens}.xml.rels`, dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo${imagens}.${a.logo.ext}"/></Relationships>` });
          arquivos.push({ nome: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${imagens}.xml"/></Relationships>` });
          tipos.push(`<Override PartName="/xl/drawings/drawing${imagens}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
          desenho = '<drawing r:id="rId1"/>';
        }
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"${i === 0 ? ' tabSelected="1"' : ''} showGridLines="0"><pane ySplit="${linhaCab}" topLeftCell="A${linhaCab + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${linhasXml.join('')}</sheetData>
${filtro}${mesclas.length ? `<mergeCells count="${mesclas.length}">${mesclas.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="${a.paisagem ? 'landscape' : 'portrait'}" fitToHeight="0"/>
${desenho}
</worksheet>`;
      });

      abasXml.forEach((x, i) => arquivos.push({ nome: `xl/worksheets/sheet${i + 1}.xml`, dados: x }));
      arquivos.push({ nome: '[Content_Types].xml', dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
${tipos.join('\n')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>` });
      arquivos.push({ nome: '_rels/.rels', dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>` });
      arquivos.push({ nome: 'docProps/core.xml', dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>Xylo · CTech Sistemas</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created>
</cp:coreProperties>` });
      arquivos.push({ nome: 'docProps/app.xml', dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Xylo</Application></Properties>` });
      arquivos.push({ nome: 'xl/workbook.xml', dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets>${abas.map((a, i) => `<sheet name="${xml(a.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>

<calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>` });
      arquivos.push({ nome: 'xl/_rels/workbook.xml.rels', dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` });
      arquivos.push({ nome: 'xl/styles.xml', dados: ESTILOS_XML });
      // [Content_Types].xml precisa ser o primeiro arquivo do ZIP
      arquivos.sort((x, y) => (x.nome === '[Content_Types].xml' ? -1 : y.nome === '[Content_Types].xml' ? 1 : 0));
      return zipar(arquivos);
    },
  };
}

// ---------------------------------------------------------------------
// LEITURA
// ---------------------------------------------------------------------
const desxml = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e]
  ?? (e[1] === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(Number(e.slice(1))))));
const textoDe = (trecho) => desxml([...trecho.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
const colunaDe = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

// Formatos de data/hora (os embutidos do Excel + os personalizados com d/m/a/h)
function formatosDeData(estilos) {
  const datas = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
  const horas = new Set([18, 19, 20, 21, 45, 46, 47]);
  for (const m of estilos.matchAll(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g)) {
    const codigo = desxml(m[2]).replace(/"[^"]*"|\[[^\]]*\]|\\./g, '').toLowerCase();
    if (/[dy]/.test(codigo) || /m{3,}/.test(codigo)) datas.add(Number(m[1]));
    else if (/h|s/.test(codigo)) horas.add(Number(m[1]));
  }
  const xfs = (estilos.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '';
  return [...xfs.matchAll(/<xf\b([^>]*)/g)].map((m) => {
    const id = Number((m[1].match(/numFmtId="(\d+)"/) || [])[1] || 0);
    return datas.has(id) ? 'data' : horas.has(id) ? 'hora' : null;
  });
}

function lerPasta(buffer) {
  const arq = deszipar(buffer);
  const ler = (n) => (arq.get(n) ? arq.get(n).toString('utf8') : '');
  const workbook = ler('xl/workbook.xml');
  if (!workbook) throw new Error('O arquivo não é uma planilha do Excel (.xlsx).');
  const rels = {}; // atributos podem vir em qualquer ordem
  for (const m of ler('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)>/g)) {
    const id = (m[1].match(/Id="([^"]+)"/) || [])[1];
    const alvo = (m[1].match(/Target="([^"]+)"/) || [])[1];
    if (id && alvo) rels[id] = alvo;
  }
  const compartilhadas = [...ler('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1]));
  const tipoEstilo = formatosDeData(ler('xl/styles.xml'));
  const data1904 = /date1904="(1|true)"/.test(workbook);

  const abas = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const nome = desxml((m[1].match(/name="([^"]*)"/) || [])[1] || '');
    const rid = (m[1].match(/r:id="([^"]+)"/) || [])[1];
    let alvo = rels[rid] || '';
    alvo = alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, '')}`;
    const conteudo = ler(alvo);
    const linhas = [];
    // (linhas vazias podem vir como <row r="5"/>: não podem "engolir" a linha seguinte)
    for (const lin of conteudo.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = Number((lin[1].match(/\br="(\d+)"/) || [])[1]) - 1;
      const valores = [];
      for (const c of (lin[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const atr = c[1];
        const dentro = c[2] || '';
        const ref = (atr.match(/\br="([A-Z]+\d+)"/) || [])[1];
        const col = ref ? colunaDe(ref) : valores.length;
        const t = (atr.match(/\bt="(\w+)"/) || [])[1] || 'n';
        const s = Number((atr.match(/\bs="(\d+)"/) || [])[1] || 0);
        const v = (dentro.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let valor = null;
        if (t === 's') valor = compartilhadas[Number(v)] ?? null;
        else if (t === 'inlineStr') valor = textoDe(dentro);
        else if (t === 'str') valor = v !== undefined ? desxml(v) : null;
        else if (t === 'b') valor = v === '1';
        else if (t === 'e') valor = null;
        else if (v !== undefined && v !== '') {
          const num = Number(v);
          if (tipoEstilo[s] === 'data' && num >= 1) {
            const ms = Math.round((num + (data1904 ? 1462 : 0) - 25569) * 86400000);
            valor = new Date(ms);
          } else if (tipoEstilo[s] === 'hora' || (tipoEstilo[s] === 'data' && num < 1)) {
            const min = Math.round((num % 1) * 1440);
            valor = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
          } else valor = num;
        }
        valores[col] = valor;
      }
      linhas[r] = valores;
    }
    abas.push({ nome, linhas: Array.from(linhas, (l) => l || []) });
  }
  return { abas };
}

module.exports = { novaPasta, lerPasta, serialData, letra };
