const OBSWebSocket = require("obs-websocket-js").default;

// Controls a local OBS Studio instance via its built-in WebSocket server
// (OBS 28+, Tools -> WebSocket Server Settings — no plugin needed). This only
// makes sense when OBS runs on the same machine/network as this server, so
// like offline STT fallback, it's meaningful for a local deployment, not the
// Railway-hosted one. Every call here is defensive: OBS may not be running,
// may not be configured, or the connection may drop mid-service, and none of
// that should ever take down speech recognition or verse projection, which
// matter far more than the OBS side-effects.
const OBS_URL = process.env.OBS_WEBSOCKET_URL || "ws://127.0.0.1:4455";
const OBS_PASSWORD = process.env.OBS_WEBSOCKET_PASSWORD || undefined;

const obs = new OBSWebSocket();
let connected = false;

obs.on("ConnectionClosed", () => {
  connected = false;
});

async function connect() {
  if (connected) return true;
  try {
    await obs.connect(OBS_URL, OBS_PASSWORD);
    connected = true;
    return true;
  } catch (err) {
    connected = false;
    return false;
  }
}

function isConnected() {
  return connected;
}

async function startRecording() {
  if (!(await connect())) return false;
  try {
    await obs.call("StartRecord");
    return true;
  } catch (err) {
    console.error("OBS StartRecord failed:", err.message);
    return false;
  }
}

async function stopRecording() {
  if (!(await connect())) return false;
  try {
    await obs.call("StopRecord");
    return true;
  } catch (err) {
    console.error("OBS StopRecord failed:", err.message);
    return false;
  }
}

async function setScene(sceneName) {
  if (!(await connect())) return false;
  try {
    await obs.call("SetCurrentProgramScene", { sceneName });
    return true;
  } catch (err) {
    console.error("OBS SetCurrentProgramScene failed:", err.message);
    return false;
  }
}

// One consolidated status call for the operator UI: connection state, scene
// list + current scene, and recording state, all in one round trip.
async function getStatus() {
  const ok = await connect();
  if (!ok) return { connected: false, scenes: [], currentScene: null, recording: false };

  try {
    const [sceneList, recordStatus] = await Promise.all([obs.call("GetSceneList"), obs.call("GetRecordStatus")]);
    return {
      connected: true,
      scenes: (sceneList.scenes || []).map((s) => s.sceneName).reverse(), // OBS returns scenes topmost-last
      currentScene: sceneList.currentProgramSceneName || null,
      recording: Boolean(recordStatus.outputActive),
    };
  } catch (err) {
    console.error("OBS status query failed:", err.message);
    return { connected: false, scenes: [], currentScene: null, recording: false };
  }
}

module.exports = { connect, isConnected, startRecording, stopRecording, setScene, getStatus };
