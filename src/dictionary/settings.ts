import * as vscode from 'vscode';
import { config } from '../core';

/** Caminho do JSON do dicionário, com ${workspaceFolder} resolvido. */
export function dictionaryPath(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  return config().get<string>('dictionary.path')!.replace(/\$\{workspaceFolder\}/g, folder);
}
