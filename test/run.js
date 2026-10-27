// Testes sem VS Code: parser, índice, dicionário e exportação, sobre fontes de exemplo
// (test/fixtures/workspace). Com uma pasta de fontes AdvPL, mede também um projeto real.
// Uso: node test/run.js [pasta-dos-fontes]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { parseSymbols } = require('../out/index/parser');
const { SymbolIndex, referencePattern, findMatches, isDeclarationLine } = require('../out/index/symbolIndex');
const { Dictionary } = require('../out/dictionary/dictionary');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}

console.log('parser');
const sample = [
  '#Include "TOTVS.ch"',
  '/*/{Protheus.doc} MT100GRV',
  'Ponto de entrada na gravação da NF',
  '@type function',
  '/*/',
  'User Function MT100GRV(nOpc, ;',
  '                       lCopia)',
  '  Local cUrl := "http://x/*y" // Static Function Falsa()',
  '  /* Static Function Comentada()',
  '  */',
  'Return U_ZFUNC(1) + Calc()',
  '',
  'Static Function Calc()',
  'Return 1',
  'Class Pessoa From LongNameClass',
  '  Data nome',
  '  Method New() Constructor',
  'EndClass',
  'Method New() Class Pessoa',
  'Return Self',
  'WSMETHOD GET historico WSRECEIVE inicio WSSERVICE wsP73',
].join('\r\n');
const syms = parseSymbols(sample, 'C:/x/A.prw');
test('acha User/Static/Class/Method/WSMETHOD e ignora comentários', () => {
  assert.deepStrictEqual(syms.map(s => `${s.kind}:${s.name}`), [
    'user:MT100GRV', 'static:Calc', 'class:Pessoa', 'method:New', 'method:New', 'wsmethod:historico',
  ]);
});
test('assinatura com continuação ";"', () => assert.strictEqual(syms[0].signature, 'User Function MT100GRV(nOpc, lCopia)'));
test('Protheus.doc anexado', () => assert.match(syms[0].doc, /gravação da NF/));
test('posição do nome', () => assert.deepStrictEqual([syms[0].line, syms[0].character], [5, 14]));
test('método: declaração vs implementação', () => {
  assert.strictEqual(syms[3].declarationOnly, true);
  assert.strictEqual(syms[4].declarationOnly, false);
  assert.strictEqual(syms[4].className, 'Pessoa');
  assert.strictEqual(syms[5].className, 'wsP73');
});

console.log('índice (sintético)');
const idx = new SymbolIndex();
idx.setFile('C:/x/A.prw', sample);
idx.setFile('C:/x/B.prw', 'Static Function Calc()\nReturn 2\nUser Function ZFUNC(n)\nReturn n\nUser Function ABCDEFGH()\nReturn');
test('static resolve no mesmo fonte', () => {
  const r = idx.resolve({ word: 'Calc', file: 'c:\\x\\b.prw', isMethodCall: false });
  assert.deepStrictEqual(r.map(s => s.file), ['C:/x/B.prw']);
});
test('U_ resolve user function de outro fonte (case-insensitive)', () => {
  const r = idx.resolve({ word: 'u_zfunc', file: 'C:/x/A.prw', isMethodCall: false });
  assert.deepStrictEqual(r.map(s => `${s.kind}:${s.file}`), ['user:C:/x/B.prw']);
});
test('ExecBlock("ZFUNC") sem U_ cai na user function', () => {
  assert.strictEqual(idx.resolve({ word: 'ZFUNC', file: 'C:/x/A.prw', isMethodCall: false })[0]?.kind, 'user');
});
test('nome truncado em 10 caracteres (U_ABCDEFGHIJ -> ABCDEFGH)', () => {
  assert.strictEqual(idx.resolve({ word: 'U_ABCDEFGHIJ', file: 'C:/x/A.prw', isMethodCall: false })[0]?.name, 'ABCDEFGH');
});
test(':New resolve a implementação do método', () => {
  const r = idx.resolve({ word: 'New', file: 'C:/x/B.prw', isMethodCall: true });
  assert.deepStrictEqual(r.map(s => s.line), [18]);
});
test('referências de user function', () => {
  const sym = idx.resolve({ word: 'U_ZFUNC', file: 'C:/x/A.prw', isMethodCall: false })[0];
  const text = 'x := U_ZFUNC(1)\nExecBlock("ZFUNC",.F.,.F.)\n// U_ZFUNC()\nZFUNCX()';
  assert.deepStrictEqual(findMatches(text, referencePattern(sym), sym.name).map(m => [m.line, m.character]), [[0, 7], [1, 11]]);
});
test('remover fonte limpa o índice', () => {
  idx.removeFile('c:/X/b.PRW');
  assert.strictEqual(idx.resolve({ word: 'U_ZFUNC', file: 'C:/x/A.prw', isMethodCall: false }).length, 0);
});

