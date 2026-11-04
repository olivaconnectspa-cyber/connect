const fs = require('node:fs');
const path = require('node:path');

const pdfjsPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'pdfjs-dist',
  'legacy',
  'build',
  'pdf.mjs',
);

if (!fs.existsSync(pdfjsPath)) {
  console.warn('pdfjs-dist is not installed; skipping the React Native worker patch.');
  process.exit(0);
}

let source = fs.readFileSync(pdfjsPath, 'utf8');
const dynamicWorkerImport = /      const worker = await import\(\/\*webpackIgnore: true\*\/this\.workerSrc\);\r?\n      return worker\.WorkerMessageHandler;/;
const reactNativeWorkerError = '      throw new Error("A PDF.js worker handler must be registered in this runtime.");';
const loopbackNullOptions = /structuredClone\(obj, transfer \? \{\r?\n\s*transfer\r?\n\s*\} : null\)/;
const loopbackSafeOptions = 'structuredClone(obj, transfer ? { transfer } : undefined)';

let changed = false;

if (!source.includes(reactNativeWorkerError)) {
  if (!dynamicWorkerImport.test(source)) {
    throw new Error('Could not locate PDF.js dynamic worker import; review the SDK compatibility patch.');
  }
  source = source.replace(dynamicWorkerImport, reactNativeWorkerError);
  changed = true;
}

if (!source.includes(loopbackSafeOptions)) {
  if (!loopbackNullOptions.test(source)) {
    throw new Error('Could not locate PDF.js LoopbackPort structuredClone call; review the React Native compatibility patch.');
  }
  source = source.replace(loopbackNullOptions, loopbackSafeOptions);
  changed = true;
}

if (changed) {
  fs.writeFileSync(pdfjsPath, source);
  console.log('Applied the Hermes-compatible PDF.js worker patch.');
}
