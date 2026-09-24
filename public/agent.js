/* career-ops studio — the little agent in the bottom-right corner.
 *
 * It narrates REAL activity, never invented progress: terminal output actually
 * streaming, a session opening, a job window opening, the server changing state.
 * When nothing is happening it says so and goes back to kicking a pebble — an
 * idle buddy is honest, a buddy pretending to work is the thing we removed.
 */
(() => {
  const stage = document.querySelector('.stage');
  if (!stage) return;

  // ── the character ────────────────────────────────────────────────────────
  const el = document.createElement('div');
  el.className = 'buddy';
  // The bubble is visual only; a separate live region carries just the lines
  // worth hearing (events, commands), so idle quips never reach a screen reader.
  el.innerHTML = `
    <div class="buddy-bubble" id="buddy-bubble" aria-hidden="true" hidden><span id="buddy-text"></span></div>
    <span class="sr-only" role="status" id="buddy-live"></span>
    <button class="buddy-guy" id="buddy-guy" aria-label="Mute studio buddy">
      <svg viewBox="0 0 64 72" aria-hidden="true">
        <g class="b-all">
          <line class="b-ant" x1="32" y1="14" x2="32" y2="6"/>
          <circle class="b-bulb" cx="32" cy="4" r="3"/>
          <g class="b-head">
            <rect x="14" y="13" width="36" height="28" rx="10"/>
            <g class="b-eyes">
              <circle class="b-eye" cx="24" cy="27" r="3.4"/>
              <circle class="b-eye" cx="40" cy="27" r="3.4"/>
            </g>
            <path class="b-mouth" d="M27 34.5c2 2 8 2 10 0"/>
          </g>
          <g class="b-arm b-arm-l"><path d="M14 46c-5 2-7 6-7 10"/></g>
          <g class="b-arm b-arm-r"><path d="M50 46c5 2 7 6 7 10"/></g>
          <rect class="b-body" x="17" y="43" width="30" height="20" rx="7"/>
          <g class="b-leg b-leg-l"><path d="M25 63v6"/></g>
          <g class="b-leg b-leg-r"><path d="M39 63v6"/></g>
        </g>
      </svg>
    </button>`;
  stage.append(el);

  const guy = el.querySelector('#buddy-guy');
  const bubble = el.querySelector('#buddy-bubble');
  const text = el.querySelector('#buddy-text');
  const live = el.querySelector('#buddy-live');

  // ── speech ───────────────────────────────────────────────────────────────
  let muted = false;
  try { muted = localStorage.getItem('studio:buddyMuted') === '1'; } catch { /* private mode */ }

  let queue = [];
  let showing = false;
  let lastLine = '';

  function drain() {
    if (showing || !queue.length) return;
    const { line, hold } = queue.shift();
    showing = true;
    text.textContent = line;
    bubble.hidden = false;
    bubble.dataset.in = 'true';
    setTimeout(() => {
      bubble.dataset.in = 'false';
      setTimeout(() => {
        bubble.hidden = true;
        showing = false;
        drain();
      }, 220);
    }, hold);
  }

  // priority: true jumps the queue for something the user just caused.
  // idle: true keeps it out of the screen-reader live region.
  function say(line, { hold = 2600, priority = false, idle = false } = {}) {
    if (muted || !line || line === lastLine) return;
    lastLine = line;
    if (!idle) live.textContent = line;
    if (priority) queue = [{ line, hold }];
    else if (queue.length > 3) return; // never let chatter pile up
    else queue.push({ line, hold });
    drain();
  }

  // Constant label + aria-pressed: the pressed state already says "muted".
  const syncMute = () => {
    guy.setAttribute('aria-pressed', String(muted));
    guy.title = muted ? 'Click to unmute' : 'Click to mute';
  };
  syncMute();

  guy.onclick = () => {
    muted = !muted;
    try { localStorage.setItem('studio:buddyMuted', muted ? '1' : '0'); } catch { /* ignore */ }
    syncMute();
    if (muted) { queue = []; bubble.hidden = true; showing = false; }
    else { lastLine = ''; say('Back. What are we working on?', { priority: true }); }
  };

  // ── poses ────────────────────────────────────────────────────────────────
  // walk/sit/idle/work — a pose is just a class; CSS owns the motion.
  let pose = 'idle';
  let x = 0;                     // px from the right edge of its strip
  const SPAN = 150;              // how far it may wander
  const setPose = (p) => { pose = p; el.dataset.pose = p; };
  const moveTo = (nx) => { x = Math.max(0, Math.min(SPAN, nx)); el.style.setProperty('--x', `-${x}px`); };
  setPose('idle');
  moveTo(0);

  // ── busy tracking: driven by real bytes arriving from a PTY ──────────────
  let busyUntil = 0;
  const isBusy = () => Date.now() < busyUntil;
  const markBusy = (ms = 2500) => {
    busyUntil = Math.max(busyUntil, Date.now() + ms);
    if (pose !== 'work') setPose('work');
  };

  // ── idle life: it only wanders when genuinely nothing is going on ────────
  const IDLE_CHATTER = [
    'Nothing running. Just vibing.',
    'Kicking a pebble around.',
    'Waiting for you to paste a job URL.',
    'Tidying up my imaginary desk.',
    'I could scan some portals, you know.',
    'Stretching. Long day of standing here.',
    'Quiet in here. Suspiciously quiet.',
    'Counting the companies in your portals.yml.',
    'Ready when you are.',
  ];

  // A few idle lines, then quiet until the user does something: over hours of
  // use, endless chatter is noise. Hidden tab = no work at all.
  const IDLE_BUDGET = 3;
  let idleLeft = IDLE_BUDGET;
  const woke = () => { idleLeft = IDLE_BUDGET; };

  let tick = 0;
  setInterval(() => {
    if (document.hidden || isBusy()) return;
    tick++;
    if (pose === 'work') setPose('idle');

    // Wander, sit, or stand — a slow, low-key loop.
    const roll = Math.random();
    if (roll < 0.35) {
      const target = Math.round(Math.random() * SPAN);
      setPose(target > x ? 'walk-left' : 'walk-right');
      moveTo(target);
      setTimeout(() => { if (!isBusy()) setPose('idle'); }, 1400);
    } else if (roll < 0.5) {
      setPose('sit');
      setTimeout(() => { if (!isBusy()) setPose('idle'); }, 3600);
    }

    // Idle chatter, but sparse — roughly every fourth beat.
    if (tick % 4 === 0 && idleLeft > 0) {
      idleLeft--;
      say(IDLE_CHATTER[Math.floor(Math.random() * IDLE_CHATTER.length)], { idle: true });
    }
  }, 4200);

  // ── what terminal output actually means ──────────────────────────────────
  // Categories only: we report the KIND of work, never echo job or CV content.
  // Order matters: first match wins, so the unambiguous ones go first. Each
  // pattern needs an ACTION verb, not just a noun — output that merely mentions
  // "cv.md not found" is a check, not work on your CV, and saying otherwise is
  // the same lie as a progress bar that moves on its own.
  const PATTERNS = [
    [/\bcareer-ops doctor\b|\brun doctor\b/i, 'Checking the setup.'],
    [/\b(scanning|scan:|fetching)\b.*\b(portal|greenhouse|ashby|lever|workday)\b/i, 'Scanning portals for new postings.'],
    [/\b(evaluating|scoring)\b|\bblock\s*[a-h]\b/i, 'Evaluating a role.'],
    [/\b(generating|rendering|building|writing)\b[^\n]{0,24}\b(pdf|cv|resume)\b/i, 'Building your CV.'],
    [/\b(writing|drafting)\b[^\n]{0,24}\bcover letter\b/i, 'Drafting a cover letter.'],
    [/\b(updating|merging|appending)\b[^\n]{0,24}\b(tracker|pipeline)\b/i, 'Updating the tracker.'],
    [/\b(launching|starting)\b[^\n]{0,20}\b(playwright|chromium|browser)\b/i, 'Driving a browser to check a posting.'],
    [/\b(error|failed|fatal|traceback)\b/i, 'Something errored — worth a look.'],
    [/\?\s*$|\(y\/n\)|press enter/i, 'It is waiting on you to answer.'],
  ];

  const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g;
  let sinceReport = 0;

  // Public surface the shell calls into.
  window.Buddy = {
    say,
    // Raw PTY output. Real bytes = real work; that is the whole signal.
    onTerminalData(chunk) {
      markBusy();
      const clean = String(chunk).replace(ANSI, '');
      sinceReport += clean.length;
      for (const [re, line] of PATTERNS) {
        if (re.test(clean)) { say(line, { hold: 3200 }); sinceReport = 0; return; }
      }
      // Nothing recognisable, but output is genuinely flowing — say that, not
      // a fake percentage.
      if (sinceReport > 1200) {
        sinceReport = 0;
        say('Output is streaming…');
      }
    },
    // The command the user actually submitted — ground truth, no inference.
    onCommand(cmd) {
      const c = String(cmd).trim();
      if (!c) return;
      woke();
      markBusy(4000);
      const short = c.length > 42 ? c.slice(0, 42) + '…' : c;
      say(`Running: ${short}`, { priority: true, hold: 3400 });
    },
    onTyping() { woke(); markBusy(1200); say('You are typing. I will stay out of it.', { hold: 1800 }); },
    event(line, opts) { woke(); markBusy(1500); say(line, { priority: true, ...opts }); },
  };

  say('Hey — I am your studio buddy. I will tell you what is actually happening.', { hold: 4200 });
})();
