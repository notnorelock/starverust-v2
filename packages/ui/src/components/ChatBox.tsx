import { createEffect, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import styles from './ChatBox.module.css';

const MAX_MESSAGE_LENGTH = 200;

export interface ChatBoxProps {
  /**
   * Whether chat can currently be opened — an accessor (not a plain boolean) so this
   * component reacts to it changing after mount, e.g. going from disconnected to connected
   * once Handshake arrives, or back to disconnected if the socket drops (see
   * @starve/client's index.ts, which derives this from GameClient's connection state).
   * While false: pressing Enter does nothing, and if the box happens to already be open
   * when this flips to false (a mid-chat disconnect), it's force-closed without sending.
   */
  enabled: () => boolean;
  /** Called whenever the box's open/closed state changes (Enter to open, Enter-to-send or Escape to close). */
  onOpenChange: (open: boolean) => void;
  /** Called once with the trimmed message text when the player submits a non-empty message. */
  onSend: (text: string) => void;
}

/**
 * Pure presentation, ported from the reference client's Enter-to-open/Enter-to-send/
 * Escape-to-cancel chat toggle (see client-old.js's `user.chat.run()`/`user.chat.quit()`):
 * the box is invisible and unfocused until the first Enter press anywhere on the page opens
 * it and focuses the input; a second Enter with text present sends it (calling onSend) and
 * closes the box; Escape closes without sending. Movement gating and actually transmitting
 * ChatMessagePacket are NOT this component's concern — see GameClient.setChatOpen()/
 * sendChatMessage(), called from the onOpenChange/onSend callbacks by whatever mounts this
 * (see @starve/client's index.ts) — mirroring how WelcomeOverlay knows nothing about
 * WebSockets/HelloPacket either.
 *
 * The Enter-to-open listener is global (window-level, like KeyboardInputSource) rather than
 * scoped to a focused element, since there's nothing to focus until chat is already open —
 * the very first Enter press is what creates that focus.
 */
export const ChatBox: Component<ChatBoxProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [text, setText] = createSignal('');
  let inputRef: HTMLInputElement | undefined;

  const openChat = () => {
    setOpen(true);
    props.onOpenChange(true);
    // Focus happens after the signal update re-renders the input into the DOM — queueMicrotask
    // lets that render settle first, same ordering concern WelcomeOverlay doesn't have to
    // worry about since its input is always mounted.
    queueMicrotask(() => inputRef?.focus());
  };

  const closeChat = () => {
    setOpen(false);
    setText('');
    props.onOpenChange(false);
    // The container hiding (opacity/pointer-events, see the .open CSS class) is purely
    // visual — without an explicit blur(), the <input> itself stays the DOM's activeElement,
    // so keystrokes (including typing and pressing Enter again) would keep going into the
    // now-invisible input instead of anywhere else, letting a message be composed and sent
    // with no visible box on screen.
    inputRef?.blur();
  };

  const submit = () => {
    const trimmed = text().trim();
    if (trimmed) {
      props.onSend(trimmed);
    }
    closeChat();
  };

  // Only opening lives here — once open, the input itself is focused, so Enter-to-send and
  // Escape-to-close are handled directly by the input's own onKeyDown below instead (which
  // is also why that handler's Enter case calls stopPropagation(): without it, the same
  // keydown that just closed the box via submit() would keep bubbling up to this listener
  // and, since open() already reads false by then, immediately reopen it in the same event
  // dispatch). Escape's onKeyDown deliberately does NOT stopPropagation() — there is no
  // Escape handling up here to double-fire, so nothing to guard against.
  const onWindowKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !open() && props.enabled()) {
      openChat();
    }
  };

  onMount(() => window.addEventListener('keydown', onWindowKeyDown));
  onCleanup(() => window.removeEventListener('keydown', onWindowKeyDown));

  // Handles disabling mid-chat (e.g. the connection drops while the box is open) — closing
  // here rather than just relying on the caller to also stop calling onSend, since a
  // player mid-keystroke has no other signal that their message can no longer go anywhere.
  createEffect(() => {
    if (!props.enabled() && open()) {
      closeChat();
    }
  });

  return (
    <div class={open() ? `${styles.container} ${styles.open}` : styles.container}>
      <input
        ref={inputRef}
        class={styles.input}
        type="text"
        autocomplete="off"
        maxLength={MAX_MESSAGE_LENGTH}
        placeholder="Press Enter to chat..."
        value={text()}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            // See onWindowKeyDown's own doc comment for why this stopPropagation() is
            // required — without it, sending would immediately reopen the box.
            event.stopPropagation();
            submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            closeChat();
          }
        }}
      />
    </div>
  );
};
