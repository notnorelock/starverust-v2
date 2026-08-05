import { EntityRenderer, type EntityRenderContext } from '../../../engine/render/renderers/EntityRenderer';
import type { SpriteRenderer } from '../../../engine/render/SpriteRenderer';
import type { TextTextureCache } from '../../../engine/render/TextTextureCache';
import { nicknameRegistry } from '../../network/NicknameRegistry';
import { chatBubbleOpacity, chatBubbleStore } from '../../network/ChatBubbleStore';

/** Native pixel dimensions of the source art (see packages/assets/src/player/{day,night}/*.png) — offsets/scale below are derived from these, not guessed. */
const HEAD_NATIVE_SIZE = { width: 176, height: 152 };
const ARM_NATIVE_SIZE = { width: 54, height: 63 };

/** On-screen head width in pixels — everything else (head height, arm size/offsets) scales off this to keep the source art's proportions. */
const HEAD_DRAW_WIDTH = 70;
const SCALE = HEAD_DRAW_WIDTH / HEAD_NATIVE_SIZE.width;
const HEAD_DRAW_HEIGHT = HEAD_NATIVE_SIZE.height * SCALE;
const ARM_DRAW_WIDTH = ARM_NATIVE_SIZE.width * SCALE;
const ARM_DRAW_HEIGHT = ARM_NATIVE_SIZE.height * SCALE;

/** Arm center offset from the entity's origin, before the whole group is rotated to face the aim angle — arms sit slightly behind and to either side of the head. */
const ARM_OFFSET_X = HEAD_DRAW_WIDTH * 0.64;
const ARM_OFFSET_Y = HEAD_DRAW_HEIGHT * 0.36;

/**
 * The head/arm art (see packages/assets/src/player/{day,night}/*.png) is authored facing
 * UP (the character's front is toward the top of the image, unrotated) — but this
 * project's angle convention (see MouseInputSource.sample()'s atan2(dy,dx)) treats
 * `angle=0` as facing along +x (RIGHT), matching Camera2D's screen-space axes. Without
 * this offset, `angle=0` would render the art's front pointing right anyway (since
 * SpriteRenderer.draw() rotates around the quad's own center with no inherent "up" bias),
 * but a 90°/180°/270° turn would show the art rotated relative to the actual cursor
 * direction — e.g. the character appearing to face down when the cursor is to the left.
 * Adding this constant to every rotation value re-aligns the art's authored "up = front"
 * with the angle convention's "0 = right", so `angle=0` (mouse right) shows the front
 * facing right, `angle=π/2` (mouse below) shows it facing down, etc. — verified against
 * this project's actual atan2(dy,dx) values logged at runtime, not assumed.
 */
const SPRITE_FACING_OFFSET = -Math.PI / 2;

const NICKNAME_OFFSET_Y = HEAD_DRAW_HEIGHT / 2 + 16;
const NICKNAME_FONT = '13px sans-serif';
const NICKNAME_COLOR = '#f5f5f5';

const CHAT_BUBBLE_FONT = '13px sans-serif';
const CHAT_BUBBLE_TEXT_COLOR = '#fff';
const CHAT_BUBBLE_PADDING_X = 10;
/** Base vertical offset (px, above the entity) of the closest (oldest, index-0) bubble — ported from the reference's `-110 * scale`. */
const CHAT_BUBBLE_BASE_OFFSET_Y = HEAD_DRAW_HEIGHT / 2 + 60;

export type PlayerVariant = 'day' | 'night';

export interface PlayerTextures {
  head: WebGLTexture | undefined;
  leftArm: WebGLTexture | undefined;
  rightArm: WebGLTexture | undefined;
}

/**
 * Draws a player entity composited from three separate part sprites (head, left arm,
 * right arm — see @starve/assets's spritePartUrl and ClientBootstrap's texture loads),
 * each its own quad offset from the entity's center and rotated together to face the aim
 * angle — arms are drawn first (behind), head last (in front), matching the source art's
 * intended layering. There's no independent per-limb animation yet (e.g. arms swinging
 * while walking): all three parts share exactly the same rotation and move together as one
 * rigid group, the direct sprite-based equivalent of the old single circle+facing-line
 * always pointing at the aim angle. A future walk-cycle/attack-animation system would give
 * the arms their own offset/rotation relative to the group instead of a fixed one.
 *
 * Also draws the entity's nickname centered above it (see NicknameRegistry — falls back to
 * nothing drawn if the nickname hasn't arrived yet, e.g. a single frame right after
 * EntityInsert but before PlayerJoin), and any queued chat speech bubbles further above
 * that (see ChatBubbleStore and drawChatBubbles() below — ported from the reference
 * client's `draw_chat()`, ChatBubbleStore's own doc comment covers where this project's
 * behavior deliberately diverges from it).
 *
 * All drawing — sprite parts, nickname text, chat bubble text — goes through the same
 * SpriteRenderer.draw() textured-quad call; nickname/chat text is baked to a texture via
 * TextTextureCache rather than a separate Canvas2D layer, since this project renders to a
 * single WebGL `<canvas>` (see WebGLCanvasProvider's own doc comment for why).
 */
