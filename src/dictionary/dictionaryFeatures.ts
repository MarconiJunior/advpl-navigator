import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { SELECTOR, WORD } from '../core';
import { setDictionaryStatus } from '../index/indexer';
import { DictField, Dictionary } from './dictionary';
import { exportDictionary } from './export/exportDictionary';
import { dictionaryPath } from './settings';

let dictionary: Dictionary | undefined;
let dictWatcher: vscode.FileSystemWatcher | undefined;

// ---------------------------------------------------------------- hover de campos e tabelas

function provideHover(doc: vscode.TextDocument, pos: vscode.Position) {
  if (!dictionary) return undefined;
  const range = doc.getWordRangeAtPosition(pos, WORD);
  if (!range) return undefined;
  const word = doc.getText(range).toUpperCase();
  const line = doc.lineAt(pos.line).text;

  const field = dictionary.field(word);
  if (field) return new vscode.Hover(new vscode.MarkdownString(Dictionary.markdown(field, dictionary.tableName(field.table))), range);

  const tableName = dictionary.tableName(word);
  const after = line.slice(range.end.character);
  const before = line.slice(0, range.start.character);
  if (tableName && (/^\s*->/.test(after) || /["']$/.test(before) || /%table:$/i.test(before))) {
    const n = dictionary.fieldsOf(word).length;
    return new vscode.Hover(new vscode.MarkdownString(`**${word}** — ${tableName}\n\n${n} campos no SX3`), range);
  }
  return undefined;
}

// ---------------------------------------------------------------- completion

function provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position) {
  if (!dictionary) return undefined;
  const before = doc.lineAt(pos.line).text.slice(0, pos.character);

  // RetSqlName("SA | %table:SA | DbSelectArea("SA | ChkFile("SA  -> tabelas
  let m = /(?:RetSqlName|DbSelectArea|ChkFile|FWxFilial|xFilial)\s*\(\s*["']([A-Za-z0-9]*)$|%table:([A-Za-z0-9]*)$/i.exec(before);
  if (m) {
    const typed = m[1] ?? m[2] ?? '';
    const range = new vscode.Range(pos.translate(0, -typed.length), pos);
    return [...dictionary.tables].map(([alias, name]) => {
      const item = new vscode.CompletionItem({ label: alias, description: name }, vscode.CompletionItemKind.Struct);
      item.range = range;
      item.filterText = `${alias} ${name}`;
      return item;
    });
  }

  // SA1->  | SA1->A1_N  -> campos da tabela
  m = /\b([A-Za-z][A-Za-z0-9]{2})->([A-Za-z0-9_]*)$/.exec(before);
  if (m && dictionary.tableName(m[1])) return fieldItems(dictionary.fieldsOf(m[1]), pos, m[2].length);

  // A1_N | ZZ1_C  -> campos pelo prefixo (vale em código, SQL e strings)
  m = /(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9]{1,2}_[A-Za-z0-9_]*)$/.exec(before);
  if (m) {
    const fields = dictionary.fieldsStartingWith(m[1]);
    if (fields.length) return fieldItems(fields, pos, m[1].length);
  }
  return undefined;
}

function fieldItems(fields: DictField[], pos: vscode.Position, typedLength: number) {
  const range = new vscode.Range(pos.translate(0, -typedLength), pos);
  const items = fields.map((f, i) => {
    const item = new vscode.CompletionItem(
      { label: f.name, detail: ` ${Dictionary.typeLabel(f)}`, description: f.title },
      f.context === 'V' ? vscode.CompletionItemKind.Property : vscode.CompletionItemKind.Field,
    );
    item.range = range;
    item.sortText = String(i).padStart(5, '0');
    item.filterText = `${f.name} ${f.title}`;
    item.documentation = new vscode.MarkdownString(Dictionary.markdown(f, dictionary?.tableName(f.table)));
    return item;
  });
  return new vscode.CompletionList(items, false);
}

// ---------------------------------------------------------------- arquivo do dicionário

function watchDictionary() {
  dictWatcher?.dispose();
  const file = dictionaryPath();
  dictWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)));
  const reload = () => loadDictionary(false);
  dictWatcher.onDidCreate(reload);
  dictWatcher.onDidChange(reload);
  dictWatcher.onDidDelete(() => {
    dictionary = undefined;
    setDictionaryStatus(undefined);
  });
  loadDictionary(false);
}

async function loadDictionary(verbose: boolean) {
  const file = dictionaryPath();
  try {
    dictionary = Dictionary.fromJson(await fs.readFile(file, 'utf8'));
    if (verbose) vscode.window.showInformationMessage(`Dicionário carregado: ${dictionary.tables.size} tabelas, ${dictionary.fieldCount} campos.`);
  } catch (e) {
    dictionary = undefined;
    if (verbose) vscode.window.showWarningMessage(`Não foi possível ler o dicionário em ${file}: ${(e as Error).message}`);
  }
  setDictionaryStatus(dictionary?.fieldCount);
}

export function registerDictionary(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    { dispose: () => dictWatcher?.dispose() },
    vscode.languages.registerHoverProvider(SELECTOR, { provideHover }),
    vscode.languages.registerCompletionItemProvider(SELECTOR, { provideCompletionItems }, '_', '>', '"', "'", ':'),
    vscode.commands.registerCommand('advplNavigator.reloadDictionary', () => loadDictionary(true)),
    vscode.commands.registerCommand('advplNavigator.exportDictionary', () => exportDictionary(context)),
    vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('advplNavigator.dictionary.path') && watchDictionary()),
  );
  watchDictionary();
}
