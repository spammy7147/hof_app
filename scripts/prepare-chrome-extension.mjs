import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const distUrl = new URL('../dist/', import.meta.url);
const sourceUrl = new URL('_expo/', distUrl);
const targetUrl = new URL('expo/', distUrl);
const indexUrl = new URL('index.html', distUrl);
const expoBundlePath = '/_expo/';

await rename(sourceUrl, targetUrl);

const indexHtml = await readFile(indexUrl, 'utf8');
if (!indexHtml.includes(expoBundlePath)) {
  throw new Error(`Expected ${expoBundlePath} in ${fileURLToPath(indexUrl)}.`);
}

await writeFile(indexUrl, indexHtml.replaceAll(expoBundlePath, '/expo/'));
