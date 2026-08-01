import './styles/global.scss';
import { bootstrapClient } from './bootstrap/ClientBootstrap';

const mountPoint = document.getElementById('app-root');
if (!mountPoint) {
  throw new Error('#app-root element not found');
}

const client = bootstrapClient(mountPoint);
client.start();
