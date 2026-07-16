import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

type Props = {
  children?: ReactNode;
  initialMetrics?: Metrics | null;
  style?: StyleProp<ViewStyle>;
};

/** Production root providers, exposed as one mountable composition boundary. */
export function AppProviders({ children, initialMetrics, style }: Props) {
  return (
    <GestureHandlerRootView style={[{ flex: 1 }, style]}>
      <SafeAreaProvider initialMetrics={initialMetrics}>
        {children}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
