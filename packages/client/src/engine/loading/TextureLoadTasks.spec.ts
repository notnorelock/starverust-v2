import { describe, expect, it, vi } from 'vitest';
import type { SpriteAsset } from '@starve/assets';

const loadTextureMock = vi.fn();
vi.mock('../render/TextureLoader', () => ({
  loadTexture: (...args: unknown[]) => loadTextureMock(...args),
}));

// Imported after the mock so textureLoadTasks() picks up the mocked loadTexture — Vitest
// hoists vi.mock() calls above imports automatically, but the dynamic import here makes the
// ordering explicit rather than relying on that hoisting behavior for a same-file mock.
const { textureLoadTasks } = await import('./TextureLoadTasks');

const FAKE_GL = {} as WebGL2RenderingContext;

function asset(overrides: Partial<SpriteAsset> = {}): SpriteAsset {
  return { entityType: 'player', variant: 'day', part: 'default_head', url: '/sprites/head.png', ...overrides };
}

describe('textureLoadTasks', () => {
  it('names each task "entityType/variant/part"', () => {
    const assets = [asset({ entityType: 'player', variant: 'night', part: 'default_left_arm' })];

    const tasks = textureLoadTasks(FAKE_GL, assets, () => {});

    expect(tasks.map((t) => t.name)).toEqual(['player/night/default_left_arm']);
  });

  it('returns an empty task list for an empty asset list', () => {
    expect(textureLoadTasks(FAKE_GL, [], () => {})).toEqual([]);
  });

  it('loads the texture via loadTexture(gl, asset.url) and forwards the result to onLoaded', async () => {
    const fakeTexture = {} as WebGLTexture;
    loadTextureMock.mockResolvedValueOnce(fakeTexture);
    const onLoaded = vi.fn();
    const theAsset = asset({ url: '/sprites/head.png' });

    const [task] = textureLoadTasks(FAKE_GL, [theAsset], onLoaded);
    await task!.load();

    expect(loadTextureMock).toHaveBeenCalledWith(FAKE_GL, '/sprites/head.png');
    expect(onLoaded).toHaveBeenCalledWith(theAsset, fakeTexture);
  });

  it('propagates a rejected loadTexture() so AssetLoader records it as a failure', async () => {
    loadTextureMock.mockRejectedValueOnce(new Error('404'));
    const onLoaded = vi.fn();

    const [task] = textureLoadTasks(FAKE_GL, [asset()], onLoaded);

    await expect(task!.load()).rejects.toThrow('404');
    expect(onLoaded).not.toHaveBeenCalled();
  });
});
