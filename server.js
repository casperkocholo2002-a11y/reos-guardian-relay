import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.RELAY_BRIDGE_TOKEN || "";
if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error("PORT_INVALID");
if (TOKEN.length < 32) throw new Error("RELAY_BRIDGE_TOKEN_REQUIRED");

const MAX = 16 * 1024;
let pending = null;
let lastBridgeSeen = 0;

function auth(req) {
  const value = req.headers.authorization || "";
  const token = value.startsWith("Bearer ") ? value.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function body(req, max = MAX) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function send(res, status, value) {
  res.statusCode = status;
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  if (value === undefined) return res.end();
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://relay");

    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        ok: true,
        service: "reos-guardian-relay",
        guardianConnected: Date.now() - lastBridgeSeen < 15000
      });
    }

    if (req.method === "POST" && url.pathname === "/guardian/v1/agent/exchange") {
      if (pending) return send(res, 429);
      const raw = await body(req);
      const parsed = JSON.parse(raw.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return send(res, 400);
      const requestId = randomUUID();
      const result = await new Promise((resolve) => {
        pending = { requestId, body: raw.toString("utf8"), claimedAt: 0, resolve };
        setTimeout(() => {
          if (pending?.requestId === requestId) {
            pending = null;
            resolve({ status: 504, body: "" });
          }
        }, 12000);
      });
      res.statusCode = result.status;
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-content-type-options", "nosniff");
      if (result.status === 200) res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(result.body);
    }

    if (req.method === "POST" && url.pathname === "/guardian/v1/bridge/poll") {
      if (!auth(req)) return send(res, 401);
      lastBridgeSeen = Date.now();
      if (!pending) return send(res, 204);
      if (pending.claimedAt && Date.now() - pending.claimedAt < 3000) return send(res, 204);
      pending.claimedAt = Date.now();
      return send(res, 200, { requestId: pending.requestId, body: pending.body });
    }

    if (req.method === "POST" && url.pathname === "/guardian/v1/bridge/respond") {
      if (!auth(req)) return send(res, 401);
      lastBridgeSeen = Date.now();
      const raw = await body(req, 32 * 1024);
      const data = JSON.parse(raw.toString("utf8"));
      if (!pending || data.requestId !== pending.requestId) return send(res, 409);
      if (![200, 204, 400, 415, 500, 502, 503].includes(data.status)) return send(res, 400);
      const responseBody = typeof data.body === "string" ? data.body : "";
      if (Buffer.byteLength(responseBody) > MAX) return send(res, 400);
      const current = pending;
      pending = null;
      current.resolve({ status: data.status, body: responseBody });
      return send(res, 204);
    }

    return send(res, 404);
  } catch {
    return send(res, 400);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`reos-guardian-relay listening on ${PORT}`);
});
