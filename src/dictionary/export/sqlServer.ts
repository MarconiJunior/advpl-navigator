import { Connection, ConnectionConfiguration, Request } from 'tedious';
import { SqlValue } from './dictionaryJson';

/** Endereço do SQL Server como o usuário digita: "srv", "srv\INSTANCIA", "srv,1433", "tcp:srv,1433". */
export interface SqlServerAddress {
  host: string;
  instanceName?: string;
  port?: number;
}

export interface SqlLogin {
  /** "usuario" (login do SQL) ou "DOMINIO\usuario" (login do Windows via NTLM). */
  user: string;
  password: string;
}

export interface SqlConnectionOptions {
  server: string;
  database: string;
  login: SqlLogin;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

/** Conexão aberta: executa consultas e devolve as linhas como arrays de valores. */
export interface SqlSession {
  query(sql: string): Promise<SqlValue[][]>;
  close(): void;
}

export function parseServerAddress(server: string): SqlServerAddress {
  const value = server.trim().replace(/^tcp:/i, '');
  const comma = /^(.+?),\s*(\d+)$/.exec(value);
  if (comma) return { host: comma[1], port: Number(comma[2]) };
  const instance = /^(.+?)\\(.+)$/.exec(value);
  if (instance) return { host: instance[1], instanceName: instance[2] };
  if (!value) throw new Error('Servidor SQL não informado.');
  return { host: value };
}

/** Configuração do tedious. Pura, para poder ser testada sem banco. */
export function buildConnectionConfig(options: SqlConnectionOptions): ConnectionConfiguration {
  const address = parseServerAddress(options.server);
  const domainUser = /^([^\\]+)\\(.+)$/.exec(options.login.user);
  return {
    server: address.host,
    authentication: domainUser
      ? { type: 'ntlm', options: { domain: domainUser[1], userName: domainUser[2], password: options.login.password } }
      : { type: 'default', options: { userName: options.login.user, password: options.login.password } },
    options: {
      database: options.database,
      // Com instância nomeada a porta vem do SQL Browser; informar as duas é erro no tedious.
      ...(address.instanceName ? { instanceName: address.instanceName } : { port: address.port ?? 1433 }),
      encrypt: options.encrypt,
      trustServerCertificate: options.trustServerCertificate,
      appName: 'AdvPL Navigator',
      connectTimeout: 30_000,
      requestTimeout: 300_000,
    },
  };
}

export function openSqlSession(options: SqlConnectionOptions): Promise<SqlSession> {
  const connection = new Connection(buildConnectionConfig(options));
  return new Promise((resolve, reject) => {
    connection.connect(err => {
      if (err) {
        connection.close();
        reject(err);
        return;
      }
      resolve({
        query: sql => runQuery(connection, sql),
        close: () => connection.close(),
      });
    });
  });
}

function runQuery(connection: Connection, sql: string): Promise<SqlValue[][]> {
  return new Promise((resolve, reject) => {
    const rows: SqlValue[][] = [];
    const request = new Request(sql, err => (err ? reject(err) : resolve(rows)));
    request.on('row', (columns: { value: SqlValue }[]) => rows.push(columns.map(c => c.value)));
    connection.execSql(request);
  });
}

/** Mensagem de erro com a dica certa para os problemas de conexão mais comuns. */
export function explainConnectionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/certificate|self[- ]signed|SSL|TLS/i.test(message)) {
    return `${message}. O certificado do servidor não é confiável: se for um servidor interno, ative advplNavigator.dictionary.trustServerCertificate.`;
  }
  if (/Login failed/i.test(message)) return `${message}. Confira usuário e senha (para login do Windows use DOMINIO\\usuario).`;
  if (/ENOTFOUND|ECONNREFUSED|ETIMEOUT|Failed to connect|getaddrinfo/i.test(message)) {
    return `${message}. Confira o endereço do servidor (ex.: SRVSQL\\INSTANCIA ou 10.0.0.5,1433) e se a porta está liberada.`;
  }
  return message;
}
