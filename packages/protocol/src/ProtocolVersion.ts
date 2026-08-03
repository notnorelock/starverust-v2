/**
 * Bumped whenever a wire-format change would make an old client and a new server (or vice
 * versa) silently misinterpret each other's bytes rather than fail cleanly — e.g. a
 * packet's field order/type changes, not just a new optional packet type being added.
 * Checked in HelloPacket before any player entity is created (see
 * PlayerSession.onHelloReceived) — a mismatch gets a ConnectionRejectedPacket, not silent
 * corruption or a confusing downstream decode failure.
 */
export const PROTOCOL_VERSION = 1;
