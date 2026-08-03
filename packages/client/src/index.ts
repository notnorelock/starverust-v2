import './styles/global.scss';
import { RejectionReason } from '@starve/protocol';
import { mountWelcomeOverlay } from '@starve/ui';
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
const { connect } = bootstrapClient(appRoot);

function showWelcomeOverlay(error?: string): void {
  const unmountOverlay = mountWelcomeOverlay(uiRoot, {
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
