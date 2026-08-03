/**
 * A single queued chat bubble for one entity. `age` is seconds elapsed since the message
 * was pushed (drives fade in/hold/fade out — see chatBubbleOpacity()); `renderOffset` is
 * this bubble's current eased vertical offset (px, above the entity), chasing its target
 * stacked slot every frame — see advanceChatBubbles()'s own doc comment for why this eases
 * rather than snaps.
 */
export interface ChatBubble {
  text: string;
  age: number;
  renderOffset: number;
}

/** Total seconds a bubble is visible for — fade-in + hold + fade-out (see chatBubbleOpacity()). */
export const CHAT_BUBBLE_FADE_IN_DURATION = 0.25;
export const CHAT_BUBBLE_HOLD_DURATION = 8;
export const CHAT_BUBBLE_FADE_OUT_DURATION = 0.25;
export const CHAT_BUBBLE_LIFETIME =
  CHAT_BUBBLE_FADE_IN_DURATION + CHAT_BUBBLE_HOLD_DURATION + CHAT_BUBBLE_FADE_OUT_DURATION;

/** Vertical spacing (px) between stacked bubbles, and how fast a bubble eases toward its stacked slot when the stack shifts — see advanceChatBubbles(). */
export const CHAT_BUBBLE_STACK_SPACING = 30;
const SLIDE_EASE_SPEED = 8;

/**
 * Per-entity queues of chat speech bubbles — ported from the reference client's per-unit
 * `text`/`text_effect`/`label` arrays (see client-old.js's `draw_chat()`), but deliberately
 * diverging from it in two ways per this project's own requirements: bubbles are NOT capped
 * at 2 visible (every pushed message stacks and is drawn until it individually expires,
 * however many are queued), and the hold duration is 8s instead of the reference's ~3.5s
 * (see CHAT_BUBBLE_HOLD_DURATION). The fade timing shape and the slide-up-when-a-newer-
 * message-arrives animation are kept faithful to the reference (see chatBubbleOpacity()/
 * advanceChatBubbles()).
 *
 * Isolated from RenderSystem/PlayerRenderer the same way SnapshotBuffer/NicknameRegistry
 * are, so it can be unit-tested without a full World/render stack — RenderSystem calls
 * advance(dt) once per frame and PlayerRenderer reads bubblesFor(entityId) to draw.
 */
export class ChatBubbleStore {
  private readonly bubblesByEntityId = new Map<number, ChatBubble[]>();

  /**
   * Queues a new bubble for `entityId`, appended after any already-queued ones — its
   * renderOffset starts one stack slot further out than the current newest bubble's target
   * (see advanceChatBubbles()) so it visually slides into place from "further away" rather
   * than popping in already at its resting position.
   */
  push(entityId: number, text: string): void {
    const bubbles = this.bubblesByEntityId.get(entityId);
    const startOffset = bubbles ? bubbles.length * CHAT_BUBBLE_STACK_SPACING : 0;
    const bubble: ChatBubble = { text, age: 0, renderOffset: startOffset };
    if (bubbles) {
      bubbles.push(bubble);
    } else {
      this.bubblesByEntityId.set(entityId, [bubble]);
    }
  }

  /** All currently-queued bubbles for `entityId`, oldest first — empty array if none. */
  bubblesFor(entityId: number): readonly ChatBubble[] {
    return this.bubblesByEntityId.get(entityId) ?? [];
  }

  /** Drops an entity's bubbles entirely — called on EntityDestroyPacket, mirroring SnapshotBuffer.remove()/EntityTypeRegistry.remove(). */
  remove(entityId: number): void {
    this.bubblesByEntityId.delete(entityId);
  }

  /**
   * Advances every entity's bubble queue by `dt` seconds: ages each bubble (driving its
   * fade — see chatBubbleOpacity()), eases each bubble's renderOffset toward its current
   * stacked target slot (see advanceChatBubbles()), and drops any bubble that's aged past
   * CHAT_BUBBLE_LIFETIME. Called once per frame from RenderSystem, the same "advance during
   * the render pass" shape SnapshotBuffer.sample(dt) already uses for position/angle
   * chasing.
   */
  advance(dt: number): void {
    for (const [entityId, bubbles] of this.bubblesByEntityId) {
      advanceChatBubbles(bubbles, dt);
      if (bubbles.length === 0) {
        this.bubblesByEntityId.delete(entityId);
      }
    }
  }
}

/**
 * Ages every bubble in `bubbles` by `dt`, eases each bubble's `renderOffset` toward its
 * target stacked slot, and removes any bubble whose age has passed CHAT_BUBBLE_LIFETIME —
 * mutates `bubbles` in place (shifting expired entries off the front, since they're always
 * the oldest).
 *
 * Stacking layout: index 0 (oldest) sits at offset 0 (closest to the entity — matches the
 * reference's newest-closest ordering being inverted here since ours draws oldest-on-top
 * isn't required; what matters is each bubble has a stable, distinct slot), each later
 * index one CHAT_BUBBLE_STACK_SPACING further out. When the stack's length changes (a
 * bubble pushed or expired), every remaining bubble's target slot shifts, and this eases
 * `renderOffset` toward the new target rather than snapping — ported from the reference's
 * `Utils.ease_in_out_quad(this.text_ease) * 30` slide when a 2nd bubble appeared, but
 * generalized here to any stack depth via a plain per-bubble chase instead of one shared
 * ease value (which only worked because the reference capped at 2 bubbles).
 */
function advanceChatBubbles(bubbles: ChatBubble[], dt: number): void {
  for (const bubble of bubbles) {
    bubble.age += dt;
  }

  // Expiry happens before easing (not after) so a bubble that expires this frame is already
  // out of the array when remaining bubbles' target slots are computed below — otherwise
  // the survivors' easing would target their stale pre-expiry slot for one extra frame.
  while (bubbles.length > 0 && bubbles[0]!.age >= CHAT_BUBBLE_LIFETIME) {
    bubbles.shift();
  }

  const step = SLIDE_EASE_SPEED * CHAT_BUBBLE_STACK_SPACING * dt;
  bubbles.forEach((bubble, index) => {
    const target = index * CHAT_BUBBLE_STACK_SPACING;
    const diff = target - bubble.renderOffset;
    if (Math.abs(diff) <= step) {
      bubble.renderOffset = target;
    } else {
      bubble.renderOffset += Math.sign(diff) * step;
    }
  });
}

/**
 * Opacity (0..1) for a bubble of the given `age`, in seconds — ported directly from the
 * reference client's `draw_chat()` alpha computation: linear fade-in over the first
 * CHAT_BUBBLE_FADE_IN_DURATION seconds, fully opaque through the hold, linear fade-out over
 * the final CHAT_BUBBLE_FADE_OUT_DURATION seconds before CHAT_BUBBLE_LIFETIME.
 */
export function chatBubbleOpacity(age: number): number {
  if (age < CHAT_BUBBLE_FADE_IN_DURATION) {
    return age / CHAT_BUBBLE_FADE_IN_DURATION;
  }
  const fadeOutStart = CHAT_BUBBLE_LIFETIME - CHAT_BUBBLE_FADE_OUT_DURATION;
  if (age > fadeOutStart) {
    return Math.max((CHAT_BUBBLE_LIFETIME - age) / CHAT_BUBBLE_FADE_OUT_DURATION, 0);
  }
  return 1;
}