console.log('parser (casos especiais)');
test('[texto] é string; aArr[1] não', () => {
  const s = parseSymbols('x := [ /* não abre comentário ]\nStatic Function Depois()\ny := aArr[1] /* fecha */\nStatic Function Ultima()', 'C:/x/S.prw');
  assert.deepStrictEqual(s.map(x => x.name), ['Depois', 'Ultima']);
});
test('assinatura mantém "http://" dentro de string e corta comentário', () => {
  const [s] = parseSymbols('User Function Url(cUrl := "http://x/y") // comentário', 'C:/x/U.prw');
  assert.strictEqual(s.signature, 'User Function Url(cUrl := "http://x/y")');
});

console.log('índice de palavras');
const widx = new SymbolIndex();
widx.setFile('C:/x/Pessoa.tlpp', 'Class Pessoa\n Method New() Constructor\nEndClass\nMethod New() Class Pessoa\nReturn Self');
widx.setFile('C:/x/Carro.tlpp', 'Class Carro\nEndClass\nMethod New() Class Carro\nReturn Self');
widx.setFile('C:/x/UsaPessoa.prw', 'User Function A()\nLocal o := Pessoa():New()\nReturn');
widx.setFile('C:/x/UsaCarro.prw', 'User Function B()\nLocal o := Carro():New()\nReturn U_A()');
const base = f => path.basename(f);
test('filesWithWord (sem diferenciar caixa)', () => assert.deepStrictEqual(widx.filesWithWord('pessoa').map(base).sort(), ['Pessoa.tlpp', 'UsaPessoa.prw']));
test('método New em 2 classes: busca só onde a classe é citada', () => {
  const sym = widx.symbolsOf('C:/x/Pessoa.tlpp').find(s => s.kind === 'method' && !s.declarationOnly);
  assert.deepStrictEqual(widx.referenceFiles(sym).map(base).sort(), ['Pessoa.tlpp', 'UsaPessoa.prw']);
});
test('user function: busca por U_NOME e NOME', () => {
  const sym = widx.resolve({ word: 'U_A', file: 'C:/x/UsaCarro.prw', isMethodCall: false })[0];
  assert.deepStrictEqual(widx.referenceFiles(sym).map(base).sort(), ['UsaCarro.prw', 'UsaPessoa.prw']);
});
test('declaração não conta como uso', () => {
  const sym = widx.symbolsOf('C:/x/Pessoa.tlpp').find(s => s.kind === 'method' && !s.declarationOnly);
  const decls = widx.symbolsOf('C:/x/Pessoa.tlpp');
  assert.ok(isDeclarationLine(sym, 1, decls) && isDeclarationLine(sym, 3, decls) && !isDeclarationLine(sym, 4, decls));
});
test('setParsed (cache) reproduz o mesmo índice; remover limpa as palavras', () => {
  const copy = new SymbolIndex();
  for (const f of widx.files()) copy.setParsed(JSON.parse(JSON.stringify(widx.entry(f))));
  assert.deepStrictEqual(copy.filesWithWord('CARRO').map(base).sort(), ['Carro.tlpp', 'UsaCarro.prw']);
  copy.removeFile('c:/x/usacarro.PRW');
  assert.deepStrictEqual(copy.filesWithWord('CARRO').map(base), ['Carro.tlpp']);
  const g = copy.generation;
  copy.setFile('C:/x/Novo.prw', 'Static Function X()');
  assert.ok(copy.generation > g);
});

