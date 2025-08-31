const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const peersCountEl = document.getElementById("peersCount");
const currentRoomEl = document.getElementById("currentRoom");
const remoteVideo = document.getElementById("remoteVideo");
const overlay = document.getElementById("overlay");

const btnCreate = document.getElementById("btnCreate");
const btnJoin = document.getElementById("btnJoin");
const btnShare = document.getElementById("btnShare");
const btnControl = document.getElementById("btnControl");
const btnCopyPull = document.getElementById("btnCopyPull");
const btnCopyPush = document.getElementById("btnCopyPush");
const btnSendFile = document.getElementById("btnSendFile");
const roomIdInput = document.getElementById("roomId");

function log(message) {
  const now = new Date().toLocaleTimeString();
  logEl.textContent += `\n[${now}] ${message}`;
  logEl.scrollTop = logEl.scrollHeight;
}

const signalingUrl = "ws://31.97.32.221:3001/ws";
let ws;
let roomId = null;
let peers = new Map();

let localStream = null;
let dataChannel = null;
let selfId = null;

// file receive buffer
let incomingFile = {
  meta: null,
  chunks: [],
  received: 0,
};

// cursors state for multi-mouse overlay
const peerIdToCursorEl = new Map();

function updatePeersCount() {
  peersCountEl.textContent = String(peers.size);
}

function setStatus(text) {
  statusEl.textContent = text;
}

function ensureSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  ws = new WebSocket(signalingUrl);
  ws.onopen = () => log("Signaling connected");
  ws.onclose = () => log("Signaling disconnected");
  ws.onmessage = onSignalMessage;
}

function onSignalMessage(event) {
  const msg = JSON.parse(event.data);
  if (msg.type === "welcome") {
    selfId = msg.peerId;
    log(`Your ID: ${selfId}`);
    return;
  }
  if (msg.type === "room-created") {
    roomId = msg.roomId;
    currentRoomEl.textContent = roomId;
    roomIdInput.value = roomId;
    setStatus("Room created");
    return;
  }
  if (msg.type === "room-joined") {
    setStatus("Joined room");
    return;
  }
  if (msg.type === "peer-joined") {
    log(`Peer joined: ${msg.peerId}`);
    peers.set(msg.peerId, {});
    updatePeersCount();
    createPeerConnection(true, msg.peerId);
    return;
  }
  if (msg.type === "peer-left") {
    const { peerId } = msg;
    log(`Peer left: ${peerId}`);
    peers.delete(peerId);
    const el = peerIdToCursorEl.get(peerId);
    if (el) {
      el.remove();
      peerIdToCursorEl.delete(peerId);
    }
    updatePeersCount();
    return;
  }
  if (msg.type === "signal") {
    const { from, to, payload } = msg;
    if (to && selfId && to !== selfId) return;
    let pc = peers.get(from)?.pc;
    if (!pc) {
      pc = createPeerConnection(false, from);
    }
    if (payload.sdp) {
      pc.setRemoteDescription(payload).then(async () => {
        if (payload.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(
            JSON.stringify({
              type: "signal",
              to: from,
              payload: pc.localDescription,
            })
          );
        }
      });
    }
    return;
  }
  if (msg.type === "ice-candidate") {
    const { from, to, payload } = msg;
    if (to && selfId && to !== selfId) return;
    const pc = peers.get(from)?.pc;
    if (pc && payload) {
      pc.addIceCandidate(payload).catch(() => {});
    }
    return;
  }
  if (msg.type === "error") {
    log(`Error: ${msg.error}`);
  }
}

function createCursor(peerId) {
  const el = document.createElement("div");
  el.className = "cursor";
  overlay.appendChild(el);
  peerIdToCursorEl.set(peerId, el);
  return el;
}

function updateCursor(peerId, x, y) {
  const el = peerIdToCursorEl.get(peerId) || createCursor(peerId);
  el.style.left = `${x * window.innerWidth}px`;
  el.style.top = `${y * window.innerHeight}px`;
}

function createPeerConnection(isInitiator, peerId) {
  ensureSocket();
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  peers.set(peerId, { pc });
  updatePeersCount();

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(
        JSON.stringify({
          type: "ice-candidate",
          to: peerId,
          payload: e.candidate,
        })
      );
    }
  };

  pc.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
  };

  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  let dc;
  if (isInitiator) {
    dc = pc.createDataChannel("control");
    setupDataChannel(dc);
    pc.createOffer().then(async (offer) => {
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: "signal", to: peerId, payload: offer }));
    });
  } else {
    pc.ondatachannel = (e) => {
      dc = e.channel;
      setupDataChannel(dc);
    };
  }

  return pc;
}

