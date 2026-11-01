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

const source = fs.readFileSync(pdfjsPath, 'utf8');
const dynamicWorkerImport = /      const worker = await import\(\/\*webpackIgnore: true\*\/this\.workerSrc\);\r?\n      return worker\.WorkerMessageHandler;/;
const reactNativeWorkerError = '      throw new Error("A PDF.js worker handler must be registered in this runtime.");';

if (source.includes(reactNativeWorkerError)) process.exit(0);

if (!dynamicWorkerImport.test(source)) {
  throw new Error('Could not locate PDF.js dynamic worker import; review the SDK compatibility patch.');
}

fs.writeFileSync(pdfjsPath, source.replace(dynamicWorkerImport, reactNativeWorkerError));
console.log('Applied the Hermes-compatible PDF.js worker patch.');
