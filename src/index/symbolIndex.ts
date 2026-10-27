import { AdvplSymbol, extractWords, parseSymbols } from './parser';

export interface CallContext {
  /** Palavra sob o cursor, possivelmente com prefixo U_. */
  word: string;
  /** Fonte onde está o cursor (para resolver Static Function). */
  file: string;
  /** Precedida de ":" (oObj:Metodo, ::Metodo). */
  isMethodCall: boolean;
}

export interface TextMatch {
  line: number;
  character: number;
  length: number;
  /** Texto da linha, para a prévia no painel de usos. */
  lineText: string;
}

/** O que o índice guarda de cada fonte (é também o formato do cache em disco). */
export interface IndexedFile {
  file: string;
  symbols: AdvplSymbol[];
  /** Palavras distintas do fonte, em maiúsculas. */
  words: string[];
}

export const fileKey = (file: string) => file.replace(/\\/g, '/').toLowerCase();

/** Nomes AdvPL clássicos são significativos até 10 caracteres (User Function: "U_" + 8). */
const shortKey = (name: string, user: boolean) => ((user ? 'U_' : '') + name.toUpperCase()).slice(0, 10);

const isMethod = (s: AdvplSymbol) => s.kind === 'method' || s.kind === 'wsmethod';

export class SymbolIndex {
  private byFile = new Map<string, IndexedFile & { id: number }>();
  private byName = new Map<string, AdvplSymbol[]>();
  private byShort = new Map<string, AdvplSymbol[]>();
  /** Palavra -> ids dos fontes onde ela aparece. Restringe a busca de usos a poucos fontes. */
  private byWord = new Map<string, Set<number>>();
  private idToKey: string[] = [];
  private keyToId = new Map<string, number>();
  /** Incrementa a cada mudança; serve para invalidar caches derivados (contador de usos). */
  generation = 0;

  get fileCount() {
    return this.byFile.size;
  }

  get symbolCount() {
    let n = 0;
    for (const f of this.byFile.values()) n += f.symbols.length;
    return n;
  }

  files(): string[] {
    return [...this.byFile.values()].map(f => f.file);
  }

  /** Caminho com a caixa original de um fonte indexado. */
  originalPath(file: string): string | undefined {
    return this.byFile.get(fileKey(file))?.file;
  }

  symbolsOf(file: string): AdvplSymbol[] {
    return this.byFile.get(fileKey(file))?.symbols ?? [];
  }

  /** Dados de um fonte para gravar no cache em disco. */
  entry(file: string): IndexedFile | undefined {
    const e = this.byFile.get(fileKey(file));
    return e && { file: e.file, symbols: e.symbols, words: e.words };
  }

  setFile(file: string, text: string) {
    this.setParsed({ file, symbols: parseSymbols(text, file), words: extractWords(text) });
  }

  /** Indexa um fonte já analisado (vindo do cache em disco). */
  setParsed(entry: IndexedFile) {
    this.removeFile(entry.file);
    const key = fileKey(entry.file);
    let id = this.keyToId.get(key);
    if (id === undefined) {
      id = this.idToKey.length;
      this.idToKey.push(key);
      this.keyToId.set(key, id);
    }
    this.byFile.set(key, { ...entry, id });
    for (const s of entry.symbols) {
      push(this.byName, s.name.toUpperCase(), s);
      push(this.byShort, shortKey(s.name, s.kind === 'user'), s);
    }
    for (const w of entry.words) {
      let set = this.byWord.get(w);
      if (!set) this.byWord.set(w, (set = new Set()));
      set.add(id);
    }
    this.generation++;
  }

  removeFile(file: string) {
    const entry = this.byFile.get(fileKey(file));
    if (!entry) return;
    this.byFile.delete(fileKey(file));
    for (const s of entry.symbols) {
      pull(this.byName, s.name.toUpperCase(), s);
      pull(this.byShort, shortKey(s.name, s.kind === 'user'), s);
    }
    for (const w of entry.words) {
      const set = this.byWord.get(w);
      set?.delete(entry.id);
      if (set && !set.size) this.byWord.delete(w);
    }
    this.generation++;
  }

  clear() {
    this.byFile.clear();
    this.byName.clear();
    this.byShort.clear();
    this.byWord.clear();
    this.generation++;
  }

  /** Fontes que contêm a palavra (identificador inteiro, sem diferenciar caixa). */
  filesWithWord(word: string): string[] {
    const ids = this.byWord.get(word.toUpperCase());
    if (!ids) return [];
    const out: string[] = [];
    for (const id of ids) {
      const e = this.byFile.get(this.idToKey[id]);
      if (e) out.push(e.file);
    }
    return out;
  }

