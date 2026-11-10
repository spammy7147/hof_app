import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

function check(source: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'hof-ui-design-'));
  const file = path.join(directory, 'screen.tsx');
  try {
    writeFileSync(file, source);
    return spawnSync(process.execPath, ['scripts/check-ui-design.mjs', file], { encoding: 'utf8' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('디자인 검사는 공통 토큰을 사용하는 새 화면을 허용한다', () => {
  assert.equal(check('const styles = { text: { fontSize: theme.fontSize.body, lineHeight: theme.lineHeight.body }, card: { padding: theme.spacing.lg, marginTop: 0 } };').status, 0);
});

test('디자인 검사는 새 화면의 개별 글자·여백 크기를 실패로 보고한다', () => {
  const result = check('const styles = { title: { fontSize: 26 }, card: { padding: 16 } };');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /공통 theme 토큰/);
  assert.equal(check("const css = { fontSize: '18px', padding: '24px' };").status, 1);
});

test('디자인 검사는 글자 확대 비활성화와 배율 축소를 실패로 보고한다', () => {
  assert.equal(check('const screen = <Text allowFontScaling={false} />; const style = { transform: [{ scale: 0.8 }] };').status, 1);
});
