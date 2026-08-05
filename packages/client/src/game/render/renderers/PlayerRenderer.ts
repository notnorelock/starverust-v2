import { EntityRenderer, type EntityRenderContext } from '../../../engine/render/renderers/EntityRenderer';
import type { CanvasContext2DProvider } from '../../../engine/render/CanvasContext2DProvider';
import { nicknameRegistry } from '../../network/NicknameRegistry';
import { chatBubbleOpacity, chatBubbleStore } from '../../network/ChatBubbleStore';

const PLAYER_RADIUS = 16;
const LOCAL_PLAYER_COLOR = '#7cffb2';
const REMOTE_PLAYER_COLOR = '#ff8a7c';
const AIM_LINE_LENGTH = PLAYER_RADIUS + 10;
const NICKNAME_OFFSET_Y = PLAYER_RADIUS + 16;

const CHAT_BUBBLE_FONT = '13px sans-serif';
const CHAT_BUBBLE_PADDING_X = 10;
const CHAT_BUBBLE_HEIGHT = 26;
const CHAT_BUBBLE_CORNER_RADIUS = 10;
const CHAT_BUBBLE_BACKGROUND = 'rgba(0, 0, 0, 0.5)';
const CHAT_BUBBLE_TEXT_COLOR = '#fff';
/** Base vertical offset (px, above the entity) of the closest (oldest, index-0) bubble — ported from the reference's `-110 * scale`. */
const CHAT_BUBBLE_BASE_OFFSET_Y = PLAYER_RADIUS + 60;

/**
 * Draws a player entity: a filled circle, a short line from its center pointing in its
 * current facing angle (see AimComponent/EntityRenderContext.angle — ported from the
 * reference client's mouse-driven `p.angle`/`p.nangle`, this is the visible payoff of that
 * angle actually reaching the client), its nickname centered above it (see
 * NicknameRegistry — falls back to nothing drawn if the nickname hasn't arrived yet, e.g.
 * a single frame right after EntityInsert but before PlayerJoin), and any queued chat
 * speech bubbles further above that (see ChatBubbleStore and drawChatBubbles() below —
 * ported from the reference client's `draw_chat()`, ChatBubbleStore's own doc comment
 * covers where this project's behavior deliberately diverges from it).
 */
export class PlayerRenderer extends EntityRenderer {
  constructor(private readonly canvasProvider: CanvasContext2DProvider) {
    super();
  }

  draw(context: EntityRenderContext): void {
    const { context: ctx } = this.canvasProvider;
    const { screen, angle, isLocalPlayer } = context;

    ctx.beginPath();
    ctx.fillStyle = isLocalPlayer ? LOCAL_PLAYER_COLOR : REMOTE_PLAYER_COLOR;
    ctx.arc(screen.x, screen.y, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = '#0b0f0d';
    ctx.lineWidth = 2;
    ctx.moveTo(screen.x, screen.y);
    ctx.lineTo(screen.x + Math.cos(angle) * AIM_LINE_LENGTH, screen.y + Math.sin(angle) * AIM_LINE_LENGTH);
    ctx.stroke();

    const nickname = nicknameRegistry().get(context.entityId);
    if (nickname) {
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f5f5f5';
      ctx.fillText(nickname, screen.x, screen.y - NICKNAME_OFFSET_Y);
    }

    this.drawChatBubbles(context);
  }

  /**
   * Draws every queued chat bubble for this entity, stacked above its head — index 0
   * (oldest) closest to the entity, later indices further out (see ChatBubbleStore's
   * stacking layout doc comment), each faded per chatBubbleOpacity(age) and positioned at
   * CHAT_BUBBLE_BASE_OFFSET_Y + its current eased renderOffset. A rounded-rect translucent
   * background behind white text, matching the reference's `create_message()` styling
   * (color/alpha/corner-radius), but drawn directly each frame instead of pre-baked onto an
   * offscreen canvas per message — this project's message volume doesn't need that
   * micro-optimization.
   */
  private drawChatBubbles(context: EntityRenderContext): void {
    const bubbles = chatBubbleStore().bubblesFor(context.entityId);
    if (bubbles.length === 0) {
      return;
    }

    const { context: ctx } = this.canvasProvider;
    const { screen } = context;

    ctx.font = CHAT_BUBBLE_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (const bubble of bubbles) {
      const opacity = chatBubbleOpacity(bubble.age);
      if (opacity <= 0) {
        continue;
      }

      const textWidth = ctx.measureText(bubble.text).width;
      const width = textWidth + CHAT_BUBBLE_PADDING_X * 2;
      const centerY = screen.y - CHAT_BUBBLE_BASE_OFFSET_Y - bubble.renderOffset;
      const left = screen.x - width / 2;
      const top = centerY - CHAT_BUBBLE_HEIGHT / 2;

      ctx.globalAlpha = opacity;

      ctx.beginPath();
      ctx.roundRect(left, top, width, CHAT_BUBBLE_HEIGHT, CHAT_BUBBLE_CORNER_RADIUS);
      ctx.fillStyle = CHAT_BUBBLE_BACKGROUND;
      ctx.fill();

      ctx.fillStyle = CHAT_BUBBLE_TEXT_COLOR;
      ctx.fillText(bubble.text, left + CHAT_BUBBLE_PADDING_X, centerY);
    }

    ctx.globalAlpha = 1;
  }
}
