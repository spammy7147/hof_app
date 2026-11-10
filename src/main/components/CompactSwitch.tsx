import { Pressable, StyleSheet, Switch, type SwitchProps, View } from 'react-native';

import { theme } from '../styles/theme';

export type CompactSwitchProps = Pick<SwitchProps,
  'value' | 'disabled' | 'onValueChange' | 'style' | 'accessibilityLabel' |
  'accessibilityHint' | 'testID' | 'trackColor' | 'thumbColor'>;

/** 시각 크기는 유지하고 스위치 하나의 조작 영역을 44 이상 확보한다. */
export function CompactSwitch({ value = false, disabled, onValueChange, style, accessibilityLabel, accessibilityHint, testID, ...props }: CompactSwitchProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: disabled ?? false }}
      disabled={disabled}
      onPress={() => onValueChange?.(!value)}
      style={[styles.target, style]}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
        <Switch {...props} accessible={false} disabled={disabled} value={value} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: theme.control.touch,
    minWidth: theme.control.touch,
    flexShrink: 0,
  },
});
