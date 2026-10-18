import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envText = await readFile(resolve(root, '.env'), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : [];
}));

const config = {
  apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
if (missing.length) throw new Error(`Faltan valores Firebase en .env: ${missing.join(', ')}`);
if (config.projectId !== 'oliva-connect-cybmzx') throw new Error('EXPO_PUBLIC_FIREBASE_PROJECT_ID no coincide con Oliva Connect.');

const outputPath = resolve(root, 'public/r/firebase-config.js');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `export const firebaseConfig = ${JSON.stringify(config)};\n`, 'utf8');
console.log('Configuración Firebase pública generada para Firebase Hosting.');
