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

function showWelcomeOverlay(error?: string): void {
  const unmountOverlay = mountWelcomeOverlay(uiRoot, {
    error,
    onPlay: (nickname) => {
      unmountOverlay();
      startGame(nickname);
    },
  });
}

function startGame(nickname: string): void {
  const client = bootstrapClient(appRoot, {
    nickname,
    onRejected: (reason) => {
      // No player was ever created for a rejected connection — nothing to tear down on
      // the ECS/render side, just stop this attempt and let the player try again.
      client.stop();
      appRoot.replaceChildren();
      showWelcomeOverlay(rejectionMessage(reason));
    },
  });
  client.start();
}

showWelcomeOverlay();
