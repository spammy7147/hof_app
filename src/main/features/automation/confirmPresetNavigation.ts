import { AppAlert } from '../../platform/AppAlert';
import type { AutomationPresetEditor } from '../../domain/automationPresetEditor';

const pending = new WeakMap<AutomationPresetEditor, object>();

/** 선택 변경·뒤로·탭 이동에서 같은 초안 보호 정책을 사용한다. */
export function confirmPresetNavigation(editor: AutomationPresetEditor | undefined, next: () => void): void {
  if (!editor) { next(); return; }
  if (editor.getSnapshot().busy || pending.has(editor)) return;
  if (!editor.getSnapshot().dirty) { next(); return; }
  const token = {};
  pending.set(editor, token);
  const unsubscribe = editor.subscribe(() => {
    if (!editor.getSnapshot().loaded) { pending.delete(editor); unsubscribe(); }
  });
  const choose = (action: 'save' | 'discard' | 'cancel') => async () => {
    if (pending.get(editor) !== token) return;
    pending.delete(editor);
    unsubscribe();
    if (action === 'save' && await editor.save()) next();
    if (action === 'discard') { await editor.discard(); next(); }
  };
  AppAlert.alert('프리셋 변경 내용을 저장할까요?', '현재 실행 설정은 바뀌지 않았어요. 편집한 구성 전체를 저장하거나 버리고 이동할 수 있어요.', [
    { text: '취소', style: 'cancel', onPress: choose('cancel') },
    { text: '버리고 이동', style: 'destructive', onPress: choose('discard') },
    { text: '저장 후 이동', onPress: choose('save') },
  ]);
}
