import { render } from 'solid-js/web';
import { WelcomeOverlay, type WelcomeOverlayProps } from './components/WelcomeOverlay';

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
