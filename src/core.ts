import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { AdvplSymbol } from './index/parser';
import { SymbolIndex } from './index/symbolIndex';

export const SELECTOR: vscode.DocumentSelector = [
  { language: 'advpl' },
  { language: 'advpl-asp' },
  { scheme: 'file', pattern: '**/*.{prw,PRW,Prw,prx,PRX,Prx,tlpp,TLPP,Tlpp,aph,APH}' },
];
export const WORD = /[A-Za-z_][A-Za-z0-9_]*/;
export const READ_BATCH = 64;

export const index = new SymbolIndex();
export const config = () => vscode.workspace.getConfiguration('advplNavigator');

/** Disparado quando o índice muda (fonte salvo, criado, removido, reindexação). */
export const indexChanged = new vscode.EventEmitter<void>();

let indexing: Promise<void> = Promise.resolve();
/** Resolve quando a indexação em andamento termina (na hora, se não houver nenhuma). */
export const whenIndexed = () => indexing;
export const setIndexing = (p: Promise<void>) => (indexing = p);

/** Chave de caminho para comparar arquivos no Windows (sem diferenciar caixa nem barra). */
export const pathKey = (fsPath: string) => fsPath.replace(/\//g, '\\').toLowerCase();

/** Fontes Protheus são cp1252; latin1 preserva as colunas (1 byte = 1 caractere). */
export async function readSource(uri: vscode.Uri): Promise<string | undefined> {
  const key = pathKey(uri.fsPath);
  const open = vscode.workspace.textDocuments.find(d => pathKey(d.uri.fsPath) === key);
  if (open) return open.getText();
  try {
    return (await fs.readFile(uri.fsPath)).toString('latin1');
  } catch {
    return undefined;
  }
}

const docVersions = new Map<string, number>();

/** Reindexa o documento aberto se ele mudou desde a última vez (edições não salvas). */
export function syncDocument(doc: vscode.TextDocument) {
  const key = pathKey(doc.uri.fsPath);
  if (docVersions.get(key) === doc.version) return;
  docVersions.set(key, doc.version);
  index.setFile(doc.uri.fsPath, doc.getText());
  indexChanged.fire();
}

export const forgetDocumentVersions = () => docVersions.clear();

export function toLocation(s: AdvplSymbol) {
  return new vscode.Location(vscode.Uri.file(s.file), new vscode.Position(s.line, s.character));
}

/**
 * Símbolo(s) sob o cursor. Na linha da própria declaração devolve ela mesma
 * (evita pegar o New de outra classe quando o cursor está em "Method New() Class X").
 */
export function symbolAt(doc: vscode.TextDocument, pos: vscode.Position): AdvplSymbol[] {
  syncDocument(doc);
  const range = doc.getWordRangeAtPosition(pos, WORD);
  if (!range) return [];
  const word = doc.getText(range);
  const bare = word.replace(/^U_(?=.)/i, '').toUpperCase();
  const own = index.symbolsOf(doc.uri.fsPath).filter(s => s.line === pos.line && s.name.toUpperCase() === bare);
  if (own.length) return own;
  const before = range.start.character > 0 ? doc.lineAt(pos.line).text[range.start.character - 1] : '';
  return index.resolve({ word, file: doc.uri.fsPath, isMethodCall: before === ':' });
}

export const isOnDeclaration = (doc: vscode.TextDocument, pos: vscode.Position, found: AdvplSymbol[]) =>
  found.some(s => pathKey(s.file) === pathKey(doc.uri.fsPath) && s.line === pos.line);