console.log('dicionário');
const dict = Dictionary.fromJson(JSON.stringify({
  tables: [['SA1', 'Clientes'], ['ZZ1', 'Custom']],
  fields: [
    ['SA1', 'A1_COD', 'C', 6, 0, 'Codigo', 'Codigo do Cliente', 'R', '', '', '@!'],
    ['SA1', 'A1_NOME', 'C', 40, 0, 'Nome', 'Nome do Cliente', 'R', '', '', ''],
    ['SA1', 'A1_TIPO', 'C', 1, 0, 'Tipo', 'Tipo', 'R', 'F=Cons.Final;R=Revendedor', '', ''],
    ['ZZ1', 'ZZ1_VALOR', 'N', 14, 2, 'Valor', 'Valor', 'V', '', '', ''],
  ],
}));
test('prefixo A1_N -> SA1', () => assert.deepStrictEqual(dict.fieldsStartingWith('a1_n').map(f => f.name), ['A1_NOME']));
test('prefixo de tabela custom ZZ1_', () => assert.deepStrictEqual(dict.fieldsStartingWith('ZZ1_').map(f => f.name), ['ZZ1_VALOR']));
test('tipo N com decimais', () => assert.strictEqual(Dictionary.typeLabel(dict.field('zz1_valor')), 'N(14,2)'));
test('markdown com combo', () => assert.match(Dictionary.markdown(dict.field('A1_TIPO'), 'Clientes'), /`F=Cons.Final`/));

console.log('exportação do dicionário (sem banco)');
const { buildDictionaryJson } = require('../out/dictionary/export/dictionaryJson');
const { tablesQuery, fieldsQuery } = require('../out/dictionary/export/sqlQueries');
const { parseServerAddress, buildConnectionConfig, explainConnectionError } = require('../out/dictionary/export/sqlServer');
test('JSON exportado é lido pelo Dictionary (espaços do Protheus, números e NULL)', () => {
  const json = buildDictionaryJson(
    { server: 'srv', database: 'P12', suffix: '010', generatedAt: '2026-10-27T08:00:00' },
    [['SA1', 'Clientes                      ']],
    [['SA1', 'A1_COD    ', 'C', 6, 0, 'Codigo      ', 'Código do Cliente', 'R', null, '', '@!'], ['SA1', 'A1_LC', 'N', '14', 2.0, 'Limite', undefined, 'R', '', '', '']],
  );
  const d = Dictionary.fromJson(json);
  assert.strictEqual(d.tableName('SA1'), 'Clientes');
  assert.strictEqual(d.field('A1_COD').title, 'Codigo');
  assert.strictEqual(d.field('A1_COD').description, 'Código do Cliente');
  assert.strictEqual(Dictionary.typeLabel(d.field('A1_LC')), 'N(14,2)');
  assert.strictEqual(JSON.parse(json).meta.suffix, '010');
});
test('consultas usam o sufixo da empresa e recusam sufixo inválido', () => {
  assert.match(tablesQuery('040'), /FROM SX2040 /);
  assert.match(fieldsQuery('040'), /FROM SX3040\n/);
  assert.throws(() => fieldsQuery("010; DROP TABLE X--"), /Sufixo de empresa inválido/);
});
test('endereço do servidor: instância, porta e tcp:', () => {
  assert.deepStrictEqual(parseServerAddress('SRVSQL\\PROTHEUS'), { host: 'SRVSQL', instanceName: 'PROTHEUS' });
  assert.deepStrictEqual(parseServerAddress('10.0.0.5,1433'), { host: '10.0.0.5', port: 1433 });
  assert.deepStrictEqual(parseServerAddress('tcp:srv.local, 14330'), { host: 'srv.local', port: 14330 });
  assert.deepStrictEqual(parseServerAddress(' 192.168.0.10 '), { host: '192.168.0.10' });
});
test('login do SQL vs DOMINIO\\usuario (NTLM); instância não manda porta', () => {
  const base = { database: 'P12', encrypt: true, trustServerCertificate: false };
  const sql = buildConnectionConfig({ ...base, server: '10.0.0.5', login: { user: 'protheus', password: 'x' } });
  assert.strictEqual(sql.authentication.type, 'default');
  assert.strictEqual(sql.options.port, 1433);
  const ntlm = buildConnectionConfig({ ...base, server: 'SRV\\INST', login: { user: 'EMPRESA\\joao', password: 'x' } });
  assert.deepStrictEqual(ntlm.authentication, { type: 'ntlm', options: { domain: 'EMPRESA', userName: 'joao', password: 'x' } });
  assert.strictEqual(ntlm.options.instanceName, 'INST');
  assert.strictEqual(ntlm.options.port, undefined);
});
test('erros de conexão vêm com a dica certa', () => {
  assert.match(explainConnectionError(new Error('self-signed certificate')), /trustServerCertificate/);
  assert.match(explainConnectionError(new Error("Login failed for user 'x'")), /DOMINIO\\usuario/);
  assert.match(explainConnectionError(new Error('getaddrinfo ENOTFOUND srv')), /endereço do servidor/);
});

