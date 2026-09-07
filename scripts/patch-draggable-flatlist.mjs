import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('react-native-draggable-flatlist/package.json'));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (version !== '4.0.3') throw new Error(`Review the nested-list web patch for react-native-draggable-flatlist ${version}.`);

// 4.0.3의 중첩 목록 측정은 웹에서도 findNodeHandle을 호출한다.
// RN Web 0.21의 ScrollView ref는 DOM 노드이므로 그대로 measureLayout에 전달한다.
// 네이티브 handle, 목록 offset 계산과 바깥 스크롤 제어는 보존한다.
const imports = ['import { findNodeHandle, LogBox } from "react-native";', 'import { findNodeHandle, LogBox, Platform } from "react-native";'];
const measurement = [
  'const nodeHandle = findNodeHandle(scrollableRef.current);',
  'const nodeHandle = Platform.OS === "web" ? scrollableRef.current : findNodeHandle(scrollableRef.current);',
];
const patches = [
  ['src/components/NestableDraggableFlatList.tsx', [imports, measurement]],
  ['lib/module/components/NestableDraggableFlatList.js', [imports, measurement]],
  ['lib/commonjs/components/NestableDraggableFlatList.js', [[
    'var nodeHandle=(0,_reactNative.findNodeHandle)(scrollableRef.current);',
    'var nodeHandle=_reactNative.Platform.OS==="web"?scrollableRef.current:(0,_reactNative.findNodeHandle)(scrollableRef.current);',
  ]]],
];

// 모든 배포 형식을 먼저 검증해 예상하지 못한 소스에서는 설치를 실패시킨다.
const edits = await Promise.all(patches.map(async ([relativePath, replacements]) => {
  const path = join(root, relativePath);
  const original = await readFile(path, 'utf8');
  let updated = original;
  for (const [before, after] of replacements) {
    if (updated.split(after).length === 2) continue;
    if (updated.split(before).length !== 2) throw new Error(`Unexpected nested-list source: ${relativePath}`);
    updated = updated.replace(before, after);
  }
  return { path, original, updated };
}));
for (const { path, original, updated } of edits) {
  if (updated !== original) await writeFile(path, updated);
}
console.log('Verified nested-list DOM measurement patch (react-native-draggable-flatlist 4.0.3).');
