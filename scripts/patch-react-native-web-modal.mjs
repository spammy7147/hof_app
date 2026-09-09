import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('react-native-web/package.json'));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (version !== '0.21.2') throw new Error(`Review the modal list context patch for react-native-web ${version}.`);

// 웹 Modal도 네이티브 Modal처럼 부모 VirtualizedList의 context를 끊어야 한다.
// 그렇지 않으면 프리셋 행 안에서 연 선택 목록이 일반 View가 되어 스크롤되지 않는다.
// 의존성 버전을 올릴 때 upstream 수정 여부를 확인하고 제거한다.
const contextPath = '../../vendor/react-native/VirtualizedList/VirtualizedListContext.js';
const edits = await Promise.all([
  ['src/exports/Modal/index.js',
    `import { VirtualizedListContextResetter } from '${contextPath}';\n`,
    '{children}', '<VirtualizedListContextResetter>{children}</VirtualizedListContextResetter>'],
  ['dist/exports/Modal/index.js',
    `import { VirtualizedListContextResetter } from '${contextPath}';\n`,
    '}), children))));', '}), React.createElement(VirtualizedListContextResetter, null, children)))));'],
  ['dist/cjs/exports/Modal/index.js',
    `var { VirtualizedListContextResetter } = require('${contextPath}');\n`,
    '}), children))));', '}), React.createElement(VirtualizedListContextResetter, null, children)))));'],
].map(async ([relativePath, addedImport, before, after]) => {
  const path = join(root, relativePath);
  const original = await readFile(path, 'utf8');
  if (original.includes(addedImport) && original.split(after).length === 2) return { path, original, updated: original };
  if (original.includes(addedImport) || original.split(before).length !== 2) {
    throw new Error(`Unexpected modal source: ${relativePath}`);
  }
  return { path, original, updated: original.replace("'use client';", `'use client';\n\n${addedImport}`).replace(before, after) };
}));
for (const { path, original, updated } of edits) {
  if (updated !== original) await writeFile(path, updated);
}
console.log('Verified modal list context patch (react-native-web 0.21.2).');
