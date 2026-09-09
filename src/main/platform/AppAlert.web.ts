import type { AlertButton, AlertOptions } from 'react-native';
import { theme } from '../styles/theme';

let nextId = 0;

/** 브라우저와 확장 페이지에서 실제 modal·키보드·포커스 처리는 HTML dialog가 소유한다. */
export const AppAlert = {
  alert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions): void {
    const trigger = document.activeElement;
    const id = `app-alert-${++nextId}`;
    const choices = buttons?.length ? buttons : [{ text: '확인' }];
    const dialog = document.createElement('dialog');
    dialog.id = id;
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    Object.assign(dialog.style, {
      background: theme.colors.surface, color: theme.colors.text,
      border: `1px solid ${theme.colors.border}`, borderRadius: '12px',
      padding: '24px', width: 'min(360px, calc(100vw - 32px))',
      boxSizing: 'border-box', maxHeight: 'calc(100dvh - 32px)', overflow: 'auto',
      fontFamily: 'system-ui, sans-serif', boxShadow: '0 16px 48px #0008',
    });
    const style = document.createElement('style');
    style.textContent = `#${id}::backdrop { background: ${theme.colors.overlay}; }
      #${id} button:focus-visible { outline: 2px solid ${theme.colors.accentBlue}; outline-offset: 3px; }`;
    const heading = document.createElement('h2');
    heading.id = `${id}-title`;
    heading.textContent = title;
    Object.assign(heading.style, { margin: '0', fontSize: '18px', lineHeight: '1.5' });
    dialog.append(style, heading);
    if (message) {
      const description = document.createElement('p');
      description.id = `${id}-message`;
      description.textContent = message;
      Object.assign(description.style, { margin: '12px 0 0', fontSize: '14px', lineHeight: '1.6', whiteSpace: 'pre-wrap' });
      dialog.setAttribute('aria-describedby', description.id);
      dialog.append(description);
    }
    const actions = document.createElement('div');
    Object.assign(actions.style, { display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' });
    let settled = false;
    const finish = (choice?: AlertButton, dismissed = false) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      if (trigger instanceof HTMLElement && trigger.isConnected
        && !trigger.matches(':disabled, [aria-disabled="true"]') && trigger.getClientRects().length > 0) {
        trigger.focus({ preventScroll: true });
      }
      choice?.onPress?.();
      if (dismissed) options?.onDismiss?.();
    };
    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = choice.text ?? '확인';
      button.autofocus = choice.style === 'cancel' || choice.isPreferred === true;
      Object.assign(button.style, {
        border: `1px solid ${theme.colors.borderStrong}`, borderRadius: '8px',
        minHeight: '44px', padding: '10px 16px', font: 'inherit', fontSize: '14px',
        cursor: 'pointer', background: theme.colors.surfaceAlt,
        color: choice.style === 'destructive' ? theme.colors.danger : theme.colors.text,
      });
      button.addEventListener('click', () => finish(choice));
      actions.append(button);
    }
    dialog.append(actions);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (options?.cancelable !== false) finish(choices.find(({ style }) => style === 'cancel'), true);
    });
    document.body.append(dialog);
    dialog.showModal();
  },
};
