import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StyleSheet, View } from "react-native";

import { theme } from "../styles/theme";

type Owner = symbol;
type Entry = { owner: Owner; content: ReactNode };
type Host = {
  hide: (owner: Owner) => void;
  show: (owner: Owner, content: ReactNode) => void;
};

const FixedBottomActionContext = createContext<Host | null>(null);

/**
 * 긴 화면의 스크롤 영역과 최종 제출 작업을 분리한다.
 *
 * 여러 하위 화면이 전환되는 동안 늦은 cleanup이 현재 화면의 작업을 지우지 않도록
 * owner별 stack을 유지하고, 가장 최근에 등록한 작업만 화면 하단에 표시한다.
 */
export function FixedBottomActionHost({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const show = useCallback((owner: Owner, content: ReactNode) => {
    setEntries((current) => [
      ...current.filter((entry) => entry.owner !== owner),
      { owner, content },
    ]);
  }, []);
  const hide = useCallback((owner: Owner) => {
    setEntries((current) => current.filter((entry) => entry.owner !== owner));
  }, []);
  const host = useMemo(() => ({ hide, show }), [hide, show]);
  const active = entries.at(-1) ?? null;

  return (
    <FixedBottomActionContext.Provider value={host}>
      <View style={styles.host}>
        <View style={styles.content}>{children}</View>
        {active ? (
          <View accessibilityLabel="고정 하단 작업" style={styles.actionBar}>
            {active.content}
          </View>
        ) : null}
      </View>
    </FixedBottomActionContext.Provider>
  );
}

/**
 * Host 안에서는 children을 화면 하단으로 올리고, 독립 렌더링에서는 원래 위치에 둔다.
 * 테스트·모달처럼 Host 바깥에서 쓰는 화면도 기존 레이아웃을 잃지 않는다.
 */
export function FixedBottomAction({ children }: { children: ReactNode }) {
  const host = useContext(FixedBottomActionContext);
  const owner = useRef<Owner>(Symbol("fixed-bottom-action")).current;

  useLayoutEffect(() => {
    if (!host) return;
    host.show(owner, children);
    return () => host.hide(owner);
  }, [children, host, owner]);

  return host ? null : <>{children}</>;
}

const styles = StyleSheet.create({
  host: { flex: 1, minHeight: 0 },
  content: { flex: 1, minHeight: 0 },
  actionBar: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
});
