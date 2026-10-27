// Consultas ao dicionário do Protheus. Mantidas em sincronia com scripts/export-dict.ps1.

/** Sufixo da empresa nas tabelas do dicionário: SX3010 -> "010". */
const COMPANY_SUFFIX = /^[A-Za-z0-9]{3}$/;

/** O sufixo entra no nome da tabela, então só aceita 3 letras/dígitos. */
export function assertCompanySuffix(suffix: string): string {
  if (!COMPANY_SUFFIX.test(suffix)) throw new Error(`Sufixo de empresa inválido: "${suffix}" (use 3 caracteres, ex.: 010).`);
  return suffix;
}

export function tablesQuery(suffix: string): string {
  return `SELECT X2_CHAVE, X2_NOME FROM SX2${assertCompanySuffix(suffix)} WHERE D_E_L_E_T_ = ' ' ORDER BY X2_CHAVE`;
}

export function fieldsQuery(suffix: string): string {
  return [
    'SELECT X3_ARQUIVO, X3_CAMPO, X3_TIPO, X3_TAMANHO, X3_DECIMAL, X3_TITULO, X3_DESCRIC,',
    '       X3_CONTEXT, X3_CBOX, X3_F3, X3_PICTURE',
    `  FROM SX3${assertCompanySuffix(suffix)}`,
    " WHERE D_E_L_E_T_ = ' '",
    ' ORDER BY X3_ARQUIVO, X3_ORDEM',
  ].join('\n');
}
