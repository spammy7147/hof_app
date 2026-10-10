import assert from 'node:assert/strict';
import Module from 'node:module';
import { it } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: Loader };
const original = loader._load;
loader._load = (request, parent, isMain) => {
  if (request === 'react-native') return { ActivityIndicator: host('ActivityIndicator'), View: host('View'), Text: host('Text'), StyleSheet: { create: <T,>(styles: T) => styles } };
  if (request === 'react-native-webview') return { WebView: host('WebView') };
  if (request.endsWith('/PrimaryButton')) return { PrimaryButton: host('PrimaryButton') };
  return original(request, parent, isMain);
};
const { BattleLogDetailScreen } = require('../../main/screens/BattleLogDetailScreen.native') as typeof import('../../main/screens/BattleLogDetailScreen.native');
loader._load = original;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('Android 세부 로그는 보관 HTML을 표시하고 원본 링크나 외부 페이지를 열지 않는다', async () => {
  const html = '<html><body><table><tr><td>1턴 공격 · 156 데미지</td></tr></table></body></html>';
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(React.createElement(BattleLogDetailScreen, {
    title: '패배 로그', url: 'https://hof.zerosic.com/index.php?log=expired', html, archiveOnly: true, onBack: () => {},
  })); });
  try {
    const view = renderer.root.find(node => String(node.type) === 'WebView');
    assert.deepEqual(view.props.source, { html });
    assert.equal(view.props.javaScriptEnabled, false);
    assert.equal(view.props.onShouldStartLoadWithRequest({ url: 'https://hof.zerosic.com/index.php?log=expired' }), false);
    assert.equal(view.props.onShouldStartLoadWithRequest({ url: 'about:blank' }), true);
    await act(async () => { renderer.update(React.createElement(BattleLogDetailScreen, {
      title: '패배 로그', url: 'https://hof.zerosic.com/index.php?log=expired', archiveOnly: true,
      notice: '상세 로그를 보관 중입니다.', onBack: () => {},
    })); });
    assert.equal(renderer.root.findAll(node => String(node.type) === 'WebView').length, 0);
  } finally { await act(async () => { renderer.unmount(); }); }
});
