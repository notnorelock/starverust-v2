import { EntityRenderer, type EntityRenderContext } from './EntityRenderer';
import type { CanvasContext2DProvider } from '../CanvasContext2DProvider';
import type { NicknameRegistry } from '../../network/NicknameRegistry';

const PLAYER_RADIUS = 16;
const LOCAL_PLAYER_COLOR = '#7cffb2';
const REMOTE_PLAYER_COLOR = '#ff8a7c';
const AIM_LINE_LENGTH = PLAYER_RADIUS + 10;
const NICKNAME_OFFSET_Y = PLAYER_RADIUS + 16;

/**
 * Draws a player entity: a filled circle, a short line from its center pointing in its
 * current facing angle (see AimComponent/EntityRenderContext.angle — ported from the
 * reference client's mouse-driven `p.angle`/`p.nangle`, this is the visible payoff of that
 * angle actually reaching the client), and its nickname centered above it (see
 * NicknameRegistry — falls back to nothing drawn if the nickname hasn't arrived yet, e.g.
 * a single frame right after EntityInsert but before PlayerJoin).
 */
export class PlayerRenderer extends EntityRenderer {
  constructor(
    private readonly canvasProvider: CanvasContext2DProvider,
    private readonly nicknames: NicknameRegistry,
  ) {
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

    const nickname = this.nicknames.get(context.entityId);
    if (nickname) {
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f5f5f5';
      ctx.fillText(nickname, screen.x, screen.y - NICKNAME_OFFSET_Y);
    }
  }
}
