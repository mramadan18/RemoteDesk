const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const { v4: uuidv4 } = require("uuid");

/**
 * Starts the signaling server (Express + WebSocket)
 * @param {object} options
 * @param {number} [options.port=5005]
 * @param {boolean} [options.probe=false] - If true, auto-stop shortly after start (for CI sanity checks)
 * @returns {{ httpServer: import('http').Server, wss: import('ws').WebSocketServer }}
 */
function start(options = {}) {
  const port = options.port || 5005;

  const app = express();
  app.use(express.json());

  app.get("/health", (req, res) => {
    res.status(200).send("ok");
  });

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const clients = new Map(); // userId -> WebSocket
  const pendingConnections = new Map(); // targetUserId -> Set<sourceUserId>

  function send(ws, message) {
    try {
      ws.send(JSON.stringify(message));
    } catch (_) {
      // ignore send errors
    }
  }

  function findClientByUserId(userId) {
    return clients.get(userId);
  }

  wss.on("connection", (ws) => {
    ws.peerId = uuidv4();
    ws.userId = null;

    // greet client with its assigned peer id
    send(ws, { type: "welcome", peerId: ws.peerId });

    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (err) {
        return;
      }

      const { type, userId, targetUserId, payload, to: targetId } = msg || {};

      // Register user with their user ID
      if (type === "register") {
        if (!userId) return;
        ws.userId = userId;
        clients.set(userId, ws);
        console.log(`User ${userId} registered`);
        send(ws, { type: "registered", userId });
        return;
      }

      // Connect to another user by their ID
      if (type === "connect") {
        if (!targetUserId) {
          send(ws, { type: "error", error: "TARGET_USER_ID_MISSING" });
          return;
        }

        const targetClient = findClientByUserId(targetUserId);
        if (!targetClient) {
          send(ws, { type: "error", error: "USER_NOT_FOUND" });
          return;
        }

        if (targetClient.readyState !== 1) {
          send(ws, { type: "error", error: "USER_OFFLINE" });
          return;
        }

        // Notify the target user that someone is connecting
        send(targetClient, {
          type: "peer-joined",
          peerId: ws.peerId,
          userId: ws.userId,
          initiatorId: ws.userId,
          initiatorPeerId: ws.peerId,
        });

        // Add to pending connections
        if (!pendingConnections.has(targetUserId)) {
          pendingConnections.set(targetUserId, new Set());
        }
        pendingConnections.get(targetUserId).add(ws.userId);

        send(ws, { type: "connecting", targetUserId });
        return;
      }

      // Handle WebRTC signaling
      if (type === "signal") {
        if (!targetId) return;

        const targetClient = Array.from(clients.values()).find(
          (client) => client.peerId === targetId
        );
        if (targetClient && targetClient.readyState === 1) {
          send(targetClient, {
            type: "signal",
            from: ws.peerId,
            to: targetId,
            payload,
          });
        }
        return;
      }

      // Handle ICE candidates
      if (type === "ice-candidate") {
        if (!targetId) return;

        const targetClient = Array.from(clients.values()).find(
          (client) => client.peerId === targetId
        );
        if (targetClient && targetClient.readyState === 1) {
          send(targetClient, {
            type: "ice-candidate",
            from: ws.peerId,
            to: targetId,
            payload,
          });
        }
        return;
      }
    });

    ws.on("close", () => {
      // Clean up client registration
      if (ws.userId) {
        clients.delete(ws.userId);

        // Clean up pending connections
        for (const [targetId, sources] of pendingConnections) {
          sources.delete(ws.userId);
          if (sources.size === 0) {
            pendingConnections.delete(targetId);
          }
        }
      }

      console.log(`Client ${ws.userId || ws.peerId} disconnected`);
    });
  });

  httpServer.listen(port, () => {
    console.log(`[signaling] listening on http://localhost:${port}`);
  });

  if (options.probe) {
    setTimeout(() => {
      try {
        wss.close();
        httpServer.close();
      } catch (_) {}
    }, 300);
  }

  return { httpServer, wss };
}

if (require.main === module) {
  start();
}

module.exports = { start };
