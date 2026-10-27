// Teste de integração: abre um VS Code isolado (perfil e extensões temporários)
// com a extensão carregada no repositório real e chama os providers.
// Uso: node test/integration.js [caminho-do-Code.exe]   (npm run test:integration)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'advpl-nav-'));
  const userData = path.join(tmp, 'user');
  fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
  const dict = path.join(tmp, 'dict.json');
  fs.writeFileSync(dict, JSON.stringify({
    tables: [['SA1', 'Clientes']],
    fields: [
      ['SA1', 'A1_COD', 'C', 6, 0, 'Codigo', 'Codigo do Cliente', 'R', '', '', '@!'],
      ['SA1', 'A1_NOME', 'C', 40, 0, 'Nome', 'Nome do Cliente', 'R', '', '', ''],
    ],
  }));
  fs.writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({ 'advplNavigator.dictionary.path': dict }));
  fs.writeFileSync(path.join(tmp, 'Scratch.prw'), 'User Function Scratch()\nSA1->\nReturn A1_\nx := SA1->A1_COD\n');

  await runTests({
    // Sem argumento, baixa um VS Code separado em .vscode-test/ (não interfere no instalado).
    ...(process.argv[2] ? { vscodeExecutablePath: process.argv[2] } : { version: process.env.VSCODE_VERSION || '1.105.0' }),
    extensionDevelopmentPath: path.resolve(__dirname, '..'),
    extensionTestsPath: path.resolve(__dirname, 'integration-suite.js'),
    launchArgs: [
      path.resolve(__dirname, 'fixtures', 'workspace'),
      '--user-data-dir', userData,
      '--extensions-dir', path.join(tmp, 'ext'),
      '--disable-workspace-trust',
    ],
    extensionTestsEnv: { ADVPL_NAV_SCRATCH: path.join(tmp, 'Scratch.prw') },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
