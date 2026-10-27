import * as vscode from 'vscode';
import { indexChanged } from './core';
import { registerDictionary } from './dictionary/dictionaryFeatures';
import { cachePath, lastStats, reindex, startIndexer, stopIndexer } from './index/indexer';
import { registerNavigation } from './navigation/navigation';
import { registerUsagesView, usagesTree } from './navigation/usagesView';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(indexChanged);
  startIndexer(context);
  registerUsagesView(context);
  registerDictionary(context);
  const { navigationTarget } = registerNavigation(context);

  // Usado pelos testes de integração.
  return {
    navigationTarget,
    usagesTree,
    reindex,
    cachePath,
    lastStats: () => lastStats,
  };
}

export function deactivate() {
  return stopIndexer();
}