  /**
   * Fontes onde vale procurar usos do símbolo. Para métodos com o mesmo nome em
   * várias classes (New, Destroy...), restringe aos fontes que citam a classe.
   */
  referenceFiles(sym: AdvplSymbol): string[] {
    if (sym.kind === 'static') return [sym.file];
    const name = sym.name.toUpperCase();
    const files = new Map<string, string>();
    const add = (list: string[]) => list.forEach(f => files.set(fileKey(f), f));
    add(this.filesWithWord(name));
    if (sym.kind === 'user') add(this.filesWithWord('U_' + name));

    if (isMethod(sym) && sym.className) {
      const owners = new Set((this.byName.get(name) ?? []).filter(isMethod).map(s => s.className?.toUpperCase()));
      if (owners.size > 1) {
        const cls = sym.className.toUpperCase();
        const allowed = new Set(this.filesWithWord(cls).map(fileKey));
        for (const s of this.byName.get(cls) ?? []) allowed.add(fileKey(s.file));
        for (const key of [...files.keys()]) if (!allowed.has(key)) files.delete(key);
      }
    }
    return [...files.values()];
  }

  /** Resolve a palavra sob o cursor para a(s) declaração(ões) mais provável(is). */
  resolve(ctx: CallContext): AdvplSymbol[] {
    let name = ctx.word;
    let user = false;
    if (/^u_./i.test(name)) {
      name = name.slice(2);
      user = true;
    }
    const exact = this.pick(this.byName.get(name.toUpperCase()) ?? [], ctx, user);
    if (exact.length) return exact;

    // Fallback para nomes truncados em 10 caracteres (fontes .prw).
    const short = [
      ...(this.byShort.get(shortKey(name, user)) ?? []),
      ...(!user ? this.byShort.get(shortKey(name, true)) ?? [] : []),
    ];
    return this.pick(short, ctx, user);
  }

  private pick(candidates: AdvplSymbol[], ctx: CallContext, user: boolean): AdvplSymbol[] {
    if (!candidates.length) return [];
    if (ctx.isMethodCall) {
      const methods = candidates.filter(isMethod);
      const impl = methods.filter(s => !s.declarationOnly);
      return impl.length ? impl : methods;
    }
    if (user) return candidates.filter(s => s.kind === 'user');

    const sameFile = fileKey(ctx.file);
    const tiers: ((s: AdvplSymbol) => boolean)[] = [
      s => s.kind === 'static' && fileKey(s.file) === sameFile,
      s => s.kind === 'function',
      s => s.kind === 'user',
      s => s.kind === 'class',
      s => isMethod(s) && !s.declarationOnly,
      isMethod,
    ];
    for (const tier of tiers) {
      const found = candidates.filter(tier);
      if (found.length) return found;
    }
    return [];
  }

  /** Busca para o Ctrl+T (Go to Symbol in Workspace). */
  search(query: string, limit = 500): AdvplSymbol[] {
    const q = query.toUpperCase().replace(/^U_/, '');
    const prefix: AdvplSymbol[] = [];
    const contains: AdvplSymbol[] = [];
    for (const [key, list] of this.byName) {
      if (q && !key.includes(q)) continue;
      const target = key.startsWith(q) ? prefix : contains;
      for (const s of list) if (!s.declarationOnly) target.push(s);
      if (prefix.length >= limit) break;
    }
    return [...prefix, ...contains].slice(0, limit);
  }
}

/** Regex que encontra usos (e a declaração) do símbolo num fonte. */
export function referencePattern(sym: AdvplSymbol): RegExp {
  const n = escapeRe(sym.name);
  switch (sym.kind) {
    case 'user':
      // U_NOME(...), ExecBlock("NOME"), ExistBlock("NOME"), declaração
      return new RegExp(`\\bU_${n}\\b|(["'])${n}\\1|\\bfunction\\s+${n}\\b`, 'gi');
    case 'method':
    case 'wsmethod':
      return new RegExp(`:${n}\\s*\\(|\\b(?:ws)?method\\s+(?:(?:get|post|put|delete|patch)\\s+)?${n}\\b`, 'gi');
    case 'class':
      return new RegExp(`(?<![\\w:])${n}\\b`, 'gi');
    default:
      return new RegExp(`(?<![\\w:.>])${n}\\s*\\(|\\bfunction\\s+${n}\\b|StaticCall\\s*\\(\\s*\\w+\\s*,\\s*${n}\\b`, 'gi');
  }
}

export function findMatches(text: string, re: RegExp, name: string): TextMatch[] {
  const out: TextMatch[] = [];
  const upperName = name.toUpperCase();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*)/.test(line)) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const offset = m[0].toUpperCase().lastIndexOf(upperName);
      out.push({ line: i, character: m.index + Math.max(0, offset), length: name.length, lineText: line });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return out;
}

/**
 * true se a linha é uma declaração com o mesmo nome (não conta como uso).
 * `declarations` são os símbolos do fonte onde a ocorrência foi achada.
 */
export function isDeclarationLine(sym: AdvplSymbol, line: number, declarations: AdvplSymbol[]): boolean {
  const name = sym.name.toUpperCase();
  return declarations.some(d => d.line === line && d.name.toUpperCase() === name && (d.kind === sym.kind || (isMethod(d) && isMethod(sym))));
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function push<K, V>(map: Map<K, V[]>, key: K, v: V) {
  const list = map.get(key);
  if (list) list.push(v);
  else map.set(key, [v]);
}

function pull<K, V>(map: Map<K, V[]>, key: K, v: V) {
  const list = map.get(key);
  if (!list) return;
  const i = list.indexOf(v);
  if (i >= 0) list.splice(i, 1);
  if (!list.length) map.delete(key);
}
