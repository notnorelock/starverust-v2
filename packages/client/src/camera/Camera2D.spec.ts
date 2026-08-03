import { describe, expect, it } from 'vitest';
import { Camera2D } from './Camera2D';

/** Advances the camera's follow easing to completion in one step. */
function settle(camera: Camera2D): void {
  camera.update(10);
}

describe('Camera2D', () => {
  it('follows the target directly with no bounds set', () => {
    const camera = new Camera2D(800, 600);
    camera.follow(100, 50);
    settle(camera);
    expect(camera.x).toBeCloseTo(100, 5);
    expect(camera.y).toBeCloseTo(50, 5);
  });

  it('clamps so the viewport edge, not just the followed point, stays inside world bounds', () => {
    const camera = new Camera2D(800, 600);
    camera.setBounds({ minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 });

    // Player standing exactly on the right edge of the world.
    camera.follow(1000, 0);
    settle(camera);

    // The camera's own position must stop short of the raw edge by half the viewport
    // width, so worldToScreen's right edge (camera.x + viewportWidth/2) lands exactly on
    // maxX instead of viewportWidth/2 past it into empty space.
    const halfWidth = 800 / 2;
    expect(camera.x).toBeCloseTo(1000 - halfWidth, 5);

    const screen = camera.worldToScreen(1000, 0);
    expect(screen.x).toBeCloseTo(800, 5); // right edge of the canvas, not beyond it
  });

  it('clamps symmetrically at the opposite (left/top) edge', () => {
    const camera = new Camera2D(800, 600);
    camera.setBounds({ minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 });

    camera.follow(-1000, 0);
    settle(camera);

    const halfWidth = 800 / 2;
    expect(camera.x).toBeCloseTo(-1000 + halfWidth, 5);

    const screen = camera.worldToScreen(-1000, 0);
    expect(screen.x).toBeCloseTo(0, 5); // left edge of the canvas, not before it
  });

  it('clamps on the Y axis the same way', () => {
    const camera = new Camera2D(800, 600);
    camera.setBounds({ minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 });

    camera.follow(0, 1000);
    settle(camera);

    const halfHeight = 600 / 2;
    expect(camera.y).toBeCloseTo(1000 - halfHeight, 5);
  });

  it('does not clamp when the target is well within bounds (away from any edge)', () => {
    const camera = new Camera2D(800, 600);
    camera.setBounds({ minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 });

    camera.follow(50, -25);
    settle(camera);

    expect(camera.x).toBeCloseTo(50, 5);
    expect(camera.y).toBeCloseTo(-25, 5);
  });

  it('accounts for zoom when computing the viewport half-extent', () => {
    const camera = new Camera2D(800, 600);
    camera.setBounds({ minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 });
    camera.zoom = 2; // shows half as much world per screen pixel

    camera.follow(1000, 0);
    settle(camera);

    const halfWidthAtZoom = 800 / 2 / 2;
    expect(camera.x).toBeCloseTo(1000 - halfWidthAtZoom, 5);
  });

  it('falls back to a plain [min, max] clamp when the world is narrower than the viewport', () => {
    const camera = new Camera2D(800, 600);
    // World is only 200 units wide — narrower than the 800px viewport.
    camera.setBounds({ minX: -100, maxX: 100, minY: -100, maxY: 100 });

    camera.follow(100, 0);
    settle(camera);

    // Half-viewport clamping would invert (min+halfWidth > max-halfWidth); falls back to
    // clamping the raw target to the world bounds instead of an inverted/nonsensical range.
    expect(camera.x).toBeLessThanOrEqual(100);
    expect(camera.x).toBeGreaterThanOrEqual(-100);
  });
});
