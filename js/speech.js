// Web Speech API helpers with graceful degradation.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = navigator.standalone === true || !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches);
// iOS exposes webkitSpeechRecognition in home-screen (standalone) apps, but it never starts there:
// start() returns, no onstart/onerror fires, and the old restart-on-end loop could lock up the page.
export const recognitionBlocked = !!SR && isIOS && isStandalone;
export const canRecognize = !!SR && !recognitionBlocked;
export const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

let speaking = false;
export function isSpeaking() { return speaking; }

export function speak(text, { onend } = {}) {
  if (!canSpeak) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95; u.lang = 'en-US';
  u.onstart = () => { speaking = true; };
  u.onend = u.onerror = () => { speaking = false; onend && onend(); };
  speaking = true;
  window.speechSynthesis.speak(u);
  return true;
}
export function stopSpeaking() { if (canSpeak) window.speechSynthesis.cancel(); speaking = false; }

export const START_TIMEOUT_MS = 5000;
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported', 'bad-grammar', 'timeout', 'start-failed']);

/**
 * Guarded recognizer: reports 'on' only after the engine really starts, gives up after
 * START_TIMEOUT_MS, never restarts synchronously, caps auto-restarts, and always ends in 'off'.
 * onState(state, err): 'starting' | 'on' | 'off' | 'error'
 */
function createRecognizer({ continuous, interim, onResult, onState }) {
  if (!SR) return null;
  let rec = null, wanted = false, live = false, timer = null, restartT = null, restarts = [];
  const clear = () => { clearTimeout(timer); clearTimeout(restartT); timer = restartT = null; };
  const kill = () => { const r = rec; rec = null; if (r) { r.onstart = r.onaudiostart = r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch (_) {} } };
  const fail = (err) => { wanted = false; live = false; clear(); kill(); onState && onState('error', err); onState && onState('off', err); };
  function begin() {
    clear(); kill();
    try {
      rec = new SR();
      rec.lang = 'en-US'; rec.continuous = continuous; rec.interimResults = interim;
    } catch (e) { fail('start-failed'); return; }
    const started = () => { if (!live) { live = true; clearTimeout(timer); onState && onState('on'); } };
    rec.onstart = started; rec.onaudiostart = started;
    rec.onresult = (e) => { started(); onResult(e); };
    rec.onerror = (e) => { const err = (e && e.error) || 'error'; if (FATAL.has(err)) fail(err); else onState && onState('error', err); };
    rec.onend = () => {
      live = false; rec = null;
      if (!wanted) { clear(); onState && onState('off'); return; }
      const now = Date.now(); restarts = restarts.filter((t) => now - t < 15000); restarts.push(now);
      if (restarts.length > 4) { fail('stopped-repeatedly'); return; }
      onState && onState('starting');
      restartT = setTimeout(() => { if (wanted) begin(); }, 400); // async, so a failing engine can't spin the main thread
    };
    timer = setTimeout(() => { if (!live) fail('timeout'); }, START_TIMEOUT_MS);
    onState && onState('starting');
    try { rec.start(); } catch (e) { fail('start-failed'); }
  }
  return {
    start() { if (wanted) return; wanted = true; restarts = []; begin(); },
    stop() { const was = wanted || rec; wanted = false; live = false; clear(); const r = rec; if (r) { try { r.stop(); } catch (_) {} setTimeout(() => { if (rec === r) kill(); }, 1500); } if (was) onState && onState('off'); },
    abort() { wanted = false; live = false; clear(); kill(); onState && onState('off'); },
    get active() { return wanted; },
  };
}

/**
 * Continuous command listener. onCommand(cmd) receives one of
 * next | back | repeat | ingredients | read | close | stop
 */
export function createCommandListener({ onCommand, onState, onHeard }) {
  let lastFire = 0;
  const MAP = [
    [/\b(next|forward|continue|go on)\b/, 'next'],
    [/\b(back|previous|go back|last step)\b/, 'back'],
    [/\b(repeat|again|say that again)\b/, 'repeat'],
    [/\b(ingredients?|what do i need)\b/, 'ingredients'],
    [/\b(read( the)? step|read( it)?|what'?s next to do)\b/, 'read'],
    [/\b(close|done|hide)\b/, 'close'],
    [/\b(stop( listening)?|be quiet|quiet|silence)\b/, 'stop'],
  ];
  return createRecognizer({ continuous: true, interim: false, onState, onResult: (e) => {
    const res = e.results[e.results.length - 1];
    const said = res[0].transcript.toLowerCase().trim();
    onHeard && onHeard(said);
    if (isSpeaking()) return; // ignore our own TTS
    const now = Date.now();
    if (now - lastFire < 700) return;
    for (const [re, cmd] of MAP) if (re.test(said)) { lastFire = now; onCommand(cmd); break; }
  } });
}

/** Dictation that appends final transcripts. */
export function createDictation({ onText, onState }) {
  return createRecognizer({ continuous: true, interim: true, onState, onResult: (e) => {
    let interimText = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) onText(r[0].transcript.trim(), true); else interimText += r[0].transcript;
    }
    if (interimText) onText(interimText, false);
  } });
}

/** Friendly text for an error code. */
export function micErrorText(err) {
  return ({
    'not-allowed': 'Microphone or speech permission was denied. You can allow it in Settings, or use the keyboard’s 🎤 key below.',
    'service-not-allowed': 'Speech recognition isn’t allowed here. Use the keyboard’s 🎤 key to dictate instead.',
    'audio-capture': 'No microphone was found or it’s in use by another app.',
    network: 'Speech recognition needs a network connection.',
    timeout: 'The microphone didn’t start. Tap in the note and use the keyboard’s 🎤 key instead.',
    'start-failed': 'The microphone couldn’t start. Use the keyboard’s 🎤 key instead.',
    'stopped-repeatedly': 'Listening kept stopping, so it was turned off. Try again or use the keyboard’s 🎤 key.',
  })[err] || (err ? `Mic stopped (${err}).` : '');
}

// ---- Screen Wake Lock
let lock = null, wantLock = false;
export const canWakeLock = 'wakeLock' in navigator;
export async function requestWakeLock(onChange) {
  wantLock = true;
  if (!canWakeLock) { onChange && onChange(false, 'unsupported'); return false; }
  try {
    lock = await navigator.wakeLock.request('screen');
    onChange && onChange(true);
    lock.addEventListener('release', () => { onChange && onChange(false, 'released'); });
    return true;
  } catch (e) { onChange && onChange(false, e.name || 'error'); return false; }
}
export async function releaseWakeLock() { wantLock = false; try { await lock?.release(); } catch (_) {} lock = null; }
export function wakeLockWanted() { return wantLock; }
