class RemoteDeskApp {
  constructor() {
    this.userId = null;
    this.ws = null;
    this.peerConnection = null;
    this.isHost = true;
    this.remoteVideo = null;
    this.localStream = null;

    this.init();
  }

  async init() {
    try {
      this.userId = await window.electronAPI.getUserId();
      this.displayUserId();

      // Check screen sharing support
      if (!this.isScreenSharingSupported()) {
        this.updateConnectionStatus("⚠️ Screen sharing not supported in this environment");
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

      // Get screen sharing stream
      let stream;
      try {
        // Check if screen sharing is supported
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          throw new Error("Screen sharing is not supported in this browser");
        }

        console.log("Requesting screen sharing...");
        this.updateConnectionStatus("Requesting screen sharing permission...");

        // Use getDisplayMedia with proper constraints
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            mediaSource: 'screen',
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            frameRate: { ideal: 30, max: 30 }
          },
          audio: false,
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
          errorMessage += "Permission denied. Please allow screen sharing when prompted.";
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
        userMessage = "❌ Permission denied. Please allow screen sharing and try again.";
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
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;
      }
    }
  }

  handleSignal(message) {
    if (!this.peerConnection) return;

    const { payload } = message;

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
  }

  updateConnectionStatus(status) {
    const statusElement = document.getElementById("connectionStatus");
    const retryButton = document.getElementById("retryButton");

    statusElement.textContent = status;

    // Show retry button for error states
    if (status.includes("❌") || status.includes("failed") || status.includes("not supported")) {
      retryButton.style.display = "inline-block";
    } else {
      retryButton.style.display = "none";
    }
  }

  isScreenSharingSupported() {
    // Check if the browser supports getDisplayMedia
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      console.error("getDisplayMedia not supported");
      return false;
    }

    // Check if we're in a secure context (required for screen sharing)
    if (!window.isSecureContext && location.protocol !== 'file:') {
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
      this.localStream.getTracks().forEach(track => track.stop());
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
    navigator.clipboard
      .writeText(userId)
      .then(() => {
        showCopyNotification();
      })
      .catch((err) => {
        console.error("Failed to copy ID:", err);
        // Fallback for older browsers
        const textArea = document.createElement("textarea");
        textArea.value = userId;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        showCopyNotification();
      });
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