export class PlayerRenderer extends EntityRenderer {
  constructor(
    private readonly sprites: SpriteRenderer,
    private readonly textCache: TextTextureCache,
    private readonly textures: () => PlayerTextures,
  ) {
    super();
  }

  draw(context: EntityRenderContext): void {
    const { screen, angle } = context;
    const textures = this.textures();
    const renderRotation = angle + SPRITE_FACING_OFFSET;

    const cos = Math.cos(renderRotation);
    const sin = Math.sin(renderRotation);
    // Rotates a part's (offsetX, offsetY) around the entity's origin by the same angle the
    // whole group faces — offsets are authored in the entity's own unrotated local space
    // (arms to either side, before facing direction is applied). Uses renderRotation (not
    // the raw angle) so the arms' positions stay consistent with the head/art's actual
    // rendered facing direction — see SPRITE_FACING_OFFSET's own doc comment.
    const rotateOffset = (offsetX: number, offsetY: number): { x: number; y: number } => ({
      x: screen.x + offsetX * cos - offsetY * sin,
      y: screen.y + offsetX * sin + offsetY * cos,
    });

    if (textures.leftArm) {
      // Offsets are in screen space AFTER SPRITE_FACING_OFFSET is already baked into
      // renderRotation/rotateOffset — so "-ARM_OFFSET_X, +ARM_OFFSET_Y" here is what lands
      // on the character's own left (viewer's left when facing the viewer) at angle=0, not
      // a naive pre-rotation "-X = left" assumption. Verified empirically against the
      // actual rendered output (the two textures were swapped before this).
      const armCenter = rotateOffset(ARM_OFFSET_X, ARM_OFFSET_Y);
      this.sprites.draw({
        texture: textures.leftArm,
        x: armCenter.x - ARM_DRAW_WIDTH / 2,
        y: armCenter.y - ARM_DRAW_HEIGHT / 2,
        width: ARM_DRAW_WIDTH,
        height: ARM_DRAW_HEIGHT,
        rotation: renderRotation,
      });
    }
    if (textures.rightArm) {
      const armCenter = rotateOffset(-ARM_OFFSET_X, ARM_OFFSET_Y);
      this.sprites.draw({
        texture: textures.rightArm,
        x: armCenter.x - ARM_DRAW_WIDTH / 2,
        y: armCenter.y - ARM_DRAW_HEIGHT / 2,
        width: ARM_DRAW_WIDTH,
        height: ARM_DRAW_HEIGHT,
        rotation: renderRotation,
      });
    }
    if (textures.head) {
      this.sprites.draw({
        texture: textures.head,
        x: screen.x - HEAD_DRAW_WIDTH / 2,
        y: screen.y - HEAD_DRAW_HEIGHT / 2,
        width: HEAD_DRAW_WIDTH,
        height: HEAD_DRAW_HEIGHT,
        rotation: renderRotation,
      });
    }

    const nickname = nicknameRegistry().get(context.entityId);
    if (nickname) {
      this.drawText(nickname, NICKNAME_FONT, NICKNAME_COLOR, screen.x, screen.y - NICKNAME_OFFSET_Y, 'center', 1);
    }

    this.drawChatBubbles(context);
  }

  /**
   * Draws every queued chat bubble for this entity, stacked above its head — index 0
   * (oldest) closest to the entity, later indices further out (see ChatBubbleStore's
   * stacking layout doc comment), each faded per chatBubbleOpacity(age) and positioned at
   * CHAT_BUBBLE_BASE_OFFSET_Y + its current eased renderOffset. The rounded-rect background
   * bubble behind the text is gone for now (Canvas2D's roundRect()/fillRect() has no direct
   * WebGL equivalent without another shader) — only the baked text itself draws; a
   * background quad can come back later as its own small colored-quad draw (no texture
   * needed) once solid-color quad drawing is added alongside textured ones.
   */
  private drawChatBubbles(context: EntityRenderContext): void {
    const bubbles = chatBubbleStore().bubblesFor(context.entityId);
    if (bubbles.length === 0) {
      return;
    }

    const { screen } = context;

    for (const bubble of bubbles) {
      const opacity = chatBubbleOpacity(bubble.age);
      if (opacity <= 0) {
        continue;
      }

      const centerY = screen.y - CHAT_BUBBLE_BASE_OFFSET_Y - bubble.renderOffset;
      this.drawText(bubble.text, CHAT_BUBBLE_FONT, CHAT_BUBBLE_TEXT_COLOR, screen.x, centerY, 'left', opacity);
    }
  }

  private drawText(
    text: string,
    font: string,
    color: string,
    x: number,
    y: number,
    align: 'left' | 'center',
    opacity: number,
  ): void {
    const baked = this.textCache.get(text, font, color);
    const left = align === 'center' ? x - baked.width / 2 : x + CHAT_BUBBLE_PADDING_X;
    const top = y - baked.height / 2;

    this.sprites.draw({
      texture: baked.texture,
      x: left,
      y: top,
      width: baked.width,
      height: baked.height,
      opacity,
    });
  }
}
