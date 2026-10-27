import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { config } from '../../core';
import { dictionaryPath } from '../settings';
import { buildDictionaryJson } from './dictionaryJson';
import { assertCompanySuffix, fieldsQuery, tablesQuery } from './sqlQueries';
import { explainConnectionError, openSqlSession, SqlLogin } from './sqlServer';

interface ExportTarget {
  server: string;
  database: string;
  suffix: string;
  output: string;
}

/**
 * Comando "Exportar dicionário". Com autenticação do Windows da sessão atual
 * usa o script PowerShell (só no Windows); nos demais casos conecta direto
 * pelo driver tedious, em qualquer sistema.
 */
export async function exportDictionary(context: vscode.ExtensionContext) {
  const target = await askTarget();
  if (!target) return;

  if (config().get<boolean>('dictionary.integratedSecurity')) {
    if (process.platform !== 'win32') {
      vscode.window.showErrorMessage(
        'A autenticação do Windows da sessão atual só funciona no Windows. Desative advplNavigator.dictionary.integratedSecurity ' +
          'e informe um usuário do SQL ou DOMINIO\\usuario.',
      );
      return;
    }
    runPowerShellExport(context, target);
    return;
  }

  const login = await askLogin();
  if (login) await exportWithDriver(target, login);
}

async function askTarget(): Promise<ExportTarget | undefined> {
  const server = await askSetting('dictionary.server', 'Servidor SQL Server do Protheus', 'SRVSQL\\PROTHEUS ou 10.0.0.5,1433');
  if (!server) return undefined;
  const database = await askSetting('dictionary.database', 'Banco de dados do Protheus', 'PROTHEUS12');
  if (!database) return undefined;
  const suffix = assertCompanySuffix(config().get<string>('dictionary.companySuffix') || '010');
  return { server, database, suffix, output: dictionaryPath() };
}

/** Usa o valor salvo nas configurações ou pergunta e salva no workspace. */
async function askSetting(key: string, prompt: string, placeHolder: string): Promise<string | undefined> {
  const saved = config().get<string>(key);
  if (saved) return saved;
  const value = await vscode.window.showInputBox({ prompt, placeHolder, ignoreFocusOut: true });
  if (value) await config().update(key, value, vscode.ConfigurationTarget.Workspace);
  return value || undefined;
}

/** Usuário fica salvo para a próxima vez; a senha nunca é gravada. */
async function askLogin(): Promise<SqlLogin | undefined> {
  const user = await vscode.window.showInputBox({
    prompt: 'Usuário do SQL Server (ou DOMINIO\\usuario para login do Windows)',
    value: config().get<string>('dictionary.user') ?? '',
    ignoreFocusOut: true,
  });
  if (!user) return undefined;
  await config().update('dictionary.user', user, vscode.ConfigurationTarget.Workspace);
  const password = await vscode.window.showInputBox({ prompt: `Senha de ${user}`, password: true, ignoreFocusOut: true });
  return password === undefined ? undefined : { user, password };
}

async function exportWithDriver(target: ExportTarget, login: SqlLogin) {
  try {
    const counts = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Exportando dicionário' },
      async progress => {
        progress.report({ message: `conectando em ${target.server}...` });
        const session = await openSqlSession({
          server: target.server,
          database: target.database,
          login,
          encrypt: config().get<boolean>('dictionary.encrypt') ?? true,
          trustServerCertificate: config().get<boolean>('dictionary.trustServerCertificate') ?? false,
        });
        try {
          progress.report({ message: `lendo SX2${target.suffix}...` });
          const tables = await session.query(tablesQuery(target.suffix));
          progress.report({ message: `lendo SX3${target.suffix}...` });
          const fields = await session.query(fieldsQuery(target.suffix));
          const json = buildDictionaryJson(
            { server: target.server, database: target.database, suffix: target.suffix, generatedAt: new Date().toISOString().slice(0, 19) },
            tables,
            fields,
          );
          await fs.mkdir(path.dirname(target.output), { recursive: true });
          await fs.writeFile(target.output, json, 'utf8');
          return { tables: tables.length, fields: fields.length };
        } finally {
          session.close();
        }
      },
    );
    vscode.window.showInformationMessage(`Dicionário exportado: ${counts.tables} tabelas, ${counts.fields} campos.`);
  } catch (err) {
    vscode.window.showErrorMessage(`Falha ao exportar o dicionário: ${explainConnectionError(err)}`);
  }
}

/** Autenticação do Windows da sessão atual: só o cliente SQL do .NET faz isso, via PowerShell. */
function runPowerShellExport(context: vscode.ExtensionContext, target: ExportTarget) {
  const script = context.asAbsolutePath(path.join('scripts', 'export-dict.ps1'));
  const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const args = ['-Server', target.server, '-Database', target.database, '-Suffix', target.suffix, '-Output', target.output];
  const terminal = vscode.window.createTerminal({
    name: 'AdvPL: exportar dicionário',
    shellPath: 'powershell.exe',
    shellArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass'],
  });
  terminal.show();
  terminal.sendText(`& ${quote(script)} ${args.map((a, i) => (i % 2 ? quote(a) : a)).join(' ')} -IntegratedSecurity`);
}
