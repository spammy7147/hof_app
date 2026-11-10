import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const themeFile = path.join(app, 'src/main/styles/theme.ts');
const spacing = /^(?:padding|margin)(?:Top|Bottom|Left|Right|Start|End|Horizontal|Vertical)?$|^(?:gap|rowGap|columnGap)$/;

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : /\.[jt]sx?$/.test(file) ? [file] : [];
  });
}

const files = process.argv.slice(2).length ? process.argv.slice(2).map(file => path.resolve(file)) : filesIn(path.join(app, 'src/main'));
const violations = [];
for (const file of files) {
  if (file === themeFile) continue;
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const report = (node, message) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push(`${path.relative(app, file)}:${line + 1} ${message}`);
  };
  function visit(node) {
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(source).replace(/['"]/g, '');
      const value = node.initializer;
      const numeric = ts.isNumericLiteral(value) || (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand));
      const pixels = ts.isStringLiteral(value) && /-?\d+(?:\.\d+)?px/.test(value.text);
      if ((numeric || pixels) && (name === 'fontSize' || name === 'lineHeight' || (spacing.test(name) && value.getText(source) !== '0'))) {
        report(node, `${name}: 공통 theme 토큰을 사용하세요.`);
      }
      if (name === 'scale' && ts.isNumericLiteral(value) && Number(value.text) !== 1) report(node, '화면 축소는 실제 크기·여백 토큰으로 구현하세요.');
    }
    if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer)) {
      const value = node.initializer.expression;
      if (node.name.getText(source) === 'allowFontScaling' && value?.kind === ts.SyntaxKind.FalseKeyword) report(node, '기기 글자 확대를 유지하세요.');
      if (node.name.getText(source) === 'maxFontSizeMultiplier' && value && ts.isNumericLiteral(value) && Number(value.text) === 1) report(node, '글자 확대를 1배로 제한하지 마세요.');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

if (violations.length) {
  console.error(violations.slice(0, 40).join('\n'));
  console.error(`최대 밀도 디자인 기준 위반 ${violations.length}건`);
  process.exitCode = 1;
} else {
  console.log(`최대 밀도 디자인 기준 확인: ${files.length}개 파일`);
}
