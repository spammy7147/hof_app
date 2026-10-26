import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/** 표시 중인 기능만 복귀 시 갱신한다. 숨겨진 기능의 주기 조회는 만들지 않는다. */
export function useVisibleRefresh(refresh: () => void) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    let previous = AppState?.currentState;
    const subscription = typeof document === 'undefined' ? AppState?.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active') latest.current();
      previous = next;
    }) : undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') latest.current(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      subscription?.remove();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
