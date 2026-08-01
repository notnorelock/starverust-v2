/** Abstraction systems depend on instead of touching the WebSocket gateway/registry directly. */
export interface NetworkService {
  broadcast(buffer: ArrayBuffer): void;
}
