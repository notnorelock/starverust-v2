import './styles/global.scss';
import { createSignal } from 'solid-js';
import { RejectionReason } from '@starve/protocol';
import { mountWelcomeOverlay, mountChatBox } from '@starve/ui';
import { bootstrapClient } from './bootstrap/ClientBootstrap';

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`#${id} element not found`);
  }
  return element;
}

const appRoot: HTMLElement = requireElement('app-root');
const uiRoot: HTMLElement = requireElement('ui-root');

// Two separate child elements inside ui-root, not two separate top-level root divs in
// index.html. This matters because Solid's render() (see mountWelcomeOverlay/mountChatBox)
// fully owns whatever container it's given — its unmount function does
// `container.textContent = ''`, wiping every child of that exact node. The welcome overlay
// is unmounted/remounted repeatedly (every nickname submission, every rejection), so it gets
// its own dedicated child (welcomeRoot) rather than targeting ui-root directly — otherwise
// its first unmount would also wipe out ChatBox's own child right alongside it. ui-root
// itself is never handed to render() directly, so it's never cleared.
const welcomeRoot = document.createElement('div');
const chatRoot = document.createElement('div');
uiRoot.append(welcomeRoot, chatRoot);

function rejectionMessage(reason: RejectionReason): string {
  switch (reason) {
    case RejectionReason.VersionMismatch:
      return 'This client is out of date. Please refresh the page.';
    case RejectionReason.InvalidNickname:
      return 'That nickname is invalid — use 3 to 16 characters.';
    default:
      return 'The server refused the connection.';
  }
}

// Starts local simulation/rendering immediately — the canvas is live (an empty world,
// camera at its default position) before the player has typed a nickname or a connection
// has even been attempted. See ClientBootstrap's own doc comment for why start() and
// connect() are split this way.
const { gameClient, connect, onSessionChange } = bootstrapClient(appRoot);

// True only once Handshake has assigned this client a player — see ClientBootstrap's
// onSessionChange doc comment. Drives ChatBox's `enabled` prop so chat can't be opened (and
// is force-closed if already open) before a session exists or after one drops.
const [sessionActive, setSessionActive] = createSignal(false);
onSessionChange(setSessionActive);

// Mounted once, permanently, into its own child of ui-root (see above) — unlike the welcome
// overlay (which unmounts/remounts across connection attempts), ChatBox's own open/closed
// visual state handles showing/hiding itself.
mountChatBox(chatRoot, {
  enabled: sessionActive,
  onOpenChange: (open) => gameClient.setChatOpen(open),
  onSend: (text) => gameClient.sendChatMessage(text),
});

function showWelcomeOverlay(error?: string): void {
  const unmountOverlay = mountWelcomeOverlay(welcomeRoot, {
    error,
    onPlay: (nickname) => {
      unmountOverlay();
      connect(nickname, (reason) => {
        // The render stack (canvas, world, camera) is untouched by a rejection — only the
        // connection attempt failed, so just let the player retry with the overlay again.
        showWelcomeOverlay(rejectionMessage(reason));
      });
    },
  });
}

showWelcomeOverlay();
