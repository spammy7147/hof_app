import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve('react-native-draggable-flatlist/package.json'));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 실제 의존성의 layout callback을 실행한다. 목록 mock으로 이 콜백까지 없애면 웹 오류를 놓친다.
for (const entry of [
  'src/components/NestableDraggableFlatList.tsx',
  'lib/module/components/NestableDraggableFlatList.js',
  'lib/commonjs/components/NestableDraggableFlatList.js',
]) {
  for (const platform of ['web', 'android']) {
    it(`${entry}: ${platform} measures the nested list and preserves drag scroll coordination`, async () => {
      const scrollNode = { nodeType: 1 };
      const sharedValues: Array<{ value: number }> = [];
      const enabledChanges: boolean[] = [];
      const handles: unknown[] = [];
      const measurements: unknown[] = [];
      const dragEvents: string[] = [];
      let nestedAutoScroll: { hoverOffset: { value: number } } | undefined;
      const filename = resolve(packageRoot, entry);
      const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
      }).outputText;
      const exported: { exports: Record<string, unknown> } = { exports: {} };
      const mocks: Record<string, unknown> = {
        react: React,
        'react-native': {
          Platform: { OS: platform },
          LogBox: { ignoreLogs() {} },
          findNodeHandle(node: unknown) {
            handles.push(node);
            if (platform === 'web') throw new Error('findNodeHandle is not supported on web. Use the ref property on the component instead.');
            return 42;
          },
        },
        'react-native-reanimated': {
          useSharedValue(value: number) { const shared = { value }; sharedValues.push(shared); return shared; },
          useDerivedValue(compute: () => number) { return { get value() { return compute(); } }; },
        },
        '../components/DraggableFlatList': { __esModule: true, default: 'DraggableFlatList' },
        '../context/nestableScrollContainerContext': {
          useSafeNestableScrollContainerContext: () => ({
            scrollableRef: { current: scrollNode },
            outerScrollOffset: { value: 17 },
            setOuterScrollEnabled: (value: boolean) => enabledChanges.push(value),
          }),
        },
        '../hooks/useNestedAutoScroll': { useNestedAutoScroll: (value: typeof nestedAutoScroll) => { nestedAutoScroll = value; } },
        '../hooks/useStableCallback': { useStableCallback: (callback: unknown) => callback },
      };
      runInNewContext(source, {
        module: exported,
        exports: exported.exports,
        require: (name: string) => name in mocks ? mocks[name] : createRequire(filename)(name),
        console: { log() {} },
      }, { filename });
      const Component = exported.exports.NestableDraggableFlatList as React.ComponentType<Record<string, unknown>>;
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(React.createElement(Component, {
          data: [], onDragBegin: () => dragEvents.push('begin'), onDragEnd: () => dragEvents.push('end'),
        }));
      });
      try {
        const list = renderer.root.findByType('DraggableFlatList' as React.ElementType);
        await act(async () => {
          await list.props.onContainerLayout({ containerRef: { current: {
            measureLayout(relative: unknown, success: (x: number, y: number) => void) {
              measurements.push(relative);
              success(0, 64);
            },
          } } });
        });
        assert.deepEqual(measurements, [platform === 'web' ? scrollNode : 42]);
        assert.equal(sharedValues[0]!.value, 64);
        assert.equal(nestedAutoScroll!.hoverOffset.value, 64);
        assert.deepEqual(handles, platform === 'web' ? [] : [scrollNode]);
        list.props.onDragBegin(0);
        list.props.onDragEnd({ data: [], from: 0, to: 0 });
        assert.deepEqual(enabledChanges, [false, true]);
        assert.deepEqual(dragEvents, ['begin', 'end']);
      } finally {
        await act(async () => { renderer.unmount(); });
      }
    });
  }
}
