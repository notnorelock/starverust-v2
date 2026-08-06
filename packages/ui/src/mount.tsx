import { render } from 'solid-js/web';
import { WelcomeOverlay, type WelcomeOverlayProps } from './components/WelcomeOverlay';
import { ChatBox, type ChatBoxProps } from './components/ChatBox';
import { LoadingScreen, type LoadingScreenProps } from './components/LoadingScreen';

/**
 * Mounts WelcomeOverlay into `container` and returns an unmount function — wraps
 * solid-js/web's render() so consumers (packages/client) don't need their own direct
 * dependency on Solid's mounting API just to show one overlay. Renders via JSX (not a bare
 * WelcomeOverlay(props) call) so Solid's fine-grained reactivity on `props` stays intact —
 * calling a component as a plain function bypasses the prop-getter wrapping JSX provides.
 */
export function mountWelcomeOverlay(container: HTMLElement, props: WelcomeOverlayProps): () => void {
  return render(() => <WelcomeOverlay {...props} />, container);
}

/**
 * Mounts ChatBox into `container` and returns an unmount function — same wrapping reasoning
 * as mountWelcomeOverlay() above. Unlike the welcome overlay (mounted/unmounted repeatedly
 * across connection attempts), this is meant to be mounted once, permanently, alongside the
 * rest of the UI root — ChatBox's own open/closed visual state (not DOM mount state) is what
 * toggles as the player opens and closes it.
 */
export function mountChatBox(container: HTMLElement, props: ChatBoxProps): () => void {
  return render(() => <ChatBox {...props} />, container);
}

/**
 * Mounts LoadingScreen into `container` and returns an unmount function — same wrapping
 * reasoning as mountWelcomeOverlay(). Meant to be mounted once at startup and unmounted as
 * soon as asset loading finishes, before the welcome overlay ever shows (see
 * @starve/client's index.ts).
 */
export function mountLoadingScreen(container: HTMLElement, props: LoadingScreenProps): () => void {
  return render(() => <LoadingScreen {...props} />, container);
}
