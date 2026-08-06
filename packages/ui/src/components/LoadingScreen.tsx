import { Show, type Component } from 'solid-js';
import styles from './LoadingScreen.module.css';

export interface LoadingScreenProps {
  /** How many of `total` load tasks (sprite textures, fonts, ...) have finished so far. */
  loaded: () => number;
  total: () => number;
  /** Name of the asset currently in flight (see @starve/client's LoadTask.name), or undefined once everything has settled. */
  current: () => string | undefined;
  /**
   * Set if loading finished with one or more failures (see AssetLoader's AggregateError) —
   * shown instead of silently proceeding, since a missing sprite/font is a real problem the
   * player (or at least a developer) should notice rather than one that quietly renders
   * broken/blank.
   */
  error?: () => string | undefined;
}

/**
 * Pure presentation, styled to match WelcomeOverlay (same card/overlay treatment) so the two
 * feel like one continuous startup sequence rather than visually unrelated screens. Knows
 * nothing about WebGL/textures/fonts — @starve/client's asset loading pipeline (AssetLoader,
 * TextureLoadTasks, FontLoader) owns actually loading anything and just reports progress
 * through these accessors, the same separation WelcomeOverlay keeps from networking.
 */
export const LoadingScreen: Component<LoadingScreenProps> = (props) => {
  const percent = () => {
    const total = props.total();
    return total > 0 ? Math.round((props.loaded() / total) * 100) : 100;
  };

  return (
    <div class={styles.overlay}>
      <div class={styles.card}>
        <h1 class={styles.title}>Starve</h1>
        <p class={styles.subtitle}>Loading assets…</p>

        <div class={styles.track}>
          <div class={styles.fill} style={{ width: `${percent()}%` }} />
        </div>

        <div class={styles.status}>
          <span class={styles.current}>{props.current() ?? 'Done'}</span>
          <span>
            {props.loaded()}/{props.total()}
          </span>
        </div>

        <Show when={props.error?.()}>
          <p class={styles.error}>{props.error?.()}</p>
        </Show>
      </div>
    </div>
  );
};
