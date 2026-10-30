import { useEffect } from 'react';
import { BackHandler } from 'react-native';

/** 하드웨어 뒤로도 화면 버튼의 초안 보호 경로를 사용한다. */
export function useAutomationEditorBack(onBack: () => void, disabled: boolean): void {
  useEffect(() => {
    const subscription = BackHandler?.addEventListener('hardwareBackPress', () => {
      if (!disabled) onBack();
      return true;
    });
    return () => subscription?.remove();
  }, [disabled, onBack]);
}
