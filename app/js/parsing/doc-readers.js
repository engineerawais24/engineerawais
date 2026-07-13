/* ============================================================
   DocReaders — local DOCX and PDF text extraction (Sprint 28).

   Everything happens in the browser, on bytes the user already
   uploaded. No library, no network, no OCR, no service: DEFLATE is
   handled by the browser's own DecompressionStream, which is a
   platform API, not a dependency.

   DOCX — a ZIP. We read the central directory, pull out
          word/document.xml and turn its paragraph markup into text.
   PDF  — the content streams of a TEXT-BASED pdf. We inflate each
          stream and read the text-showing operators (Tj/TJ/'/").
          A scanned PDF has no text operators, so it comes back empty
          and the parser reports it as unreadable rather than guessing.

   Nothing here writes anything. It only reads bytes and returns text.
   ============================================================ */

const DocReaders = (() => {

  /* ---------- bytes ---------- */

  function bytesFromDataUrl(dataUrl) {
    const b64 = String(dataUrl || '').split(',')[1] || '';
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32 = (b, i) => ((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + (b[i + 3] * 0x1000000));

  function latin1(bytes) {
    let s = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return s;
  }

  /* ---------- DEFLATE (the browser's own decompressor) ---------- */

  async function inflate(bytes, format) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot decompress the file');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }
  const inflateRaw = b => inflate(b, 'deflate-raw');   // ZIP entries
  const inflateZlib = b => inflate(b, 'deflate');      // PDF FlateDecode

  /* ---------- ZIP ---------- */

  /* Read the central directory — the authoritative index of a ZIP.
     Returns { name → Uint8Array } for the entries asked for. */
  async function unzip(bytes, wanted) {
    /* the End Of Central Directory record, scanned from the back */
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65558; i--) {
      if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error('Not a valid DOCX (no ZIP directory)');

    const count = u16(bytes, eocd + 10);
    let p = u32(bytes, eocd + 16);                 // start of the central directory
    const out = {};

    for (let n = 0; n < count && p + 46 <= bytes.length; n++) {
      if (u32(bytes, p) !== 0x02014b50) break;     // not a central-directory entry
      const method = u16(bytes, p + 10);
      const compressedSize = u32(bytes, p + 20);
      const nameLen = u16(bytes, p + 28);
      const extraLen = u16(bytes, p + 30);
      const commentLen = u16(bytes, p + 32);
      const localOffset = u32(bytes, p + 42);
      const name = latin1(bytes.subarray(p + 46, p + 46 + nameLen));

      if (!wanted || wanted.indexOf(name) !== -1) {
        /* the local header repeats the name/extra with its own lengths */
        if (u32(bytes, localOffset) !== 0x04034b50) throw new Error('Corrupted DOCX (bad entry header)');
        const lNameLen = u16(bytes, localOffset + 26);
        const lExtraLen = u16(bytes, localOffset + 28);
        const start = localOffset + 30 + lNameLen + lExtraLen;
        const raw = bytes.subarray(start, start + compressedSize);
        if (method === 0) out[name] = raw.slice();                // stored
        else if (method === 8) out[name] = await inflateRaw(raw); // deflated
        else throw new Error('Unsupported compression in the DOCX');
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  /* ---------- DOCX ---------- */

  const XML_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
  function unescapeXml(s) {
    return s.replace(/&(amp|lt|gt|quot|apos);/g, m => XML_ENTITIES[m])
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
  }

  /* word/document.xml → plain text, one line per <w:p> */
  function xmlToText(xml) {
    let s = String(xml || '');
    s = s.replace(/<w:tab\b[^>]*\/>/g, '\t');
    s = s.replace(/<w:br\b[^>]*\/>/g, '\n');
    s = s.replace(/<\/w:p>/g, '\n');                  // a paragraph is a line
    /* keep only the text runs */
    const parts = [];
    const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|(\n)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m[1] != null) parts.push(unescapeXml(m[1]));
      else parts.push('\n');
    }
    return parts.join('')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* document.xml is UTF-8 — decoding it as latin-1 would turn every em dash,
     bullet and accent into mojibake, and the "Title — Company" lines would
     stop splitting */
  function utf8(bytes) {
    return (typeof TextDecoder !== 'undefined')
      ? new TextDecoder('utf-8').decode(bytes)
      : decodeURIComponent(escape(latin1(bytes)));
  }

  async function docxText(bytes) {
    const files = await unzip(bytes, ['word/document.xml']);
    const doc = files['word/document.xml'];
    if (!doc) throw new Error('The DOCX has no document body');
    return xmlToText(utf8(doc));
  }

  /* ---------- PDF ---------- */

  /* A PDF text string is a BYTE string. Text-based PDFs written by Word,
     LaTeX and the like use WinAnsiEncoding, where the punctuation a résumé is
     full of — em dashes, bullets, curly quotes — lives in 0x80–0x9F. Map it
     back to Unicode, or every "Title — Company" line arrives as gibberish. */
  const WINANSI = {
    0x82: '‚', 0x85: '…', 0x91: '‘', 0x92: '’',
    0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–',
    0x97: '—', 0xA0: ' ',
  };
  function fixWinAnsi(s) {
    return String(s).replace(/[\x82\x85\x91-\x97\xa0]/g, c => WINANSI[c.charCodeAt(0)] || c);
  }

  /* a PDF string: (literal) with escapes, or <hex> */
  function pdfLiteral(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c !== '\\') { out += c; continue; }
      const n = s[++i];
      if (n === 'n') out += '\n';
      else if (n === 'r') out += '\r';
      else if (n === 't') out += '\t';
      else if (n === 'b' || n === 'f') out += ' ';
      else if (n >= '0' && n <= '7') {                 // octal escape
        let oct = n;
        while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
        out += String.fromCharCode(parseInt(oct, 8));
      } else if (n === '\n') { /* line continuation */ }
      else out += n;                                   // \( \) \\
    }
    return out;
  }
  function pdfHex(s) {
    const hex = s.replace(/[^0-9a-fA-F]/g, '');
    let out = '';
    for (let i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    return out;
  }

  /* pull the text-showing operators out of one content stream */
  function textFromContent(content) {
    const lines = [];
    let line = '';
    /* strings, then the operators that move to a new line */
    const re = /\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]*>|\bT[dDjJ*]\b|\bTL\b|'|"/g;
    let m;
    let pending = [];
    while ((m = re.exec(content)) !== null) {
      const tok = m[0];
      if (tok[0] === '(') { pending.push(pdfLiteral(tok.slice(1, -1))); continue; }
      if (tok[0] === '<') { pending.push(pdfHex(tok.slice(1, -1))); continue; }
      if (tok === 'Tj' || tok === 'TJ' || tok === "'" || tok === '"') {
        line += pending.join('');
        pending = [];
        if (tok === "'" || tok === '"') { lines.push(line); line = ''; }
        continue;
      }
      if (tok === 'Td' || tok === 'TD' || tok === 'T*') {   // a new line of text
        pending = [];
        if (line) { lines.push(line); line = ''; }
      }
    }
    if (line) lines.push(line);
    return lines.join('\n');
  }

  async function pdfText(bytes) {
    const raw = latin1(bytes);
    if (raw.slice(0, 5) !== '%PDF-') throw new Error('Not a valid PDF');

    const out = [];
    const re = /stream\r?\n?/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const start = m.index + m[0].length;
      const end = raw.indexOf('endstream', start);
      if (end === -1) break;
      let data = bytes.subarray(start, end);
      /* trim the EOL that precedes `endstream` */
      while (data.length && (data[data.length - 1] === 0x0a || data[data.length - 1] === 0x0d)) {
        data = data.subarray(0, data.length - 1);
      }
      let content = null;
      if (data.length > 2 && data[0] === 0x78) {          // zlib-compressed (FlateDecode)
        try { content = latin1(await inflateZlib(data)); } catch (e) { content = null; }
      } else {
        content = latin1(data);
      }
      if (content && /\bT[jJ*]\b|\bTd\b|\bBT\b/.test(content)) {
        const t = textFromContent(content);
        if (t.trim()) out.push(t);
      }
      re.lastIndex = end;
    }
    return fixWinAnsi(out.join('\n')).replace(/\n{3,}/g, '\n\n').trim();
  }

  return {
    bytesFromDataUrl, latin1, utf8, fixWinAnsi,
    inflateRaw, inflateZlib, unzip,
    xmlToText, docxText,
    textFromContent, pdfText,
  };
})();
