import type { SpriteAsset } from '@starve/assets';
import type { LoadTask } from './AssetLoader';
import { loadTexture } from '../render/TextureLoader';

/**
 * Turns every discovered sprite asset (see @starve/assets's listSpriteAssets()) into a
 * LoadTask (see AssetLoader) that loads it as a WebGL texture and hands the result to
 * `onLoaded`, so the loading screen can enumerate and progress through "every sprite this
 * project bundles" generically instead of a fixed set of hand-written loadTexture() calls
 * that has to be kept in sync with @starve/assets's actual contents by hand.
 *
 * `onLoaded` is called synchronously once each texture finishes uploading — callers (see
 * ClientBootstrap) use it to populate whatever lookup structure (e.g. PlayerTextures) their
 * renderers read from, keeping this module ignorant of any specific renderer's shape.
 */
export function textureLoadTasks(
  gl: WebGL2RenderingContext,
  assets: readonly SpriteAsset[],
  onLoaded: (asset: SpriteAsset, texture: WebGLTexture) => void,
): LoadTask[] {
  return assets.map((asset) => ({
    name: `${asset.entityType}/${asset.variant}/${asset.part}`,
    load: async () => {
      const texture = await loadTexture(gl, asset.url);
      onLoaded(asset, texture);
    },
  }));
}
