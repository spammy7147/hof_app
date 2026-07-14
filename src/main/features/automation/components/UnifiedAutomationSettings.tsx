import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getUnifiedModuleTypeLabel } from '../../../domain/unifiedAutomation';
import { theme } from '../../../styles/theme';
import type { UnifiedAutomationModuleResponse } from '../../../types/api';

type Props = {
  modules: UnifiedAutomationModuleResponse[];
  busy: boolean;
  onToggle: (module: UnifiedAutomationModuleResponse) => void;
};

/**
 * 새 편집 화면이 완성되기 전에도 서버의 동적 모듈 목록을 정확히 보여주는 과도기 목록이다.
 * 고정 유형이나 기본 모듈을 합성하지 않으며, 저장된 모듈이 없으면 빈 상태만 표시한다.
 */
export function UnifiedAutomationSettings({ modules, busy, onToggle }: Props) {
  if (modules.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>자동화 구성이 없습니다.</Text>
        <Text style={styles.description}>필요한 자동화 모듈을 추가해 사용할 수 있어요.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {modules.map((module) => (
        <View key={module.id} style={styles.row}>
          <Pressable
            accessibilityLabel={`${module.displayName} ${module.enabled ? '끄기' : '켜기'}`}
            accessibilityRole="switch"
            accessibilityState={{ checked: module.enabled, disabled: busy }}
            disabled={busy}
            onPress={() => onToggle(module)}
            style={[styles.toggle, module.enabled && styles.toggleOn, busy && styles.disabled]}
          >
            <View style={[styles.toggleKnob, module.enabled && styles.toggleKnobOn]} />
          </Pressable>
          <View style={styles.copy}>
            <Text style={styles.title}>{module.displayName}</Text>
            <Text numberOfLines={1} style={styles.description}>
              {getUnifiedModuleTypeLabel(module.moduleType)} · {module.summary}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, paddingHorizontal: theme.spacing.md },
  emptyCard: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: 4, padding: theme.spacing.lg },
  emptyTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '800' },
  row: { alignItems: 'center', borderBottomColor: theme.colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, minHeight: 62 },
  toggle: { backgroundColor: theme.colors.border, borderRadius: 12, height: 24, padding: 3, width: 42 },
  toggleOn: { backgroundColor: theme.colors.accentGreen },
  toggleKnob: { backgroundColor: theme.colors.text, borderRadius: 9, height: 18, width: 18 },
  toggleKnobOn: { alignSelf: 'flex-end' },
  copy: { flex: 1 },
  title: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  description: { color: theme.colors.textMuted, fontSize: 12, marginTop: 3 },
  disabled: { opacity: 0.45 },
});
