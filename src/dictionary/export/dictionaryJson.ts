/** Valor de uma coluna como vem do driver SQL. */
export type SqlValue = string | number | boolean | Date | null | undefined;

export interface ExportMeta {
  server: string;
  database: string;
  suffix: string;
  generatedAt: string;
}

/**
 * Monta o JSON do dicionário no mesmo formato de scripts/export-dict.ps1
 * (lido por Dictionary.fromJson): textos sem os espaços de preenchimento do
 * Protheus e tamanho/decimais como números.
 *
 * @param tables linhas de SX2: X2_CHAVE, X2_NOME
 * @param fields linhas de SX3: X3_ARQUIVO, X3_CAMPO, X3_TIPO, X3_TAMANHO, X3_DECIMAL,
 *               X3_TITULO, X3_DESCRIC, X3_CONTEXT, X3_CBOX, X3_F3, X3_PICTURE
 */
export function buildDictionaryJson(meta: ExportMeta, tables: SqlValue[][], fields: SqlValue[][]): string {
  return JSON.stringify({
    meta,
    tables: tables.map(r => [text(r[0]), text(r[1])]),
    fields: fields.map(r => [
      text(r[0]), text(r[1]), text(r[2]), int(r[3]), int(r[4]),
      text(r[5]), text(r[6]), text(r[7]), text(r[8]), text(r[9]), text(r[10]),
    ]),
  });
}

function text(v: SqlValue): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

function int(v: SqlValue): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
