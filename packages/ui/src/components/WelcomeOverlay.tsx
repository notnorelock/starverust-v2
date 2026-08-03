import { createSignal, Show, type Component } from 'solid-js';
import styles from './WelcomeOverlay.module.css';

const MIN_NICKNAME_LENGTH = 3;
const MAX_NICKNAME_LENGTH = 16;

export interface WelcomeOverlayProps {
  /** Called once with the trimmed, already-validated nickname when the player submits. */
  onPlay: (nickname: string) => void;
  /**
   * Set by the caller after a rejected connection attempt (see @starve/protocol's
   * RejectionReason) so the overlay can be shown again with an explanation, instead of the
   * player being left staring at a dead canvas with no idea what went wrong.
   */
  error?: string;
}

/**
 * Pure presentation: collects a nickname and calls onPlay with it. Knows nothing about
 * WebSockets, HelloPacket, or any other networking concern — @starve/client owns actually
 * connecting, sending Hello, and deciding what to do if the server rejects it (including
 * re-showing this component with `error` set). Keeping this package free of
 * @starve/protocol/@starve/client dependencies is deliberate: it's a reusable UI layer,
 * not a network client.
 */
export const WelcomeOverlay: Component<WelcomeOverlayProps> = (props) => {
  const [nickname, setNickname] = createSignal('');

  const trimmed = () => nickname().trim();
  const isValid = () => trimmed().length >= MIN_NICKNAME_LENGTH && trimmed().length <= MAX_NICKNAME_LENGTH;

  const submit = (event: Event) => {
    event.preventDefault();
    if (!isValid()) {
      return;
    }
    props.onPlay(trimmed());
  };

  return (
    <div class={styles.overlay}>
      <form class={styles.card} onSubmit={submit}>
        <h1 class={styles.title}>Starve</h1>
        <p class={styles.subtitle}>Survival MMO 2D</p>

        <label class={styles.label} for="nickname">
          Nickname
        </label>
        <input
          id="nickname"
          class={styles.input}
          type="text"
          autocomplete="off"
          maxLength={MAX_NICKNAME_LENGTH}
          placeholder="Enter a nickname"
          value={nickname()}
          onInput={(event) => setNickname(event.currentTarget.value)}
        />

        <Show when={props.error}>
          <p class={styles.error}>{props.error}</p>
        </Show>

        <button type="submit" class={styles.playButton} disabled={!isValid()}>
          Play
        </button>
      </form>
    </div>
  );
};
