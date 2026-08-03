// @ts-check
/**
 * Solid's own runtime convention, not a real DOM/Web API — so it's absent from Terser's
 * upstream domprops.js and would otherwise get mangled. Solid delegates certain event
 * types to a single document-level listener rather than attaching one per element (see
 * solid-js/web's DelegatedEvents set); a JSX `onInput={...}` prop compiles to a *static*
 * property write `node.$$input = handler`, while dispatch reads it back via a *computed*
 * key `node[`$$${event.type}`]` built from the live DOMEvent's type string at runtime.
 * Terser's property mangler can rename the static write (it's an ordinary-looking object
 * property) but can never see the computed read (it has no way to know the runtime string
 * value `$$input` a template literal will produce) — so if `$$input` isn't reserved, the
 * write goes to a mangled name nothing ever reads, and the handler silently never fires.
 * This bit real: a WelcomeOverlay text `<input>`'s onInput stopped firing in production
 * (dev build worked fine, since dev never mangles) because `$$input` got renamed but the
 * delegation lookup's computed key obviously didn't follow it.
 *
 * Each delegated event name also has a `Data`-suffixed sibling property
 * (`$$<event>Data`, read via a second computed key) that Solid uses for passing extra data
 * through `on:click={[handler, data]}`-style bindings — reserved here too even though this
 * codebase doesn't use that form today, since it's cheap insurance for the same failure
 * mode. Source list: solid-js/web's own `DelegatedEvents` (see node_modules/solid-js/web/dist/dev.js).
 */
const DELEGATED_EVENT_NAMES = [
  'beforeinput',
  'click',
  'dblclick',
  'contextmenu',
  'focusin',
  'focusout',
  'input',
  'keydown',
  'keyup',
  'mousedown',
  'mousemove',
  'mouseout',
  'mouseover',
  'mouseup',
  'pointerdown',
  'pointermove',
  'pointerout',
  'pointerover',
  'pointerup',
  'touchend',
  'touchmove',
  'touchstart',
];

module.exports = DELEGATED_EVENT_NAMES.flatMap((name) => [`$$${name}`, `$$${name}Data`]);