function setupDataChannel(dc) {
  dataChannel = dc;
  dc.onopen = () => log("DataChannel open");
  dc.onclose = () => log("DataChannel closed");
  dc.onmessage = (e) => {
    // binary chunks for file transfer
    if (e.data instanceof ArrayBuffer || e.data instanceof Blob) {
      const chunkPromise =
        e.data instanceof Blob ? e.data.arrayBuffer() : Promise.resolve(e.data);
      chunkPromise.then((buf) => {
        const u8 = new Uint8Array(buf);
        incomingFile.chunks.push(u8);
        incomingFile.received += u8.byteLength;
      });
      return;
    }
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "cursor") {
        updateCursor(msg.from || "peer", msg.x, msg.y);
      } else if (msg.type === "clipboard-text") {
        lastReceivedClipboard = msg.text || "";
        window.electronAPI.writeClipboardText(lastReceivedClipboard);
      } else if (msg.type === "mouse") {
        if (
          msg.action === "move" &&
          typeof msg.x === "number" &&
          typeof msg.y === "number"
        ) {
          window.electronAPI.simulateMouse({
            type: "move",
            x: msg.x,
            y: msg.y,
          });
        } else if (msg.action === "down") {
          window.electronAPI.simulateMouse({ type: "down" });
        } else if (msg.action === "up") {
          window.electronAPI.simulateMouse({ type: "up" });
        }
      } else if (msg.type === "file-meta") {
        incomingFile.meta = { name: msg.name, size: msg.size };
        incomingFile.chunks = [];
        incomingFile.received = 0;
        log(`Receiving file: ${msg.name} (${msg.size} bytes)`);
      } else if (msg.type === "file-end") {
        // assemble and save
        const total = incomingFile.received;
        const joined = new Uint8Array(total);
        let offset = 0;
        for (const c of incomingFile.chunks) {
          joined.set(c, offset);
          offset += c.byteLength;
        }
        (async () => {
          const savePath = await window.electronAPI.saveFileDialog(
            incomingFile.meta?.name || "received.file"
          );
          if (savePath) {
            window.electronAPI.writeFile(savePath, joined);
            log(`Saved file to ${savePath}`);
          } else {
            log("Save canceled");
          }
        })();
        incomingFile = { meta: null, chunks: [], received: 0 };
      }
    } catch (_) {}
  };

  // basic clipboard sync loop (text-only) with loop prevention
  let lastSentClipboard = "";
  let lastObservedClipboard = "";
  window.setInterval(() => {
    if (!dataChannel || dataChannel.readyState !== "open") return;
    const text = window.electronAPI.readClipboardText();
    if (text !== lastObservedClipboard && text !== lastReceivedClipboard) {
      lastObservedClipboard = text;
      lastSentClipboard = text;
      dataChannel.send(JSON.stringify({ type: "clipboard-text", text }));
    }
  }, 1000);
}

btnCreate.onclick = () => {
  ensureSocket();
  ws.send(JSON.stringify({ type: "create" }));
};

btnJoin.onclick = () => {
  ensureSocket();
  const rid = roomIdInput.value.trim();
  if (!rid) return;
  roomId = rid;
  currentRoomEl.textContent = roomId;
  ws.send(JSON.stringify({ type: "join", roomId }));
};

btnShare.onclick = async () => {
  setStatus("Selecting source...");
  const sources = await window.electronAPI.getDesktopSources();
  // naive pick first screen
  const screen =
    sources.find((s) => s.id.toLowerCase().includes("screen")) || sources[0];
  if (!screen) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: screen.id,
        },
      },
    });
  } catch (err) {
    // fallback
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
  }
  localStream = stream;
  // renegotiate on existing PCs
  for (const [, { pc }] of peers) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }
  setStatus("Sharing");
};

// local cursor broadcast
window.addEventListener("mousemove", (e) => {
  if (!dataChannel || dataChannel.readyState !== "open") return;
  const x = e.clientX / window.innerWidth;
  const y = e.clientY / window.innerHeight;
  dataChannel.send(JSON.stringify({ type: "cursor", x, y }));
});

btnControl.onclick = () => {
  // demo: simulate local control event to remote
  window.addEventListener(
    "click",
    () => {
      if (!dataChannel || dataChannel.readyState !== "open") return;
      dataChannel.send(JSON.stringify({ type: "mouse", action: "down" }));
      dataChannel.send(JSON.stringify({ type: "mouse", action: "up" }));
    },
    { once: true }
  );
  log("Next click will be sent as remote mouse click");
};

btnCopyPull.onclick = async () => {
  if (!dataChannel || dataChannel.readyState !== "open") return;
  // request remote clipboard (simple demo: rely on background sync in future)
  log("Pulling clipboard not implemented; use push for demo");
};

btnCopyPush.onclick = async () => {
  if (!dataChannel || dataChannel.readyState !== "open") return;
  const text = window.electronAPI.readClipboardText();
  dataChannel.send(JSON.stringify({ type: "clipboard-text", text }));
};

btnSendFile.onclick = async () => {
  if (!dataChannel || dataChannel.readyState !== "open") return;
  const filePath = await window.electronAPI.openFileDialog();
  if (!filePath) return;
  try {
    const buf = window.electronAPI.readFile(filePath);
    const chunkSize = 16 * 1024;
    const total = buf.length;
    let offset = 0;
    dataChannel.send(
      JSON.stringify({
        type: "file-meta",
        name: filePath.split(/\\\\|\//).pop(),
        size: total,
      })
    );
    while (offset < total) {
      const end = Math.min(offset + chunkSize, total);
      const chunk = buf.slice(offset, end);
      // ensure ArrayBuffer for cross-browser compat
      const ab = chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + chunk.byteLength
      );
      dataChannel.send(ab);
      offset = end;
      // yield to avoid blocking
      await new Promise((r) => setTimeout(r, 0));
    }
    dataChannel.send(JSON.stringify({ type: "file-end" }));
  } catch (err) {
    log("File send error");
  }
};
