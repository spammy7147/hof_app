import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('react-native-web/package.json'));
const cjsRequire = createRequire(join(root, 'dist/cjs/exports/Modal/index.js'));
const FlatList = cjsRequire('../FlatList');
const ScrollView = cjsRequire('../ScrollView');
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

for (const entry of ['dist/exports/Modal/index.js', 'dist/cjs/exports/Modal/index.js']) {
  it(`${entry}: 목록 안에서 연 모달의 목록은 독립적인 스크롤 영역을 유지한다`, async (context) => {
    // DOM 없는 렌더러에서 wheel 대상 노드를 기다리는 라이브러리 재시도를 남기지 않는다.
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const filename = join(root, entry);
    const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const exported: { exports: any } = { exports: {} };
    runInNewContext(source, {
      module: exported,
      exports: exported.exports,
      require: (name: string) => name === './ModalPortal'
        // DOM 포털만 대체한다. 실제 Modal과 FlatList의 context 및 스크롤 렌더링은 실행한다.
        ? { __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }
        : cjsRequire(name),
    }, { filename });
    const Modal = exported.exports.default ?? exported.exports;
    let renderer!: ReactTestRenderer;
    const inner = React.createElement(FlatList, {
      testID: 'picker-list',
      data: Array.from({ length: 12 }, (_, slot) => String(slot)),
      renderItem: ({ item }: { item: string }) => React.createElement('span', null, item),
      style: { maxHeight: 260 },
    });
    const renderParent = (content: React.ReactNode) => React.createElement(FlatList, {
      data: ['preset'],
      renderItem: () => content,
    });
    try {
      await act(async () => {
        renderer = create(renderParent(React.createElement(Modal, { visible: true, animationType: 'none' }, inner)), {
          createNodeMock: () => ({ addEventListener() {}, removeEventListener() {} }),
        });
      });
      const picker = renderer.root.findByType(Modal).findByType(FlatList);
      assert.equal(picker.findAllByType(ScrollView).length, 1, '모달 목록이 스크롤 없는 View로 바뀌면 안 된다');

      await act(async () => { renderer.update(renderParent(inner)); });
      const nested = renderer.root.findAllByType(FlatList)[1]!;
      assert.equal(nested.findAllByType(ScrollView).length, 0, '모달 밖의 실제 중첩 목록은 부모 스크롤을 공유한다');
    } finally {
      if (renderer) await act(async () => renderer.unmount());
    }
  });
}
