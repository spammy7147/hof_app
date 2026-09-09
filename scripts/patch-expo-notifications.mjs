import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('expo-notifications/package.json'));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (version !== '57.0.3') throw new Error(`Review the native-token retry patch for expo-notifications ${version}.`);

// 57.0.3은 실패한 nativeTokenPromise를 보관해 이후 모든 토큰 조회를 실패시킨다.
// 성공·실패 모두 in-flight 캐시를 비우고 동시 호출의 Promise 공유는 유지한다.
// Expo 버전을 올릴 때 upstream 수정 여부를 확인하고 제거한다.
const edits = await Promise.all([
  ['src/getDevicePushTokenAsync.ts', '    '],
  ['build/getDevicePushTokenAsync.js', '        '],
].map(async ([relativePath, indent]) => {
  const path = join(root, relativePath);
  const original = await readFile(path, 'utf8');
  const before = `${indent}devicePushToken = await nativeTokenPromise;\n${indent}nativeTokenPromise = null;`;
  const after = `${indent}try {\n${indent}  devicePushToken = await nativeTokenPromise;\n${indent}} finally {\n${indent}  nativeTokenPromise = null;\n${indent}}`;
  if (original.split(after).length === 2) return { path, original, updated: original };
  if (original.split(before).length !== 2) throw new Error(`Unexpected native-token source: ${relativePath}`);
  return { path, original, updated: original.replace(before, after) };
}));
for (const { path, original, updated } of edits) {
  if (updated !== original) await writeFile(path, updated);
}
console.log('Verified native-token retry patch (expo-notifications 57.0.3).');
