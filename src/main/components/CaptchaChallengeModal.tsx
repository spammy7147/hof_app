import { Image, type ImageSource } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { theme } from '../styles/theme';
import type { CaptchaChallengeResponse } from '../types/api';
import { PrimaryButton } from './PrimaryButton';

type CaptchaChallengeModalProps = {
  visible: boolean;
  captcha: CaptchaChallengeResponse | null;
  imageSource: ImageSource | null;
  isLoading: boolean;
  isSubmitting: boolean;
  message: string | null;
  errorMessage: string | null;
  onRefresh: () => void;
  onSubmit: (answer: string) => boolean | void | Promise<boolean | void>;
  onRequestClose?: () => void;
  blocking?: boolean;
};

/**
 * 전역 캡차 입력 모달이다.
 *
 * 전투 중 캡차가 감지되면 어떤 화면에 있든 이 모달을 최우선으로 띄워 사용자가 인증을 완료하게 한다.
 */
export function CaptchaChallengeModal({
  visible,
  captcha,
  imageSource,
  isLoading,
  isSubmitting,
  message,
  errorMessage,
  onRefresh,
  onSubmit,
  onRequestClose,
  blocking = false,
}: CaptchaChallengeModalProps) {
  const [answer, setAnswer] = useState('');
  const [imageErrorMessage, setImageErrorMessage] = useState<string | null>(null);
  const trimmedAnswer = answer.trim();

  /**
   * 새 캡차가 열릴 때 이전 입력값을 지워서 다른 캡차 답이 섞이지 않게 한다.
   */
  useEffect(() => {
    if (!visible) {
      setAnswer('');
      setImageErrorMessage(null);
      return;
    }

    setAnswer('');
    setImageErrorMessage(null);
  }, [captcha?.id, visible]);

  const handleImageError = useCallback(() => {
    setImageErrorMessage('캡차 이미지를 불러오지 못했습니다. 새로고침해 주세요.');
  }, []);

  /**
   * 모달 닫기 요청을 처리한다. blocking 모드에서는 부모가 닫기 거부 메시지를 표시한다.
   */
  const requestClose = useCallback(() => {
    if (blocking) {
      onRequestClose?.();
      return;
    }

    onRequestClose?.();
  }, [blocking, onRequestClose]);

  /**
   * 입력값을 부모 컴포넌트로 전달하고, 성공/재시도 여부에 따라 입력칸을 비운다.
   */
  const submit = useCallback(async () => {
    if (!trimmedAnswer || isSubmitting) return;

    const shouldClearAnswer = await onSubmit(trimmedAnswer);
    if (shouldClearAnswer !== false) {
      setAnswer('');
    }
  }, [isSubmitting, onSubmit, trimmedAnswer]);

  const fallbackMessage = '대기 중인 캡차가 없습니다.';

  return (
    <Modal
      animationType="fade"
      onRequestClose={requestClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityRole="button"
          disabled={blocking}
          onPress={requestClose}
          style={styles.modalBackdrop}
        />
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>캡차 입력</Text>
            {blocking ? null : (
              <Pressable accessibilityRole="button" onPress={requestClose} style={styles.closeButton}>
                <Text style={styles.closeText}>닫기</Text>
              </Pressable>
            )}
          </View>

          <ScrollView
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
            style={styles.modalScroll}
          >
            {isLoading ? (
              <View style={styles.statePanel}>
                <ActivityIndicator color={theme.colors.accentGreen} />
                <Text style={styles.mutedText}>캡차 확인 중</Text>
              </View>
            ) : null}

            {!isLoading && captcha ? (
              <View style={styles.body}>
                <Text style={styles.promptText}>{captcha.prompt}</Text>
                {imageSource ? (
                  <>
                    <View style={styles.imageFrame}>
                      <Image
                        cachePolicy="none"
                        contentFit="contain"
                        onError={handleImageError}
                        onLoad={() => setImageErrorMessage(null)}
                        source={imageSource}
                        style={styles.captchaImage}
                      />
                    </View>
                    {imageErrorMessage ? <Text style={styles.errorText}>{imageErrorMessage}</Text> : null}
                  </>
                ) : (
                  <Text style={styles.mutedText}>캡차 이미지 주소가 없습니다.</Text>
                )}
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isSubmitting}
                  onChangeText={setAnswer}
                  onSubmitEditing={() => {
                    void submit();
                  }}
                  placeholder="보안문자 입력"
                  placeholderTextColor={theme.colors.textMuted}
                  returnKeyType="done"
                  style={styles.input}
                  value={answer}
                />
                <View style={styles.actionRow}>
                  <PrimaryButton
                    label="새로고침"
                    variant="secondary"
                    loading={isLoading}
                    onPress={onRefresh}
                    style={styles.actionButton}
                  />
                  <PrimaryButton
                    label="제출"
                    loading={isSubmitting}
                    disabled={trimmedAnswer.length === 0}
                    onPress={() => {
                      void submit();
                    }}
                    style={styles.actionButton}
                  />
                </View>
              </View>
            ) : null}

            {!isLoading && !captcha ? (
              <View style={styles.statePanel}>
                <Text style={styles.mutedText}>{message ?? fallbackMessage}</Text>
                <PrimaryButton
                  label="다시 확인"
                  variant="secondary"
                  loading={isLoading}
                  onPress={onRefresh}
                />
              </View>
            ) : null}

            {message && captcha ? <Text style={styles.messageText}>{message}</Text> : null}
            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.66)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.md,
    borderCurve: 'continuous',
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
  },
  modalScroll: {
    flexShrink: 1,
  },
  modalContent: {
    gap: theme.spacing.md,
  },
  modalHeader: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  modalTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  closeButton: {
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    borderCurve: 'continuous',
    paddingHorizontal: theme.spacing.md,
  },
  closeText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '900',
  },
  body: {
    gap: theme.spacing.md,
  },
  promptText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  imageFrame: {
    minHeight: 90,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    borderCurve: 'continuous',
    backgroundColor: theme.colors.background,
    padding: theme.spacing.sm,
  },
  captchaImage: {
    width: '100%',
    height: 86,
  },
  input: {
    minHeight: 44,
    color: theme.colors.text,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    borderCurve: 'continuous',
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: theme.spacing.md,
    fontSize: 15,
    fontWeight: '800',
  },
  actionRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  actionButton: {
    minWidth: 0,
    flex: 1,
  },
  statePanel: {
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  mutedText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
  },
  messageText: {
    color: theme.colors.accentAmber,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
  },
});
