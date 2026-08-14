import { timingSafeEqual } from "node:crypto";

export function secretsMatch(provided, expected) {
  const left = Buffer.from(provided ?? "");
  const right = Buffer.from(expected ?? "");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function validateChatPayload(value) {
  if (!value || typeof value !== "object") return null;
  const player = typeof value.player === "string" ? value.player.trim() : "";
  const message = typeof value.message === "string" ? value.message.trim() : "";
  const server = typeof value.server === "string" ? value.server.trim() : "MPCS";
  const type = typeof value.type === "string" ? value.type.trim().toLowerCase() : "chat";
  if (!player || player.length > 32 || !message || message.length > 512 || server.length > 64 || !["chat", "join", "leave"].includes(type)) return null;
  return { player, message, server: server || "MPCS", type };
}
