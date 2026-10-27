export interface DictField {
  table: string;
  name: string;
  type: string;
  size: number;
  decimals: number;
  title: string;
  description: string;
  /** R = real, V = virtual */
  context: string;
  combo: string;
  f3: string;
  picture: string;
}

/**
 * Formato gerado por scripts/export-dict.ps1:
 * { meta: {...}, tables: [[alias, nome]], fields: [[tabela, campo, tipo, tam, dec, titulo, descric, context, cbox, f3, picture]] }
 */
interface DictJson {
  meta?: Record<string, unknown>;
  tables: [string, string][];
  fields: [string, string, string, number, number, string, string, string, string, string, string][];
}

export class Dictionary {
  readonly tables = new Map<string, string>();
  readonly fieldsByTable = new Map<string, DictField[]>();
  readonly fieldsByName = new Map<string, DictField>();
  /** "A1" -> "SA1", "ZZ1" -> "ZZ1" */
  readonly tableByPrefix = new Map<string, string>();
  meta: Record<string, unknown> = {};

  static fromJson(text: string): Dictionary {
    const json = JSON.parse(text.replace(/^\uFEFF/, '')) as DictJson;
    const d = new Dictionary();
    d.meta = json.meta ?? {};
    for (const [alias, name] of json.tables ?? []) d.tables.set(alias.trim().toUpperCase(), name.trim());
    for (const r of json.fields ?? []) {
      const f: DictField = {
        table: r[0].trim().toUpperCase(),
        name: r[1].trim().toUpperCase(),
        type: (r[2] ?? '').trim(),
        size: Number(r[3]) || 0,
        decimals: Number(r[4]) || 0,
        title: (r[5] ?? '').trim(),
        description: (r[6] ?? '').trim(),
        context: (r[7] ?? '').trim(),
        combo: (r[8] ?? '').trim(),
        f3: (r[9] ?? '').trim(),
        picture: (r[10] ?? '').trim(),
      };
      const list = d.fieldsByTable.get(f.table);
      if (list) list.push(f);
      else d.fieldsByTable.set(f.table, [f]);
      d.fieldsByName.set(f.name, f);
      const prefix = f.name.split('_')[0];
      if (prefix && !d.tableByPrefix.has(prefix)) d.tableByPrefix.set(prefix, f.table);
    }
    return d;
  }

  get fieldCount() {
    return this.fieldsByName.size;
  }

  field(name: string): DictField | undefined {
    return this.fieldsByName.get(name.toUpperCase());
  }

  tableName(alias: string): string | undefined {
    return this.tables.get(alias.toUpperCase());
  }

  /** Campos cujo nome começa com o texto digitado, ex.: "A1_N" -> A1_NOME, A1_NREDUZ... */
  fieldsStartingWith(typed: string): DictField[] {
    const upper = typed.toUpperCase();
    const table = this.tableByPrefix.get(upper.split('_')[0]);
    if (!table) return [];
    return (this.fieldsByTable.get(table) ?? []).filter(f => f.name.startsWith(upper));
  }

  fieldsOf(alias: string): DictField[] {
    return this.fieldsByTable.get(alias.toUpperCase()) ?? [];
  }

  static typeLabel(f: DictField): string {
    if (f.type === 'N') return f.decimals ? `N(${f.size},${f.decimals})` : `N(${f.size})`;
    if (f.type === 'D' || f.type === 'L' || f.type === 'M') return f.type;
    return `${f.type}(${f.size})`;
  }

  static markdown(f: DictField, tableName?: string): string {
    const parts = [
      `**${f.name}** — ${f.title} \`${Dictionary.typeLabel(f)}\``,
      f.description && f.description !== f.title ? f.description : '',
      `Tabela: \`${f.table}\`${tableName ? ` ${tableName}` : ''}${f.context === 'V' ? ' · **virtual**' : ''}`,
      f.combo ? `Opções: ${f.combo.split(';').map(o => `\`${o}\``).join(' ')}` : '',
      f.f3 ? `Consulta F3: \`${f.f3}\`` : '',
      f.picture ? `Picture: \`${f.picture}\`` : '',
    ];
    return parts.filter(Boolean).join('\n\n');
  }
}
