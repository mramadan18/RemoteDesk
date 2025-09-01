class RemoteDeskApp {
  constructor() {
    this.userId = null;
    this.ws = null;
    this.peerConnection = null;
    this.isHost = true;
    this.remoteVideo = null;
    this.localStream = null;
    this.inputChannel = null; // RTCDataChannel for input events

    this.init();
  }

  async init() {
    try {
      this.userId = await window.electronAPI.getUserId();
      this.displayUserId();

      // Check screen sharing support
      if (!this.isScreenSharingSupported()) {
        this.updateConnectionStatus(
          "⚠️ Screen sharing not supported in this environment"
        );
        console.warn("Screen sharing not supported");
      } else {
        console.log("Screen sharing is supported");
      }

      this.connectToServer();
      this.setupEventListeners();
    } catch (error) {
      console.error("Failed to initialize app:", error);
      this.updateConnectionStatus("❌ Initialization failed");
    }
  }

  displayUserId() {
    const userIdElement = document.getElementById("userId");
    userIdElement.textContent = this.userId;
    userIdElement.style.cursor = "pointer";
  }

  connectToServer() {
    // Connect to the signaling server
    this.ws = new WebSocket("wss://remotedesk-production.up.railway.app/ws");

    this.ws.onopen = () => {
      console.log("Connected to signaling server");
      this.updateConnectionStatus("Connected to server");
      // Register with our user ID
      this.registerWithServer();
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };

    this.ws.onclose = () => {
      console.log("Disconnected from signaling server");
      this.updateConnectionStatus("Disconnected from server");
      // Attempt to reconnect after 5 seconds
      setTimeout(() => this.connectToServer(), 5000);
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      this.updateConnectionStatus("Connection error");
    };
  }

  registerWithServer() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "register",
          userId: this.userId,
        })
      );
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case "welcome":
        // Server assigned us our peer ID
        console.log("Welcome, my peer ID is:", message.peerId);
        this.peerId = message.peerId;
        break;

      case "registered":
        console.log("Successfully registered with user ID:", message.userId);
        break;

      case "peer-joined":
        // Someone is trying to connect to us
        this.handleIncomingConnection(message.peerId);
        break;

      case "signal":
        this.handleSignal(message);
        break;

      case "ice-candidate":
        this.handleIceCandidate(message);
        break;

      case "error":
        console.error("Server error:", message.error);
        this.updateConnectionStatus(`Error: ${message.error}`);
        break;
    }
  }

  async handleIncomingConnection(peerId) {
    console.log("Incoming connection from:", peerId);
    this.updateConnectionStatus("Incoming connection...");

    // Automatically accept the connection (no permission prompt)
    await this.setupPeerConnection(peerId);
  }

  async setupPeerConnection(peerId) {
    try {
      // Check if screen sharing is supported before proceeding
      if (!this.isScreenSharingSupported()) {
        throw new Error("Screen sharing is not supported in this environment");
      }

      console.log("Setting up peer connection for peer:", peerId);
      this.updateConnectionStatus("Setting up connection...");

      this.peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });

      // Create data channel for input events (host side)
      this.inputChannel = this.peerConnection.createDataChannel(
        "input-events",
        {
          ordered: true,
        }
      );
      this.inputChannel.onopen = () => {
        console.log("Input data channel open");
        this.updateConnectionStatus("Connected - receiving remote control");
        try {
          this.inputChannel.send(JSON.stringify({ t: "hello-host" }));
        } catch (_) {}
      };
      this.inputChannel.onclose = () => {
        console.log("Input data channel closed");
      };
      this.inputChannel.onmessage = async (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg && msg.t === "hello-viewer") {
            console.log("Viewer handshake received");
            return;
          }
          await this.injectInput(msg);
        } catch (err) {
          console.warn("Failed to process input message", err);
        }
      };

      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendSignal(peerId, {
            type: "ice-candidate",
            payload: event.candidate,
          });
        }
      };

      this.peerConnection.ontrack = (event) => {
        console.log("Received remote stream");
        this.handleRemoteStream(event.streams[0]);
      };

      // Get screen sharing stream using Electron API
      let stream;
      try {
        console.log("Requesting screen sharing...");
        this.updateConnectionStatus("Requesting screen sharing permission...");

        // Get screen source info from Electron main process
        const sourceInfo = await window.electronAPI.getScreenSourceInfo();
        console.log("Got screen source:", sourceInfo);

        // Use Electron-specific constraints for desktop capture
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: sourceInfo.id,
              minWidth: 1280,
              maxWidth: 1920,
              minHeight: 720,
              maxHeight: 1080,
              maxFrameRate: 30,
            },
          },
        });

        console.log("Successfully got screen sharing stream");

        // Verify the stream has video tracks
        if (!stream.getVideoTracks() || stream.getVideoTracks().length === 0) {
          throw new Error("No video track found in screen sharing stream");
        }
      } catch (mediaError) {
        console.error("Error getting media stream:", mediaError);

        // Provide more specific error messages
        let errorMessage = "Screen sharing failed: ";
        if (mediaError.name === "NotAllowedError") {
          errorMessage +=
            "Permission denied. Please allow screen sharing when prompted.";
        } else if (mediaError.name === "NotFoundError") {
          errorMessage += "No screen found to share.";
        } else if (mediaError.name === "NotSupportedError") {
          errorMessage += "Screen sharing not supported in this environment.";
        } else if (mediaError.name === "NotReadableError") {
          errorMessage += "Screen is already being shared or not available.";
        } else {
          errorMessage += mediaError.message || "Unknown error occurred";
        }

        throw new Error(errorMessage);
      }

      this.localStream = stream;
      stream.getTracks().forEach((track) => {
        this.peerConnection.addTrack(track, stream);
      });

      // Create and send offer
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      this.sendSignal(peerId, {
        type: "signal",
        payload: offer,
      });

      this.updateConnectionStatus("Screen sharing active");
    } catch (error) {
      console.error("Error setting up peer connection:", error);

      // Provide user-friendly error messages
      let userMessage = "Connection failed";
      if (error.message.includes("Screen sharing")) {
        userMessage = error.message; // Already formatted error message
      } else if (error.message.includes("Permission denied")) {
        userMessage =
          "❌ Permission denied. Please allow screen sharing and try again.";
      } else if (error.message.includes("network")) {
        userMessage = "❌ Network error. Check your connection and try again.";
      } else {
        userMessage = `❌ ${error.message || "Unknown connection error"}`;
      }

      this.updateConnectionStatus(userMessage);

      // Clean up any partial connection
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }

      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => track.stop());
        this.localStream = null;
      }
    }
  }

  // Set up peer connection as receiver (when someone connects to us)
  async setupPeerConnectionAsReceiver(peerId) {
    console.log("Setting up peer connection as receiver for peer:", peerId);
    this.updateConnectionStatus("Receiving connection...");

    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal(peerId, {
          type: "ice-candidate",
          payload: event.candidate,
        });
      }
    };

    this.peerConnection.ontrack = (event) => {
      console.log("Received remote stream as receiver");
      this.handleRemoteStream(event.streams[0]);
      this.updateConnectionStatus("Connected - viewing remote screen");
    };

    // Listen for the host-created data channel (viewer side)
    this.peerConnection.ondatachannel = (event) => {
      if (event.channel && event.channel.label === "input-events") {
        const channel = event.channel;
        channel.onopen = () => {
          console.log("Input data channel ready (viewer)");
          this.updateConnectionStatus("Connected - remote control ready");
          try {
            channel.send(JSON.stringify({ t: "hello-viewer" }));
          } catch (_) {}
        };
        channel.onmessage = (e) => {
          // Future: host -> viewer messages (e.g., cursor state). Not used now.
          try {
            const msg = JSON.parse(e.data);
            console.log("Host message:", msg);
          } catch (_) {}
        };
        this.inputChannel = channel;
        this.enableRemoteInputCapture();
      }
    };

    // Note: As receiver, we don't need to add any tracks or create offers
    // We'll wait for the offer from the sender and respond with an answer
  }

  async handleSignal(message) {
    const { payload } = message;

    // If we don't have a peer connection but received an offer,
    // we need to set one up (this happens when we're the receiver)
    if (!this.peerConnection && payload.type === "offer") {
      console.log(
        "Received offer but no peer connection exists, setting one up..."
      );
      try {
        await this.setupPeerConnectionAsReceiver(message.from);
      } catch (error) {
        console.error("Failed to set up peer connection as receiver:", error);
        return;
      }
    }

    if (!this.peerConnection) return;

    if (payload.type === "offer") {
      this.peerConnection
        .setRemoteDescription(new RTCSessionDescription(payload))
        .then(() => this.peerConnection.createAnswer())
        .then((answer) => this.peerConnection.setLocalDescription(answer))
        .then(() => {
          this.sendSignal(message.from, {
            type: "signal",
            payload: this.peerConnection.localDescription,
          });
        })
        .catch((error) => console.error("Error handling offer:", error));
    } else if (payload.type === "answer") {
      this.peerConnection
        .setRemoteDescription(new RTCSessionDescription(payload))
        .catch((error) => console.error("Error handling answer:", error));
    }
  }

  handleIceCandidate(message) {
    if (!this.peerConnection) return;

    this.peerConnection
      .addIceCandidate(new RTCIceCandidate(message.payload))
      .catch((error) => console.error("Error adding ICE candidate:", error));
  }

  sendSignal(targetId, message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: message.type,
          to: targetId,
          payload: message.payload,
        })
      );
    }
  }

  handleRemoteStream(stream) {
    // Create video element for remote screen if it doesn't exist
    if (!this.remoteVideo) {
      this.remoteVideo = document.createElement("video");
      this.remoteVideo.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: black;
                z-index: 1000;
                object-fit: contain;
            `;
      this.remoteVideo.autoplay = true;
      document.body.appendChild(this.remoteVideo);
    }

    this.remoteVideo.srcObject = stream;
    this.updateConnectionStatus("Connected - sharing screen");

    // If we're the viewer and the data channel is ready, enable input capture now
    if (
      this.inputChannel &&
      this.inputChannel.readyState === "open" &&
      !this._inputCaptureEnabled
    ) {
      this.enableRemoteInputCapture();
    }
  }

  enableRemoteInputCapture() {
    if (!this.remoteVideo) return;
    const video = this.remoteVideo;

    const send = (payload) => {
      if (!this.inputChannel || this.inputChannel.readyState !== "open") return;
      try {
        this.inputChannel.send(JSON.stringify(payload));
      } catch (err) {
        console.warn("Failed sending input payload", err);
      }
    };

    const getRelative = (evt) => {
      const rect = video.getBoundingClientRect();
      const x = (evt.clientX - rect.left) / rect.width;
      const y = (evt.clientY - rect.top) / rect.height;
      return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    };

    // Mouse move
    const onMouseMove = (evt) => {
      const { x, y } = getRelative(evt);
      send({ t: "move", x, y });
    };

    // Mouse down/up
    const onMouseDown = (evt) => {
      const { x, y } = getRelative(evt);
      const button = evt.button; // 0 left, 1 middle, 2 right
      send({ t: "down", x, y, b: button });
    };
    const onMouseUp = (evt) => {
      const { x, y } = getRelative(evt);
      const button = evt.button;
      send({ t: "up", x, y, b: button });
    };

    // Double click
    const onDblClick = (evt) => {
      const { x, y } = getRelative(evt);
      send({ t: "dbl", x, y, b: 0 });
    };

    // Context menu suppression
    const onContextMenu = (evt) => {
      evt.preventDefault();
      const { x, y } = getRelative(evt);
      send({ t: "ctx", x, y, b: 2 });
    };

    // Wheel
    const onWheel = (evt) => {
      // Normalize small deltas
      const deltaX = Math.max(-1, Math.min(1, evt.deltaX));
      const deltaY = Math.max(-1, Math.min(1, evt.deltaY));
      send({ t: "wheel", dx: deltaX, dy: deltaY });
    };

    // Pointer lock optional: keep simple first
    video.addEventListener("mousemove", onMouseMove);
    video.addEventListener("mousedown", onMouseDown);
    video.addEventListener("mouseup", onMouseUp);
    video.addEventListener("dblclick", onDblClick);
    video.addEventListener("contextmenu", onContextMenu);
    video.addEventListener("wheel", onWheel, { passive: true });

    // Save cleanup
    this._cleanupInputCapture = () => {
      video.removeEventListener("mousemove", onMouseMove);
      video.removeEventListener("mousedown", onMouseDown);
      video.removeEventListener("mouseup", onMouseUp);
      video.removeEventListener("dblclick", onDblClick);
      video.removeEventListener("contextmenu", onContextMenu);
      video.removeEventListener("wheel", onWheel);
    };

    this._inputCaptureEnabled = true;
  }

  async injectInput(msg) {
    if (!window.electronAPI || !window.electronAPI.input) return;
    const api = window.electronAPI.input;
    const type = msg && msg.t;
    try {
      switch (type) {
        case "move":
          return await api.move(msg.x, msg.y);
        case "down":
          return await api.down(msg.b);
        case "up":
          return await api.up(msg.b);
        case "dbl":
          return await api.dbl(msg.b || 0);
        case "ctx":
          return await api.ctx();
        case "wheel":
          return await api.wheel(msg.dx || 0, msg.dy || 0);
      }
    } catch (err) {
      console.error("IPC input injection failed", err);
    }
  }

  updateConnectionStatus(status) {
    const statusElement = document.getElementById("connectionStatus");
    const retryButton = document.getElementById("retryButton");

    statusElement.textContent = status;

    // Show retry button for error states
    if (
      status.includes("❌") ||
      status.includes("failed") ||
      status.includes("not supported")
    ) {
      retryButton.style.display = "inline-block";
    } else {
      retryButton.style.display = "none";
    }
  }

  isScreenSharingSupported() {
    // Check if we're running in Electron
    if (!window.electronAPI || !window.electronAPI.getScreenSourceInfo) {
      console.error("Electron screen sharing API not available");
      return false;
    }

    // Check if mediaDevices API is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error("getUserMedia not supported");
      return false;
    }

    // Check if we're in a secure context (required for screen sharing)
    if (!window.isSecureContext && location.protocol !== "file:") {
      console.error("Screen sharing requires a secure context (HTTPS)");
      return false;
    }

    return true;
  }

  connectToUser(targetUserId) {
    if (!targetUserId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.updateConnectionStatus("Not connected to server");
      return;
    }

    console.log("Attempting to connect to user:", targetUserId);
    this.updateConnectionStatus("Connecting...");

    // Store the target user ID for when we receive signals
    this.targetUserId = targetUserId;

    this.ws.send(
      JSON.stringify({
        type: "connect",
        targetUserId: targetUserId,
      })
    );
  }

  setupEventListeners() {
    // Handle window close to clean up streams
    window.addEventListener("beforeunload", () => {
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => track.stop());
      }
      if (this.ws) {
        this.ws.close();
      }
    });

    // Handle keyboard shortcut for connecting (Ctrl+Shift+C)
    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.shiftKey && event.key === "C") {
        event.preventDefault();
        this.showConnectDialog();
      }
    });

    // Connect dialog event listeners
    const connectCancel = document.getElementById("connectCancel");
    const connectSubmit = document.getElementById("connectSubmit");
    const connectInput = document.getElementById("connectInput");
    const connectDialog = document.getElementById("connectDialog");

    if (connectCancel) {
      connectCancel.addEventListener("click", () => {
        this.hideConnectDialog();
      });
    }

    if (connectSubmit) {
      connectSubmit.addEventListener("click", () => {
        this.submitConnectDialog();
      });
    }

    if (connectInput) {
      // Handle Enter key in input field
      connectInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.submitConnectDialog();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          this.hideConnectDialog();
        }
      });

      // Auto-format input to uppercase and validate hex characters
      connectInput.addEventListener("input", (event) => {
        let value = event.target.value.toUpperCase();
        // Only allow hexadecimal characters (0-9, A-F)
        value = value.replace(/[^0-9A-F]/g, "");
        event.target.value = value;
      });
    }

    // Close dialog when clicking outside
    if (connectDialog) {
      connectDialog.addEventListener("click", (event) => {
        if (event.target === connectDialog) {
          this.hideConnectDialog();
        }
      });
    }

    // Retry button event listener
    const retryButton = document.getElementById("retryButton");
    if (retryButton) {
      retryButton.addEventListener("click", () => {
        this.retryConnection();
      });
    }
  }

  showConnectDialog() {
    const dialog = document.getElementById("connectDialog");
    const input = document.getElementById("connectInput");

    // Clear previous input
    input.value = "";
    input.focus();

    // Show dialog
    dialog.classList.add("show");
  }

  retryConnection() {
    console.log("Retrying connection...");
    this.updateConnectionStatus("Retrying...");

    // Clean up any existing connections
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    // Reconnect to server if needed
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connectToServer();
    } else {
      this.updateConnectionStatus("Ready - waiting for connections");
    }
  }

  hideConnectDialog() {
    const dialog = document.getElementById("connectDialog");
    dialog.classList.remove("show");
  }

  submitConnectDialog() {
    const input = document.getElementById("connectInput");
    const targetId = input.value.trim().toUpperCase();

    if (targetId) {
      this.connectToUser(targetId);
      this.hideConnectDialog();
    }
  }
}

// Copy user ID to clipboard
function copyUserId() {
  const userId = document.getElementById("userId").textContent;
  if (userId && userId !== "Loading...") {
    // Use Electron's clipboard API for better compatibility
    if (window.electronAPI && window.electronAPI.clipboard) {
      try {
        window.electronAPI.clipboard.writeText(userId);
        showCopyNotification();
      } catch (err) {
        console.error("Failed to copy ID using Electron API:", err);
        fallbackCopy(userId);
      }
    } else {
      // Fallback to browser clipboard API
      navigator.clipboard
        .writeText(userId)
        .then(() => {
          showCopyNotification();
        })
        .catch((err) => {
          console.error("Failed to copy ID:", err);
          fallbackCopy(userId);
        });
    }
  }
}

// Fallback copy method
function fallbackCopy(text) {
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
    showCopyNotification();
  } catch (err) {
    console.error("Fallback copy failed:", err);
  }
}

function showCopyNotification() {
  const notification = document.getElementById("copyNotification");
  notification.classList.add("show");
  setTimeout(() => {
    notification.classList.remove("show");
  }, 2000);
}

// Initialize the app when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new RemoteDeskApp();
});
