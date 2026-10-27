export type SymbolKind = 'user' | 'static' | 'function' | 'class' | 'method' | 'wsmethod';

export interface AdvplSymbol {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  character: number;
  /** Assinatura como está no fonte, ex.: "User Function MT100GRV(nOpc)". */
  signature: string;
  /** Classe dona do método (Method X() Class Y / WSMETHOD ... WSSERVICE Y). */
  className?: string;
  /** true para "Method x()" dentro de Class...EndClass (só declaração). */
  declarationOnly?: boolean;
  /** Bloco Protheus.doc imediatamente acima da declaração. */
  doc?: string;
}

const RE_FUNCTION = /^\s*(?:(user|static|main|project|template|web)\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/i;
const RE_CLASS = /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/i;
const RE_END_CLASS = /^\s*end\s*class\b/i;
const RE_METHOD = /^\s*(?:(?:public|private|protected|static)\s+)*method\s+([A-Za-z_][A-Za-z0-9_]*)/i;
const RE_METHOD_CLASS = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i;
const RE_WSMETHOD = /^\s*wsmethod\s+(?:(?:get|post|put|delete|patch)\s+)?([A-Za-z_][A-Za-z0-9_]*)/i;
const RE_DOC_START = /^\s*\/\*\/?\s*\{Protheus\.doc\}/i;
const RE_WSSERVICE =/\bwsservice\s+([A-Za-z_][A-Za-z0-9_]*)/i;

/**
 * Remove comentários (/* *\/, //, &&) e conteúdo de strings de uma linha,
 * mantendo o estado de bloco de comentário entre linhas.
 */
function stripLine(line: string, state: { inBlock: boolean }): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (state.inBlock) {
      const end = line.indexOf('*/', i);
      if (end < 0) return out;
      state.inBlock = false;
      i = end + 2;
      continue;
    }
    const ch = line[i];
    // [texto] também é string em AdvPL, exceto quando é índice: aCols[1], x()[2], a[1][2]
    const close = ch === '"' || ch === "'" ? ch : ch === '[' && !/[A-Za-z0-9_)\]]\s*$/.test(out) ? ']' : '';
    if (close) {
      const end = line.indexOf(close, i + 1);
      out += ch + close;
      if (end < 0) return out;
      i = end + 1;
      continue;
    }
    if (ch === '/' && line[i + 1] === '*') {
      state.inBlock = true;
      i += 2;
      continue;
    }
    if ((ch === '/' && line[i + 1] === '/') || (ch === '&' && line[i + 1] === '&')) return out;
    out += ch;
    i++;
  }
  return out;
}

/** Corta comentário de fim de linha (// ou &&) sem confundir com o conteúdo de strings ("http://..."). */
function stripTrailingComment(line: string): string {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if ((ch === '/' && line[i + 1] === '/') || (ch === '&' && line[i + 1] === '&')) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Junta continuações com ";" no fim da linha, para pegar a assinatura completa. */
function readSignature(lines: string[], start: number): string {
  let sig = stripTrailingComment(lines[start]).trim();
  let i = start;
  while (/;\s*$/.test(sig) && i + 1 < lines.length && i - start < 10) {
    i++;
    sig = sig.replace(/;\s*$/, ' ') + stripTrailingComment(lines[i]).trim();
  }
  return sig.replace(/\s+/g, ' ').trim();
}

/** Palavras (identificadores) distintas do fonte, em maiúsculas — base do índice de palavras. */
export function extractWords(text: string): string[] {
  return [...new Set(text.toUpperCase().match(/[A-Z_][A-Z0-9_]*/g) ?? [])];
}

/** Muda quando o formato do parser muda, para invalidar o cache em disco. */
export const PARSER_VERSION = 2;

export function parseSymbols(text: string, file: string): AdvplSymbol[] {
  const lines = text.split(/\r?\n/);
  const symbols: AdvplSymbol[] = [];
  const state = { inBlock: false };
  let currentClass: string | undefined;
  let docLines: string[] | undefined;
  let lastDoc: { text: string; endLine: number } | undefined;

  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];

    // Captura blocos /*/{Protheus.doc} ... /*/ para usar no hover.
    if (!docLines && !state.inBlock && RE_DOC_START.test(raw)) {
      docLines = [raw];
      continue;
    }
    if (docLines) {
      const end = raw.indexOf('*/');
      if (end < 0) {
        docLines.push(raw);
        continue;
      }
      docLines.push(raw.slice(0, end));
      lastDoc = { text: formatDoc(docLines), endLine: n };
      docLines = undefined;
      continue;
    }

    const code = stripLine(raw, state);
    if (!code.trim() || /^\s*\*/.test(code)) continue; // vazio ou comentário xBase "* ..."

    const attachDoc = () => (lastDoc && n - lastDoc.endLine <= 3 ? lastDoc.text : undefined);
    const col = (name: string) => Math.max(0, raw.toLowerCase().indexOf(name.toLowerCase(), raw.search(/\S/)));

    let m: RegExpExecArray | null;
    if ((m = RE_FUNCTION.exec(code))) {
      const mod = (m[1] || '').toLowerCase();
      const kind: SymbolKind = mod === 'user' ? 'user' : mod === 'static' ? 'static' : 'function';
      symbols.push({ name: m[2], kind, file, line: n, character: col(m[2]), signature: readSignature(lines, n), doc: attachDoc() });
      currentClass = undefined;
    } else if ((m = RE_END_CLASS.exec(code))) {
      currentClass = undefined;
    } else if ((m = RE_CLASS.exec(code))) {
      currentClass = m[1];
      symbols.push({ name: m[1], kind: 'class', file, line: n, character: col(m[1]), signature: readSignature(lines, n), doc: attachDoc() });
    } else if ((m = RE_WSMETHOD.exec(code))) {
      const sig = readSignature(lines, n);
      const svc = RE_WSSERVICE.exec(sig);
      // Linhas WSMETHOD dentro de WSRESTFUL...END WSRESTFUL são declarações.
      symbols.push({ name: m[1], kind: 'wsmethod', file, line: n, character: col(m[1]), signature: sig, className: svc?.[1], declarationOnly: !svc, doc: attachDoc() });
    } else if ((m = RE_METHOD.exec(code))) {
      const sig = readSignature(lines, n);
      const owner = RE_METHOD_CLASS.exec(sig);
      symbols.push({
        name: m[1], kind: 'method', file, line: n, character: col(m[1]), signature: sig,
        className: owner?.[1] ?? currentClass,
        declarationOnly: !owner && currentClass !== undefined,
        doc: attachDoc(),
      });
    }
  }
  return symbols;
}

function formatDoc(lines: string[]): string {
  return lines
    .map(l => l.replace(RE_DOC_START, '').replace(/^\s*\/$/, '').trim())
    .filter(l => l !== '')
    .join('\n');
}
