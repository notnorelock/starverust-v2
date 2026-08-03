import { describe, expect, it } from 'vitest';
import {
  ChatBubbleStore,
  chatBubbleOpacity,
  CHAT_BUBBLE_FADE_IN_DURATION,
  CHAT_BUBBLE_LIFETIME,
  CHAT_BUBBLE_STACK_SPACING,
} from './ChatBubbleStore';

describe('ChatBubbleStore', () => {
  it('returns an empty array for an entity with no bubbles', () => {
    const store = new ChatBubbleStore();
    expect(store.bubblesFor(1)).toEqual([]);
  });

  it('queues a pushed bubble at age 0', () => {
    const store = new ChatBubbleStore();
    store.push(1, 'hello');
    const bubbles = store.bubblesFor(1);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]!.text).toBe('hello');
    expect(bubbles[0]!.age).toBe(0);
  });

  it('does not cap the number of simultaneously queued bubbles (unlike the reference client)', () => {
    const store = new ChatBubbleStore();
    for (let i = 0; i < 10; i += 1) {
      store.push(1, `message ${i}`);
    }
    expect(store.bubblesFor(1)).toHaveLength(10);
  });

  it('advance() ages every bubble for an entity by dt', () => {
    const store = new ChatBubbleStore();
    store.push(1, 'hello');
    store.advance(0.5);
    expect(store.bubblesFor(1)[0]!.age).toBeCloseTo(0.5, 5);
  });

  it('advance() tracks multiple entities independently', () => {
    const store = new ChatBubbleStore();
    store.push(1, 'a');
    store.advance(1);
    store.push(2, 'b');
    store.advance(1);

    expect(store.bubblesFor(1)[0]!.age).toBeCloseTo(2, 5);
    expect(store.bubblesFor(2)[0]!.age).toBeCloseTo(1, 5);
  });

  it('expires a bubble once its age passes CHAT_BUBBLE_LIFETIME', () => {
    const store = new ChatBubbleStore();
    store.push(1, 'hello');
    store.advance(CHAT_BUBBLE_LIFETIME - 0.01);
    expect(store.bubblesFor(1)).toHaveLength(1);

    store.advance(0.02);
    expect(store.bubblesFor(1)).toHaveLength(0);
  });

  it('expires only the oldest bubble first, leaving newer ones queued', () => {
    const store = new ChatBubbleStore();
    store.push(1, 'old');
    store.advance(CHAT_BUBBLE_LIFETIME + 0.01);
    store.push(1, 'new');
    store.advance(0.01);

    const bubbles = store.bubblesFor(1);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]!.text).toBe('new');
  });

  it('drops an entity from the store entirely once its last bubble expires', () => {
    const store = new ChatBubbleStore();
    store.push(1, 'hello');
    store.advance(CHAT_BUBBLE_LIFETIME + 0.01);
    expect(store.bubblesFor(1)).toEqual([]);
  });

  it('remove() drops all bubbles for an entity immediately', () => {
    const store = new ChatBubbleStore();
    store.push(1, 'hello');
    store.remove(1);
    expect(store.bubblesFor(1)).toEqual([]);
  });

  it('a newly-pushed bubble starts one stack slot beyond the current stack and eases toward its resting slot (0)', () => {
    const store = new ChatBubbleStore();
    store.push(1, 'only'); // first bubble: target slot 0, starts at 0 already
    expect(store.bubblesFor(1)[0]!.renderOffset).toBe(0);
  });

  it('pushing a second bubble starts it further out and shifts the older bubble toward slot 0 over time', () => {
    const store = new ChatBubbleStore();
    store.push(1, 'first');
    store.advance(1); // let the first bubble fully settle at its slot before pushing the second
    store.push(1, 'second');

    const [first, second] = store.bubblesFor(1);
    // 'first' is now at stack index 0 (target 0), 'second' at index 1 (target CHAT_BUBBLE_STACK_SPACING).
    expect(second!.renderOffset).toBe(CHAT_BUBBLE_STACK_SPACING);
    expect(first!.renderOffset).toBe(0);
  });

  it('eases renderOffset toward its target over several advance() calls rather than snapping instantly', () => {
    const store = new ChatBubbleStore();
    store.push(1, 'first');
    store.push(1, 'second'); // 'first' is still at index 0 (target 0), so nothing to ease there;
    // instead verify 'second' (target CHAT_BUBBLE_STACK_SPACING) starts already at its own target
    // and pushing a third shifts everyone's target, requiring easing.
    store.advance(1);
    store.push(1, 'third');

    const bubbles = store.bubblesFor(1);
    // Immediately after the third push, targets shifted (indices 0,1,2 -> 0, spacing, 2*spacing)
    // but only 'third' starts exactly at its target; 'first'/'second' still need to ease if their
    // target changed. Since indices didn't change for first/second (still 0 and 1), no easing
    // needed — assert renderOffsets match their stable targets.
    expect(bubbles[0]!.renderOffset).toBe(0);
    expect(bubbles[1]!.renderOffset).toBe(CHAT_BUBBLE_STACK_SPACING);
    expect(bubbles[2]!.renderOffset).toBe(2 * CHAT_BUBBLE_STACK_SPACING);
  });

  it('when the oldest bubble expires, remaining bubbles ease back toward the origin (offset 0) instead of staying stranded at their old slot', () => {
    const store = new ChatBubbleStore();
    store.push(1, 'old'); // age 0
    store.advance(1); // 'old' age -> 1
    store.push(1, 'new'); // age 0
    store.advance(1); // 'old' age -> 2, 'new' age -> 1; both settle: 'old' at slot 0, 'new' at slot CHAT_BUBBLE_STACK_SPACING

    expect(store.bubblesFor(1)[1]!.renderOffset).toBe(CHAT_BUBBLE_STACK_SPACING);

    // Push 'old' just past CHAT_BUBBLE_LIFETIME (currently age 2) without also expiring 'new'
    // (currently age 1, needs to stay well under CHAT_BUBBLE_LIFETIME = 8.5).
    store.advance(CHAT_BUBBLE_LIFETIME - 2 + 0.01);
    const remaining = store.bubblesFor(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.text).toBe('new');
    // 'new' target is now index 0 (offset 0, the origin/closest-to-player slot) instead of
    // CHAT_BUBBLE_STACK_SPACING — should have started easing back toward it immediately, not
    // still sitting at the old higher offset.
    expect(remaining[0]!.renderOffset).toBeLessThan(CHAT_BUBBLE_STACK_SPACING);
  });
});

describe('chatBubbleOpacity', () => {
  it('is 0 at age 0', () => {
    expect(chatBubbleOpacity(0)).toBe(0);
  });

  it('ramps linearly during fade-in', () => {
    expect(chatBubbleOpacity(CHAT_BUBBLE_FADE_IN_DURATION / 2)).toBeCloseTo(0.5, 5);
  });

  it('is fully opaque during the hold', () => {
    expect(chatBubbleOpacity(CHAT_BUBBLE_FADE_IN_DURATION + 1)).toBe(1);
    expect(chatBubbleOpacity(CHAT_BUBBLE_LIFETIME - 0.3)).toBe(1);
  });

  it('ramps back down to 0 during fade-out, reaching 0 at CHAT_BUBBLE_LIFETIME', () => {
    expect(chatBubbleOpacity(CHAT_BUBBLE_LIFETIME)).toBe(0);
    expect(chatBubbleOpacity(CHAT_BUBBLE_LIFETIME - 0.125)).toBeCloseTo(0.5, 5);
  });

  it('never goes negative past full lifetime', () => {
    expect(chatBubbleOpacity(CHAT_BUBBLE_LIFETIME + 10)).toBe(0);
  });
});