/** Indexa todos os fontes AdvPL de uma pasta. */
function indexDir(dir) {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(prw|prx|tlpp|aph)$/i.test(e.name)) files.push(p);
    }
  })(dir);
  const idx = new SymbolIndex();
  const t0 = Date.now();
  for (const f of files) idx.setFile(f, fs.readFileSync(f).toString('latin1'));
  return { files, idx, ms: Date.now() - t0 };
}

/** Conta os usos de um símbolo lendo os fontes informados. */
function countUsages(sym, files) {
  const re = referencePattern(sym);
  const t = Date.now();
  let n = 0;
  for (const f of files) n += findMatches(fs.readFileSync(f).toString('latin1'), re, sym.name).length;
  return { n, ms: Date.now() - t, files: files.length };
}

console.log('fontes de exemplo (test/fixtures/workspace)');
const fx = indexDir(path.join(__dirname, 'fixtures', 'workspace'));
const anyFile = fx.files[0];
test('classe TLPP VagaModel indexada', () => assert.ok(fx.idx.search('VagaModel').some(s => s.kind === 'class')));
test(':fromJson resolve o método da classe', () => {
  const r = fx.idx.resolve({ word: 'fromJson', file: anyFile, isMethodCall: true });
  assert.deepStrictEqual(r.map(s => s.className), ['VagaModel']);
});
test('índice de palavras acha os mesmos usos de U_ZVALLIN que varrer tudo', () => {
  const sym = fx.idx.resolve({ word: 'U_ZVALLIN', file: anyFile, isMethodCall: false })[0];
  const all = countUsages(sym, fx.files);
  const indexed = countUsages(sym, fx.idx.referenceFiles(sym));
  assert.strictEqual(indexed.n, all.n);
  assert.ok(indexed.files < all.files, `${indexed.files} de ${all.files} fontes`);
});
test('New de VagaModel não procura nos fontes de outras classes', () => {
  const sym = fx.idx.resolve({ word: 'New', file: anyFile, isMethodCall: true }).find(s => s.className === 'VagaModel');
  assert.deepStrictEqual(fx.idx.referenceFiles(sym).map(f => path.basename(f)).sort(), ['VagaModel.tlpp', 'VagaRest.tlpp']);
});

// Projeto real (opcional): node test/run.js <pasta-dos-fontes>
if (process.argv[2]) {
  const repo = path.resolve(process.argv[2]);
  console.log(`projeto real: ${repo}`);
  const real = indexDir(repo);
  const kinds = {};
  for (const f of real.idx.files()) for (const s of real.idx.symbolsOf(f)) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
  console.log(`  ${real.files.length} fontes, ${real.idx.symbolCount} símbolos em ${real.ms} ms`, kinds);
  test('indexa em menos de 5s', () => assert.ok(real.ms < 5000));

  // Chamadas U_XXX( cuja User Function está no projeto devem resolver.
  let calls = 0;
  let resolved = 0;
  const callCount = new Map();
  for (const f of real.files) {
    for (const m of fs.readFileSync(f).toString('latin1').matchAll(/\bU_([A-Za-z0-9_]+)\s*\(/gi)) {
      calls++;
      const name = m[1].toUpperCase();
      if (real.idx.resolve({ word: 'U_' + name, file: f, isMethodCall: false }).length) {
        resolved++;
        callCount.set(name, (callCount.get(name) || 0) + 1);
      }
    }
  }
  console.log(`  chamadas U_xxx(: ${calls}, resolvidas: ${resolved} (${calls ? ((resolved / calls) * 100).toFixed(1) : 0}%)`);

  // A User Function mais chamada: índice de palavras vs. varrer todos os fontes.
  const [top] = [...callCount].sort((a, b) => b[1] - a[1]);
  if (top) {
    const sym = real.idx.resolve({ word: 'U_' + top[0], file: real.files[0], isMethodCall: false })[0];
    const all = countUsages(sym, real.files);
    const indexed = countUsages(sym, real.idx.referenceFiles(sym));
    console.log(`  usos da função mais chamada: varrendo tudo ${all.n} em ${all.ms}ms · índice ${indexed.n} em ${indexed.ms}ms (${indexed.files} fontes)`);
    test('índice de palavras acha os mesmos usos no projeto real', () => assert.strictEqual(indexed.n, all.n));
  }
}

console.log(failures ? `\n${failures} falha(s)` : '\ntudo ok');
process.exit(failures ? 1 : 0);
