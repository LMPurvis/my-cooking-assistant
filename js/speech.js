// Web Speech API helpers with graceful degradation.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canRecognize = !!SR;
export const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

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

/**
 * Continuous command listener. onCommand(cmd) receives one of
 * next | back | repeat | ingredients | read | close | stop
 */
export function createCommandListener({ onCommand, onState, onHeard }) {
  if (!SR) return null;
  let rec = null, wanted = false, lastFire = 0;
  const MAP = [
    [/\b(next|forward|continue|go on)\b/, 'next'],
    [/\b(back|previous|go back|last step)\b/, 'back'],
    [/\b(repeat|again|say that again)\b/, 'repeat'],
    [/\b(ingredients?|what do i need)\b/, 'ingredients'],
    [/\b(read( the)? step|read( it)?|what'?s next to do)\b/, 'read'],
    [/\b(close|done|hide)\b/, 'close'],
    [/\b(stop( listening)?|be quiet|quiet|silence)\b/, 'stop'],
  ];
  function start() {
    rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      const said = res[0].transcript.toLowerCase().trim();
      onHeard && onHeard(said);
      if (isSpeaking()) return; // ignore our own TTS
      const now = Date.now();
      if (now - lastFire < 700) return;
      for (const [re, cmd] of MAP) if (re.test(said)) { lastFire = now; onCommand(cmd); break; }
    };
    rec.onerror = (e) => { onState && onState('error', e.error); if (e.error === 'not-allowed' || e.error === 'service-not-allowed') wanted = false; };
    rec.onend = () => { if (wanted) { try { rec.start(); } catch (_) {} } else onState && onState('off'); };
    try { rec.start(); onState && onState('on'); } catch (err) { onState && onState('error', String(err)); }
  }
  return {
    start() { wanted = true; start(); },
    stop() { wanted = false; try { rec && rec.stop(); } catch (_) {} onState && onState('off'); },
    get active() { return wanted; },
  };
}

/** One-shot-ish dictation that appends final transcripts. */
export function createDictation({ onText, onState }) {
  if (!SR) return null;
  let rec = null, wanted = false;
  function start() {
    rec = new SR();
    rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) onText(r[0].transcript.trim(), true); else interim += r[0].transcript;
      }
      if (interim) onText(interim, false);
    };
    rec.onerror = (e) => { onState && onState('error', e.error); wanted = false; };
    rec.onend = () => { if (wanted) { try { rec.start(); } catch (_) {} } else onState && onState('off'); };
    try { rec.start(); onState && onState('on'); } catch (err) { onState && onState('error', String(err)); }
  }
  return { start() { wanted = true; start(); }, stop() { wanted = false; try { rec && rec.stop(); } catch (_) {} }, get active() { return wanted; } };
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
