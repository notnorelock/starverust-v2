import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fontLoadTasks, type FontAsset } from './FontLoader';

/**
 * Vitest's specs run under Node (see vitest.config.ts's own doc comment), which has no
 * FontFace/document.fonts — these are real browser-only APIs. Stubbing them here (rather
 * than switching this whole suite to a jsdom environment just for this one spec) mirrors
 * how loadTexture()/TextureLoader's own tests would need to stub `Image` if they existed;
 * FontLoader's actual logic (constructing a FontFace, awaiting load(), registering it) is
 * what's under test, not the browser's real font parsing.
 */
class FakeFontFace {
  static instances: FakeFontFace[] = [];
  family: string;
  source: string;
  descriptors: FontFaceDescriptors | undefined;
  loadResult: Promise<FakeFontFace> = Promise.resolve(this);

  constructor(family: string, source: string, descriptors?: FontFaceDescriptors) {
    this.family = family;
    this.source = source;
    this.descriptors = descriptors;
    FakeFontFace.instances.push(this);
  }

  load(): Promise<this> {
    return this.loadResult as Promise<this>;
  }
}

describe('fontLoadTasks', () => {
  const addedFonts: unknown[] = [];

  beforeEach(() => {
    FakeFontFace.instances = [];
    addedFonts.length = 0;
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', { fonts: { add: (font: unknown) => addedFonts.push(font) } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns one LoadTask per font, named "font: <family>"', () => {
    const fonts: FontAsset[] = [
      { family: 'Pixel', url: '/fonts/pixel.woff2' },
      { family: 'Heading', url: '/fonts/heading.woff2' },
    ];

    const tasks = fontLoadTasks(fonts);

    expect(tasks.map((t) => t.name)).toEqual(['font: Pixel', 'font: Heading']);
  });

  it('returns an empty task list for an empty font list', () => {
    expect(fontLoadTasks([])).toEqual([]);
  });

  it('constructs a FontFace with the family, a url() source, and forwarded descriptors', async () => {
    const fonts: FontAsset[] = [{ family: 'Pixel', url: '/fonts/pixel.woff2', descriptors: { weight: '700' } }];

    await fontLoadTasks(fonts)[0]!.load();

    expect(FakeFontFace.instances).toHaveLength(1);
    const face = FakeFontFace.instances[0]!;
    expect(face.family).toBe('Pixel');
    expect(face.source).toBe('url(/fonts/pixel.woff2)');
    expect(face.descriptors).toEqual({ weight: '700' });
  });

  it('registers the loaded FontFace on document.fonts', async () => {
    const fonts: FontAsset[] = [{ family: 'Pixel', url: '/fonts/pixel.woff2' }];

    await fontLoadTasks(fonts)[0]!.load();

    expect(addedFonts).toHaveLength(1);
    expect(addedFonts[0]).toBe(FakeFontFace.instances[0]);
  });

  it('propagates a rejected FontFace.load() so AssetLoader records it as a failure', async () => {
    const fonts: FontAsset[] = [{ family: 'Broken', url: '/fonts/missing.woff2' }];
    const [task] = fontLoadTasks(fonts);

    FakeFontFace.instances = [];
    const originalLoad = FakeFontFace.prototype.load;
    FakeFontFace.prototype.load = () => Promise.reject(new Error('404'));

    await expect(task!.load()).rejects.toThrow('404');

    FakeFontFace.prototype.load = originalLoad;
  });
});
