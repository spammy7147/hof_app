import { useEffect, useMemo, useRef, useState, type ElementRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Fish, House, Map, ScrollText, Shield, Swords, Users, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getAccessibilityFocusTarget, focusAccessibilityTarget } from '../../../platform/accessibilityFocus';

import {
  AUTOMATION_TYPE_METADATA,
  AUTOMATION_TYPE_ORDER,
  canAddAutomationType,
  isMapGroupType,
} from '../../../domain/typedAutomation';
import { theme } from '../../../styles/theme';
import type { AutomationType, TypedAutomationEntryResponse } from '../../../types/api';

type Props = {
  entries: readonly TypedAutomationEntryResponse[];
  error: string | null;
  pendingTypes: readonly AutomationType[];
  visible: boolean;
  onAdd: (type: AutomationType) => Promise<boolean>;
  onClose: () => void;
};

const TYPE_DESCRIPTIONS: Readonly<Record<AutomationType, string>> = {
  QUEST: '수락·완료와 전투 퀘스트를 자동으로 진행해요.',
  HOME_QUEST: '자택 퀘스트의 수락과 완료 보상 수령을 자동으로 처리해요.',
  BATTLE_MAP: '일일 목표 횟수에 맞춰 전투 맵을 실행해요.',
  ADVENTURE_MAP: '쿨다운과 횟수 제한에 맞춰 모험 맵을 진행해요.',
  RAID: '등록부터 누적 전투와 보상 수령까지 한 사이클로 진행해요.',
  UNION: '공유 쿨다운마다 선택한 유니온 맵을 순환해요.',
  FISHING: '일일 횟수가 끝날 때까지 시작과 잡기를 반복해요.',
};

