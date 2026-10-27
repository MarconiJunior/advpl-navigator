import * as vscode from 'vscode';
import { index, READ_BATCH, readSource, whenIndexed } from '../core';
import { AdvplSymbol } from '../index/parser';
import { findMatches, isDeclarationLine, referencePattern } from '../index/symbolIndex';

export interface Usage {
  uri: vscode.Uri;
  range: vscode.Range;
  lineText: string;
  /** A própria declaração (Shift+F12 inclui; painel e contador não). */
  declaration: boolean;
}

/** Procura os usos do símbolo só nos fontes que contêm o nome (índice de palavras). */
export async function searchUsages(sym: AdvplSymbol, token?: vscode.CancellationToken): Promise<Usage[]> {
  await whenIndexed();
  const re = referencePattern(sym);
  const files = index.referenceFiles(sym);
  const out: Usage[] = [];
  for (let i = 0; i < files.length && !token?.isCancellationRequested; i += READ_BATCH) {
    const batch = files.slice(i, i + READ_BATCH);
    const texts = await Promise.all(batch.map(f => readSource(vscode.Uri.file(f))));
    batch.forEach((file, j) => {
      const text = texts[j];
      if (!text) return;
      const uri = vscode.Uri.file(file);
      const declarations = index.symbolsOf(file);
      for (const m of findMatches(text, re, sym.name)) {
        out.push({
          uri,
          range: new vscode.Range(m.line, m.character, m.line, m.character + m.length),
          lineText: m.lineText,
          declaration: isDeclarationLine(sym, m.line, declarations),
        });
      }
    });
  }
  return out.sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath) || a.range.start.line - b.range.start.line);
}

const counts = new Map<string, { generation: number; count: number }>();
const symbolKey = (s: AdvplSymbol) => `${s.kind}|${s.file}|${s.line}|${s.name}`;

/** Quantidade de usos (sem a declaração), guardada até o índice mudar. */
export async function usageCount(sym: AdvplSymbol, token?: vscode.CancellationToken): Promise<number> {
  await whenIndexed();
  const key = symbolKey(sym);
  const cached = counts.get(key);
  if (cached && cached.generation === index.generation) return cached.count;
  const generation = index.generation;
  const count = (await searchUsages(sym, token)).filter(u => !u.declaration).length;
  if (!token?.isCancellationRequested) counts.set(key, { generation, count });
  return count;
}
