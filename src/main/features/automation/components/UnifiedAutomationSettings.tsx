import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { theme } from '../../../styles/theme';
import type { UnifiedAutomationSettingsRequest } from '../../../types/api';

export type UnifiedSettingsRoute =
  | 'keyQuest'
  | 'time'
  | 'cooldownAdventure'
  | 'dailyAdventure'
  | 'union'
  | 'normalQuest';

type Props = {
  settings: UnifiedAutomationSettingsRequest;
  onOpen: (route: UnifiedSettingsRoute) => void;
  onToggle: (route: UnifiedSettingsRoute) => void;
};

const MODULES: Array<{ route: UnifiedSettingsRoute; title: string; description: string }> = [
  { route: 'keyQuest', title: '열쇠 퀘스트', description: '수락·완료를 먼저 확인하고 필요한 맵 실행' },
  { route: 'time', title: 'Time 자동 소모', description: '설정 비율을 넘으면 일반맵 우선 실행' },
  { route: 'cooldownAdventure', title: '쿨다운 모험맵', description: '쿨다운이 끝난 맵부터 실행' },
  { route: 'dailyAdventure', title: '일일 제한 모험맵', description: '하루 안에 승리 제한까지 실행' },
  { route: 'union', title: '유니온', description: '발생 중인 유니온만 확인 후 실행' },
  { route: 'normalQuest', title: '일반 퀘스트', description: '선택한 다른 퀘스트를 순서대로 처리' },
];

/** 상세 옵션은 행을 눌러 들어가고 첫 화면에는 모듈 스위치만 남긴다. */
export function UnifiedAutomationSettings({ settings, onOpen, onToggle }: Props) {
  return (
    <View style={styles.card}>
      {MODULES.map((module) => {
        const enabled = settings[module.route].enabled;
        return (
          <View key={module.route} style={styles.row}>
            <Pressable
              accessibilityLabel={`${module.title} ${enabled ? '끄기' : '켜기'}`}
              accessibilityRole="switch"
              accessibilityState={{ checked: enabled }}
              onPress={() => onToggle(module.route)}
              style={[styles.toggle, enabled && styles.toggleOn]}
            >
              <View style={[styles.toggleKnob, enabled && styles.toggleKnobOn]} />
            </Pressable>
            <Pressable onPress={() => onOpen(module.route)} style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}>
              <View style={styles.copy}>
                <Text style={styles.title}>{module.title}</Text>
                <Text numberOfLines={1} style={styles.description}>{module.description}</Text>
              </View>
              <ChevronRight color={theme.colors.textMuted} size={18} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, paddingHorizontal: theme.spacing.md },
  row: { alignItems: 'center', borderBottomColor: theme.colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, minHeight: 66 },
  toggle: { backgroundColor: theme.colors.border, borderRadius: 12, height: 24, padding: 3, width: 42 },
  toggleOn: { backgroundColor: theme.colors.accentGreen },
  toggleKnob: { backgroundColor: theme.colors.text, borderRadius: 9, height: 18, width: 18 },
  toggleKnobOn: { alignSelf: 'flex-end' },
  copyButton: { alignItems: 'center', flex: 1, flexDirection: 'row', minHeight: 64 },
  copy: { flex: 1 },
  title: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  description: { color: theme.colors.textMuted, fontSize: 12, marginTop: 3 },
  pressed: { opacity: 0.7 },
});