export function AutomationAddSheet({
  entries,
  error,
  pendingTypes,
  visible,
  onAdd,
  onClose,
}: Props) {
  const { height } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  const titleRef = useRef<ElementRef<typeof Text>>(null);
  const submittingTypes = useRef(new Set<AutomationType>());
  const mountedRef = useRef(false);
  const visibleRef = useRef(visible);
  const visibilityGenerationRef = useRef(0);
  const [locallyPending, setLocallyPending] = useState<AutomationType[]>([]);
  const existingTypes = useMemo(() => new Set(entries.map(({ type }) => type)), [entries]);
  const busyTypes = useMemo(
    () => new Set<AutomationType>([...pendingTypes, ...locallyPending]),
    [locallyPending, pendingTypes],
  );

  visibleRef.current = visible;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      visibilityGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    visibilityGenerationRef.current += 1;
    setLocallyPending([]);
    if (!visible) return undefined;
    AccessibilityInfo.announceForAccessibility('자동화 추가 창이 열렸습니다.');
    const focusTimer = setTimeout(() => {
      const titleNode = getAccessibilityFocusTarget(titleRef.current);
      if (titleNode != null) focusAccessibilityTarget(titleNode);
    }, 250);
    return () => clearTimeout(focusTimer);
  }, [visible]);

  async function handleAdd(type: AutomationType) {
    if (!canAddAutomationType(entries, type) || busyTypes.has(type) || submittingTypes.current.has(type)) return;
    const visibilityGeneration = visibilityGenerationRef.current;
    submittingTypes.current.add(type);
    setLocallyPending((current) => [...current, type]);
    try {
      const added = await onAdd(type);
      if (
        added
        && mountedRef.current
        && visibleRef.current
        && visibilityGenerationRef.current === visibilityGeneration
      ) onClose();
    } finally {
      submittingTypes.current.delete(type);
      if (
        mountedRef.current
        && visibleRef.current
        && visibilityGenerationRef.current === visibilityGeneration
      ) {
        setLocallyPending((current) => current.filter((candidate) => candidate !== type));
      }
    }
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityHint="자동화 추가 창을 닫습니다"
          accessibilityLabel="자동화 추가 배경 닫기"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          accessibilityLabel="자동화 추가"
          accessibilityViewIsModal
          style={[styles.panel, { maxHeight: Math.min(height, height * 0.82) }]}
        >
          <View style={styles.dragHandle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text ref={titleRef} accessibilityRole="header" style={styles.title}>자동화 추가</Text>
              <Text style={styles.subtitle}>필요한 항목만 골라 우선순위에 추가하세요.</Text>
            </View>
            <Pressable
              accessibilityHint="자동화 추가 창을 닫습니다"
              accessibilityLabel="자동화 추가 닫기"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <X color={theme.colors.textMuted} size={20} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={[styles.list, { paddingBottom: theme.spacing.xl + bottom }]}
            contentInsetAdjustmentBehavior="never"
            keyboardShouldPersistTaps="handled"
          >
            {error ? (
              <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>
            ) : null}
            {AUTOMATION_TYPE_ORDER.map((type) => {
              const metadata = AUTOMATION_TYPE_METADATA[type];
              const exists = !isMapGroupType(type) && existingTypes.has(type);
              const busy = busyTypes.has(type);
              const disabled = !canAddAutomationType(entries, type) || busy;
              return (
                <Pressable
                  key={type}
                  accessibilityHint={exists ? '이미 추가한 자동화입니다' : '실행 우선순위 끝에 추가합니다'}
                  accessibilityLabel={`${metadata.label} 자동화 ${exists ? '추가됨' : '추가'}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: disabled, busy: busy }}
                  disabled={disabled}
                  onPress={() => { void handleAdd(type); }}
                  style={({ pressed }) => [
                    styles.typeRow,
                    disabled && styles.disabled,
                    pressed && !disabled && styles.pressed,
                  ]}
                >
                  <View style={styles.typeIcon}><AutomationTypeIcon type={type} /></View>
                  <View style={styles.typeCopy}>
                    <Text style={styles.typeLabel}>{metadata.label}</Text>
                    <Text style={styles.typeDescription}>{TYPE_DESCRIPTIONS[type]}</Text>
                  </View>
                  {busy ? (
                    <ActivityIndicator
                      accessibilityLabel={`${metadata.label} 추가 중`}
                      color={theme.colors.accentGreen}
                      size="small"
                    />
                  ) : (
                    <Text style={[styles.typeState, !exists && styles.typeStateAvailable]}>
                      {exists ? '추가됨' : '추가'}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function AutomationTypeIcon({ type }: { type: AutomationType }) {
  const iconProps = { color: theme.colors.accentGreen, size: 21 };
  const icon = AUTOMATION_TYPE_METADATA[type].icon;
  if (icon === 'scroll-text') return <ScrollText {...iconProps} />;
  if (icon === 'home') return <House {...iconProps} />;
  if (icon === 'swords') return <Swords {...iconProps} />;
  if (icon === 'map') return <Map {...iconProps} />;
  if (icon === 'raid') return <Shield {...iconProps} />;
  if (icon === 'union') return <Users {...iconProps} />;
  return <Fish {...iconProps} />;
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: theme.colors.overlay, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  panel: { backgroundColor: theme.colors.header, borderColor: theme.colors.borderStrong, borderTopLeftRadius: theme.radius.md * 3, borderTopRightRadius: theme.radius.md * 3, borderTopWidth: 1, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm },
  dragHandle: { alignSelf: 'center', backgroundColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, height: 4, marginBottom: theme.spacing.lg, width: 42 },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: theme.spacing.md, marginBottom: theme.spacing.md },
  headerCopy: { flex: 1 },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: theme.spacing.xs },
  closeButton: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  list: { gap: theme.spacing.sm },
  error: { borderLeftColor: theme.colors.danger, borderLeftWidth: 3, color: theme.colors.text, fontSize: 12, lineHeight: 18, marginBottom: theme.spacing.xs, paddingLeft: theme.spacing.sm },
  typeRow: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md * 2, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 72, padding: theme.spacing.md },
  typeIcon: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md + 4, height: 44, justifyContent: 'center', width: 44 },
  typeCopy: { flex: 1, minWidth: 0 },
  typeLabel: { color: theme.colors.text, fontSize: 14, fontWeight: '900' },
  typeDescription: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  typeState: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 12, color: theme.colors.textMuted, fontSize: 10, fontWeight: '800', overflow: 'hidden', paddingHorizontal: theme.spacing.sm, paddingVertical: 5 },
  typeStateAvailable: { backgroundColor: theme.colors.accentGreen, color: theme.colors.buttonText },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.48 },
});
