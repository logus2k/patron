// voice-controls.js — the Mic (STT) + Speaker (TTS) block controls.
//
// These make the Patron developer a STAND-IN for the real web client, against the exact same
// endpoints production clients use — so validating here proves the future web entrypoints work:
//
//   Mic  (on the Speech-to-Text block): hands-free VAD capture in the browser → each utterance
//         is POSTed as raw PCM16@16k to the block's DEPLOYED STT source
//         (serve.py relays → stt_ingress `POST /sources/<stream_id>/audio`), which transcribes
//         server-side and FIRES the workflow — identical to a raw-audio web STT client.
//
//   Speaker (on the Text-to-Speech block): registers THIS browser as an audio consumer on
//         `/tts/socket.io` under the block's `target` id — the same id the farm's TTS delivery
//         synthesizes to (tts_server maps one id → many sinks) — so the developer hears exactly
//         what a real web listener will hear.
//
// Audio code is reused verbatim from cv/widget (the proven production widget): the recorder
// AudioWorklet, the AudioResampler (48k Float32 → 16k PCM16), Silero MicVAD for endpointing,
// and the tts_audio_chunk playback queue. `/stt` and `/tts` resolve same-origin only through the
// public proxy (logus2k.com/patron/), exactly as cv requires.
(function (global) {
  "use strict";

  var TTS_PATH = "/tts/socket.io";       // proxied → tts_server (nginx: /tts/socket.io/ → :7700)
  var TTS_DEFAULT_VOICE = "af_heart";    // matches the farm's tts_voice default (delivery.py)
  var TTS_SPEED = 1.0;
  var PRE_ROLL_MAX = 8;                  // ~ frames of pre-speech audio kept so word onsets aren't clipped
  var POST_ROLL_MS = 900;                // keep buffering ~0.9s after speech ends (server endpoints cleanly)

  // ---- AudioResampler — mono Float32 (e.g. 48 kHz) → Int16 PCM (16 kHz). ----
  // Vendored verbatim from cv/widget/cv-chat.js (itself from noted/frontend/js/AudioResampler.js).
  function AudioResampler(inRate, outRate) {
    this._ratio = inRate / outRate;
    this._carry = new Float32Array(0);
  }
  AudioResampler.prototype.pushFloat32 = function (chunk) {
    var input = new Float32Array(this._carry.length + chunk.length);
    input.set(this._carry, 0);
    input.set(chunk, this._carry.length);
    var outLen = Math.floor(input.length / this._ratio);
    if (outLen === 0) { this._carry = input; return null; }
    var out = new Int16Array(outLen);
    for (var i = 0; i < outLen; i++) {
      var idx = i * this._ratio;
      var i0 = Math.floor(idx);
      var i1 = Math.min(i0 + 1, input.length - 1);
      var frac = idx - i0;
      var s = input[i0] * (1 - frac) + input[i1] * frac;
      s = Math.max(-1, Math.min(1, s));
      out[i] = (s < 0 ? s * 0x8000 : s * 0x7FFF) | 0;
    }
    this._carry = input.subarray(Math.floor(outLen * this._ratio));
    return out;
  };

  function notice(msg) {
    if (global.PatronDialogs && global.PatronDialogs.confirm) {
      global.PatronDialogs.confirm({ title: "Voice", message: msg, okLabel: "OK" });
    } else {
      console.warn("[voice] " + msg);
    }
  }

  function projectUid() {
    var p = global.PatronProjects && global.PatronProjects.current();
    return p && p.uid ? p.uid : null;
  }

  // A live session is tracked per node id, so toggling one block never touches another.
  var micSessions = {};      // nodeId -> {…}
  var speakerSessions = {};  // nodeId -> {…}

  function setBtn(widget, label, active) {
    if (!widget) return;
    widget.name = label;
    widget.__voiceActive = !!active;   // drawButton can tint when active (best-effort)
  }
  function repaint(node) {
    if (node && node.setDirtyCanvas) node.setDirtyCanvas(true, true);
  }

  // ===================================================================== //
  //  MIC  (Speech-to-Text block) — VAD capture → POST utterance → fire     //
  // ===================================================================== //
  async function startMic(node, widget) {
    var uid = projectUid();
    if (!uid) { notice("Save and Deploy this project first — the mic fires the deployed workflow."); return false; }
    var streamId = String((node.properties && node.properties.stream_id) || "").trim();
    if (!streamId) { notice("Set this Speech-to-Text block's stream id first (it is the STT source a client posts audio to)."); return false; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { notice("Microphone input is not supported by this browser."); return false; }

    var S = {
      stream: null, ctx: null, node: null, source: null, resampler: null, vad: null,
      speaking: false, buf: [], preRoll: [], postRollTimer: null, posting: false, streamId: streamId, uid: uid,
    };
    try {
      S.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      S.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (S.ctx.resume) { try { await S.ctx.resume(); } catch (e) {} }
      await S.ctx.audioWorklet.addModule("js/recorder-worklet.js");
      S.source = S.ctx.createMediaStreamSource(S.stream);
      S.node = new AudioWorkletNode(S.ctx, "recorder-worklet");
      S.resampler = new AudioResampler(S.ctx.sampleRate, 16000);

      // Silero VAD (vad-web + onnxruntime-web) endpoints utterances hands-free. numThreads=1
      // avoids needing SharedArrayBuffer / COOP-COEP headers (matches cv).
      if (window.vad && window.vad.MicVAD && window.ort) {
        var ortBase = new URL("vendor/onnxruntime-web/", window.location.href).href;
        var vadBase = new URL("vendor/vad/", window.location.href).href;
        window.ort.env.wasm.wasmPaths = ortBase;
        window.ort.env.wasm.numThreads = 1;
        S.vad = await window.vad.MicVAD.new({
          stream: S.stream, baseAssetPath: vadBase, onnxWASMBasePath: ortBase,
          model: "legacy", positiveSpeechThreshold: 0.6,
          onSpeechStart: function () {
            S.speaking = true;
            if (S.postRollTimer) { clearTimeout(S.postRollTimer); S.postRollTimer = null; }
            // Flush the pre-roll (word onset captured just before the VAD fired) into the utterance.
            for (var i = 0; i < S.preRoll.length; i++) S.buf.push(S.preRoll[i]);
            S.preRoll = [];
            setBtn(widget, "🎤 Mic: listening…", true); repaint(node);
          },
          onSpeechEnd: function () {
            if (S.postRollTimer) clearTimeout(S.postRollTimer);
            S.postRollTimer = setTimeout(function () {
              S.speaking = false; S.postRollTimer = null;
              setBtn(widget, "🎤 Mic: on", true); repaint(node);
              flushUtterance(S, node);            // POST the completed utterance
            }, POST_ROLL_MS);
          },
          onVADMisfire: function () { setBtn(widget, "🎤 Mic: on", true); repaint(node); },
        });
        S.vad.start();
      } else {
        notice("Voice activity detection failed to load — cannot capture speech hands-free.");
        stopMic(node, widget);
        return false;
      }

      // Worklet frames → resample → buffer while speaking (else keep a short pre-roll).
      S.node.port.onmessage = function (ev) {
        var pcm = S.resampler.pushFloat32(ev.data);
        if (!pcm || !pcm.length) return;
        if (S.speaking) {
          S.buf.push(pcm);
        } else {
          S.preRoll.push(pcm);
          if (S.preRoll.length > PRE_ROLL_MAX) S.preRoll.shift();
        }
      };
      S.source.connect(S.node);
      S.node.connect(S.ctx.destination);   // worklet output is silent; needed to pull the graph

      micSessions[node.id] = S;
      setBtn(widget, "🎤 Mic: on", true); repaint(node);
      return true;
    } catch (e) {
      try { if (S.stream) S.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
      try { if (S.ctx) S.ctx.close(); } catch (_) {}
      notice("Could not start the microphone: " + (e && e.message ? e.message : e));
      return false;
    }
  }

  // Concatenate the buffered PCM16 chunks and POST the utterance to the deployed STT source.
  async function flushUtterance(S, node) {
    var chunks = S.buf; S.buf = [];
    if (!chunks.length || S.posting) return;
    var total = 0; for (var i = 0; i < chunks.length; i++) total += chunks[i].length;
    if (total < 1600) return;   // < ~0.1s of 16k audio: too short to be speech, skip
    var merged = new Int16Array(total);
    var o = 0; for (var k = 0; k < chunks.length; k++) { merged.set(chunks[k], o); o += chunks[k].length; }
    S.posting = true;
    try {
      var url = "api/projects/" + encodeURIComponent(S.uid) + "/stt-audio?source=" + encodeURIComponent(S.streamId);
      var res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: merged.buffer
      });
      var j = await res.json().catch(function () { return {}; });
      if (res.ok && j.fired) {
        if (global.PatronTrace && global.PatronTrace.note) global.PatronTrace.note("🎤 " + (j.transcript || "(fired)"));
        console.log("[voice mic] fired:", j.transcript, "entry", j.entry_id);
      } else {
        var hint = res.status === 404 ? " — is the project deployed? (STT binding missing)" : "";
        notice("STT did not fire" + hint + "\n\n" + (j.detail || j.error || ("HTTP " + res.status)));
      }
    } catch (e) {
      console.warn("[voice mic] post failed:", e);
    } finally {
      S.posting = false;
    }
  }

  function stopMic(node, widget) {
    var S = micSessions[node.id];
    if (S) {
      if (S.postRollTimer) { clearTimeout(S.postRollTimer); S.postRollTimer = null; }
      try { if (S.vad) { S.vad.pause(); if (S.vad.destroy) S.vad.destroy(); } } catch (_) {}
      try { if (S.node) S.node.disconnect(); } catch (_) {}
      try { if (S.source) S.source.disconnect(); } catch (_) {}
      try { if (S.stream) S.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
      try { if (S.ctx) S.ctx.close(); } catch (_) {}
      delete micSessions[node.id];
    }
    setBtn(widget, "🎤 Mic: off", false); repaint(node);
  }

  function toggleMic(node, widget) {
    if (micSessions[node.id]) { stopMic(node, widget); }
    else { startMic(node, widget); }
  }

  // ===================================================================== //
  //  SPEAKER (Text-to-Speech block) — consume tts_audio_chunk & play      //
  // ===================================================================== //
  function startSpeaker(node, widget) {
    if (typeof io === "undefined") { notice("Speaker is unavailable (the socket library failed to load)."); return; }
    var target = String((node.properties && node.properties.target) || "").trim();
    if (!target) { notice("Set this Text-to-Speech block's target (the voice/session id) first — the speaker listens on that id."); return; }

    var S = { socket: null, ctx: null, queue: Promise.resolve(), target: target };
    S.ctx = new (window.AudioContext || window.webkitAudioContext)();
    var resumed = S.ctx.resume ? S.ctx.resume() : Promise.resolve();
    resumed.catch(function () {}).then(function () {
      // Register as an audio CONSUMER under the block's target — the SAME id the farm's TTS
      // delivery synthesizes to. We never send text (the workflow does); we only listen.
      S.socket = io(window.location.origin, {
        path: TTS_PATH, transports: ["websocket", "polling"], forceNew: true, timeout: 8000,
        query: { client_id: target, format: "binary" }
      });
      S.socket.on("connect", function () {
        S.socket.emit("register_audio_client", {
          main_client_id: target, connection_type: "browser", mode: "tts",
          format: "binary", voice: TTS_DEFAULT_VOICE, speed: TTS_SPEED
        });
        S.socket.emit("tts_configure_client", { client_id: target, voice: TTS_DEFAULT_VOICE, speed: TTS_SPEED });
        S.socket.emit("set_client_mode", { mode: "tts", client_id: target });
        setBtn(widget, "🔊 Speaker: on", true); repaint(node);
        console.log("[voice speaker] listening on target=", target);
      });
      S.socket.on("tts_audio_chunk", function (evt) { playChunk(S, evt); });
      S.socket.on("tts_stop_immediate", function () { S.queue = Promise.resolve(); });
      S.socket.on("connect_error", function (err) {
        notice("Could not connect to the voice service: " + (err && err.message ? err.message : "unreachable"));
        stopSpeaker(node, widget);
      });
      speakerSessions[node.id] = S;
    });
  }

  // Decode a binary WAV chunk and play it, serialized so chunks don't overlap. Reused from cv.
  function playChunk(S, evt) {
    var buf = evt && evt.audio_buffer;
    if (!buf || !S.ctx) return;
    var ab;
    if (buf instanceof ArrayBuffer) ab = buf.slice(0);
    else if (buf && buf.buffer) ab = buf.buffer.slice(0);
    else return;
    S.ctx.decodeAudioData(ab).then(function (audioBuf) {
      if (!S.ctx) return;
      S.queue = S.queue.then(function () {
        return new Promise(function (res) {
          if (!S.ctx) return res();
          var src = S.ctx.createBufferSource();
          src.buffer = audioBuf;
          src.connect(S.ctx.destination);
          src.onended = function () { res(); };
          try { src.start(); } catch (e) { res(); }
        });
      });
    }).catch(function () {});
  }

  function stopSpeaker(node, widget) {
    var S = speakerSessions[node.id];
    if (S) {
      try { if (S.socket) S.socket.disconnect(); } catch (_) {}
      try { if (S.ctx) S.ctx.close(); } catch (_) {}
      delete speakerSessions[node.id];
    }
    setBtn(widget, "🔊 Speaker: off", false); repaint(node);
  }

  function toggleSpeaker(node, widget) {
    if (speakerSessions[node.id]) { stopSpeaker(node, widget); }
    else { startSpeaker(node, widget); }
  }

  // Stop every live session (called when a project is closed/opened so audio never leaks
  // across projects or lingers on a removed node).
  function stopAll() {
    Object.keys(micSessions).forEach(function (id) {
      var S = micSessions[id];
      if (S.postRollTimer) clearTimeout(S.postRollTimer);
      try { if (S.vad) { S.vad.pause(); if (S.vad.destroy) S.vad.destroy(); } } catch (_) {}
      try { if (S.stream) S.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
      try { if (S.ctx) S.ctx.close(); } catch (_) {}
      delete micSessions[id];
    });
    Object.keys(speakerSessions).forEach(function (id) {
      var S = speakerSessions[id];
      try { if (S.socket) S.socket.disconnect(); } catch (_) {}
      try { if (S.ctx) S.ctx.close(); } catch (_) {}
      delete speakerSessions[id];
    });
  }

  global.PatronVoice = {
    toggleMic: toggleMic,
    toggleSpeaker: toggleSpeaker,
    stopAll: stopAll,
  };
})(window);
