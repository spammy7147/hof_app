import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, it } from 'node:test';
import React from 'react';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: Loader };
const original = loader._load;
loader._load = (request, parent, isMain) => {
  if (request === 'react-native') return {
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style,
    },
    View: host('View'), Switch: host('NativeSwitch'),
    Pressable: (props: Record<string, unknown>) => React.createElement('Pressable', {
      ...props, accessible: true, onPress: props.disabled ? undefined : props.onPress,
    }, props.children as React.ReactNode),
  };
  return original(request, parent, isMain);
};
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
const { CompactSwitch } = require('../../main/components/CompactSwitch') as typeof import('../../main/components/CompactSwitch');
loader._load = original;
afterEach(async () => rntl.cleanup());

it('큰 조작 영역의 스위치를 누르면 현재 값의 반대로 한 번 변경한다', async () => {
  const values: boolean[] = [];
  const user = rntl.userEvent.setup();
  await rntl.render(React.createElement(CompactSwitch, { accessibilityLabel: '낚시 사용', value: false, onValueChange: value => { values.push(value); } }));
  await user.press(rntl.screen.getByRole('switch', { name: '낚시 사용', checked: false }));
  assert.deepEqual(values, [true]);
  await rntl.screen.rerender(React.createElement(CompactSwitch, { accessibilityLabel: '낚시 사용', value: true, onValueChange: value => { values.push(value); } }));
  await user.press(rntl.screen.getByRole('switch', { name: '낚시 사용', checked: true }));
  assert.deepEqual(values, [true, false]);
});

it('비활성화한 스위치는 값 변경을 제출하지 않는다', async () => {
  let changed = false;
  const user = rntl.userEvent.setup();
  await rntl.render(React.createElement(CompactSwitch, { accessibilityLabel: '낚시 사용', value: true, disabled: true, onValueChange: () => { changed = true; } }));
  await user.press(rntl.screen.getByRole('switch', { name: '낚시 사용', disabled: true }));
  assert.equal(changed, false);
});
