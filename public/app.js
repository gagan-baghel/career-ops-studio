/* career-ops studio — shell logic: panes, terminals, browser, palette. */
(() => {
  const $ = (id) => document.getElementById(id);
  const store = {
    get: (k, d) => {
      try { return localStorage.getItem(k) ?? d; } catch { return d; }
    },
    set: (k, v) => {
      try { localStorage.setItem(k, v); } catch { /* private mode */ }
    },
  };

  /* ── toasts ─────────────────────────────────────────────────────────── */
  // Feedback gets its own place instead of overwriting whatever text was near
  // the button. kind: info | warn. Repeats of the same message restart its timer.
  const toast = (msg, kind = 'info') => {
    const box = $('toasts');
    const same = [...box.children].find((t) => t.dataset.msg === msg);
    const el = same ?? document.createElement('div');
    if (!same) {
      el.className = 'toast';
      el.dataset.kind = kind;
      el.dataset.msg = msg;
      el.textContent = msg;
      box.append(el);
      while (box.children.length > 3) box.firstChild.remove();
    }
    clearTimeout(el.timer);
    el.timer = setTimeout(() => el.remove(), kind === 'warn' ? 6000 : 3500);
  };

  // WAI-ARIA tabs keys: arrows wrap, Home/End jump. Returns the tab to move to.
  const tabKey = (e, tabs) => {
    const i = tabs.indexOf(document.activeElement);
    const n = tabs.length;
    const j = { ArrowLeft: i - 1 + n, ArrowRight: i + 1, Home: 0, End: n - 1 }[e.key];
    if (i < 0 || j === undefined) return null;
    e.preventDefault();
    return tabs[j % n];
  };

  /* ── theme ──────────────────────────────────────────────────────────── */
  const applyTheme = (t) => {
    document.documentElement.classList.toggle('dark', t === 'dark');
    store.set('studio:theme', t);
    terminals.forEach((s) => (s.term.options.theme = xtermTheme()));
  };
  $('btn-theme').onclick = () =>
    applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const xtermTheme = () => {
    const dark = document.documentElement.classList.contains('dark');
    return {
      background: css('--term-bg'),
      foreground: css('--fg'),
      cursor: css('--brand'),
      cursorAccent: css('--term-bg'),
      selectionBackground: dark ? '#ffffff28' : '#00000020',
      black: dark ? '#161616' : '#f2f1ed',
      brightBlack: css('--faint'),
      red: '#e5534b', brightRed: '#ff6b61',
      green: '#3fb950', brightGreen: '#56d364',
      yellow: '#d29922', brightYellow: '#e3b341',
      blue: '#4f8cc9', brightBlue: '#6cb6ff',
      magenta: '#bc8cff', brightMagenta: '#d2a8ff',
      cyan: '#39c5cf', brightCyan: '#56d4dd',
      white: dark ? '#d4d4d4' : '#2b2b2b',
      brightWhite: dark ? '#fafafa' : '#111111',
    };
  };

  /* ── panes ──────────────────────────────────────────────────────────── */
  const segs = [...document.querySelectorAll('.seg')];
  const onJobs = () => $('pane-browser').dataset.active === 'true';

  // focus: move into the URL field (user switched, not arrow-keying or restoring).
  const showPane = (name, { focus = true, announce = true } = {}) => {
    segs.forEach((b) => {
      const sel = b.dataset.pane === name;
      b.setAttribute('aria-selected', String(sel));
      b.tabIndex = sel ? 0 : -1;
    });
    $('pane-app').dataset.active = String(name === 'app');
    $('pane-browser').dataset.active = String(name === 'browser');
    store.set('studio:pane', name);
    if (focus && name === 'browser') $('url-input').focus();
    if (announce) {
      window.Buddy?.event(
        name === 'browser' ? 'Jobs pane. Pick a company or paste a URL.' : 'Back to the workspace.',
      );
    }
  };
  segs.forEach((b) => {
    const pane = $(`pane-${b.dataset.pane}`);
    b.id = `tab-${b.dataset.pane}`;
    b.setAttribute('aria-controls', pane.id);
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', b.id);
    b.onclick = () => showPane(b.dataset.pane);
  });
  segs[0].parentElement.addEventListener('keydown', (e) => {
    const t = tabKey(e, segs);
    if (!t) return;
    showPane(t.dataset.pane, { focus: false });
    t.focus();
  });
  showPane(store.get('studio:pane') === 'browser' ? 'browser' : 'app', { focus: false, announce: false });

  /* ── workspace boot state ───────────────────────────────────────────── */
  let webUrl = 'http://localhost:3000';
  let lastWeb = null; // previous web state, or 'offline' when the studio itself is gone
  const overlay = $('app-overlay');
  const BOOT_COPY = [overlay.querySelector('h2').textContent, overlay.querySelector('p').textContent];

  let lastState = null;
  // Startup stages from facts the server reports; no step advances on a timer.
  const steps = (studio, install, webStep) => {
    const set = { studio, install, web: webStep };
    $('boot-steps').querySelectorAll('li').forEach((li) => (li.dataset.state = set[li.dataset.step]));
  };
  const setStatus = (state, text) => {
    $('status').querySelector('.dot').dataset.state = state;
    $('status-text').textContent = text;
  };
  const showOverlay = ([title, body], busy) => {
    overlay.hidden = false;
    overlay.querySelector('.spinner').style.display = busy ? '' : 'none';
    overlay.querySelector('h2').textContent = title;
    overlay.querySelector('p').textContent = body;
  };

  async function pollState() {
    let s;
    try {
      s = await (await fetch('/api/state')).json();
    } catch {
      if (lastWeb !== 'offline') {
        window.Buddy?.event('Lost the studio server.');
        setStatus('down', 'studio offline');
        showOverlay(
          ["The studio server isn't running",
            'Start it with `get me hired` or `npm start` — this page reconnects on its own.'],
          false,
        );
        $('boot-log').textContent = '';
        $('btn-retry').hidden = true;
      }
      lastWeb = 'offline';
      lastState = null;
      steps('fail', 'pending', 'pending');
      renderSys();
      setTimeout(pollState, 2000);
      return;
    }
    const prev = lastWeb;
    lastWeb = s.web;
    webUrl = s.webUrl;
    lastState = s;
    if (!s.installed) steps('done', 'fail', 'pending');
    else steps('done', 'done', { ready: 'done', down: 'fail' }[s.web] ?? 'active');
    renderSys();

    if (s.web === 'ready') {
      if (prev !== 'ready') {
        window.Buddy?.event('Workspace is up. We are in business.');
        setStatus('ready', 'workspace ready');
        // Coming back from a crash or restart the frame still shows the dead
        // page; reassigning src reloads it even when the URL is unchanged.
        // A restart can move the workspace to another port; follow it.
        const frame = $('app-frame');
        const same = frame.src && new URL(frame.src).origin === new URL(webUrl).origin;
        frame.src = same ? frame.src : webUrl;
        overlay.hidden = true;
      }
      setTimeout(pollState, 3000);
      return;
    }
    if (s.web === 'down') {
      if (prev !== 'down') {
        window.Buddy?.event('The workspace server stopped. Check the log.');
        setStatus('down', 'server stopped');
        showOverlay(
          ['Workspace server stopped', 'The career-ops web server is not running. The log below says why.'],
          false,
        );
        $('btn-retry').hidden = false;
      }
    } else if (prev !== 'starting') {
      setStatus('starting', 'starting…');
      showOverlay(BOOT_COPY, true);
      $('btn-retry').hidden = true;
    }
    // Own try: a log hiccup is not the studio going offline.
    try {
      $('boot-log').textContent = (await (await fetch('/api/log')).text()).trim().split('\n').slice(-14).join('\n');
      $('boot-log').scrollTop = $('boot-log').scrollHeight;
    } catch { /* next tick retries */ }
    setTimeout(pollState, 900);
  }
  const restartWeb = async () => {
    $('btn-retry').hidden = true;
    const r = await fetch('/api/restart', { method: 'POST' }).catch(() => null);
    if (r?.status === 409) return toast('The workspace is already starting.');
    if (!r?.ok) return toast('Could not reach the studio server.', 'warn');
    $('app-frame').removeAttribute('src');
    toast('Restarting the workspace…');
  };
  $('btn-retry').onclick = restartWeb;
  pollState();

  /* ── terminal drawer ────────────────────────────────────────────────── */
  const drawer = $('drawer');
  const terminals = new Map();
  let activeTerm = null;
  let seq = 0;

  // wantH is what the user chose; the window may be too short to honour it now.
  const clampH = (h) => Math.max(120, Math.min(h, window.innerHeight - 160));
  let wantH = parseInt(store.get('studio:drawerH', '320'), 10);
  if (!Number.isFinite(wantH)) wantH = 320;
  const applyDrawerH = () => drawer.style.setProperty('--drawer-h', clampH(wantH) + 'px');
  applyDrawerH();

  const drawerOpen = (open) => {
    drawer.dataset.open = String(open);
    $('btn-terminal').setAttribute('aria-pressed', String(open));
    if (open) {
      if (!terminals.size) newSession('shell');
      requestAnimationFrame(() => {
        fitActive();
        terminals.get(activeTerm)?.term.focus();
      });
    }
  };
  const toggleDrawer = () => {
    const next = drawer.dataset.open !== 'true';
    window.Buddy?.event(next ? 'Terminal up.' : 'Tucking the terminal away.');
    drawerOpen(next);
  };
  $('btn-terminal').onclick = toggleDrawer;
  $('btn-hide-term').onclick = () => drawerOpen(false);

  // Drag-to-resize.
  const resizer = $('resizer');
  resizer.addEventListener('pointerdown', (e) => {
    resizer.setPointerCapture(e.pointerId);
    resizer.dataset.dragging = 'true';
    const move = (ev) => {
      wantH = clampH(window.innerHeight - ev.clientY);
      applyDrawerH();
      fitActive();
    };
    const up = () => {
      resizer.dataset.dragging = 'false';
      store.set('studio:drawerH', String(wantH));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  // Keyboard resize for the focusable separator: arrows nudge, Home/End jump.
  resizer.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 96 : 24;
    const to = { ArrowUp: wantH + step, ArrowDown: wantH - step, Home: Infinity, End: 0 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    wantH = clampH(to);
    applyDrawerH();
    store.set('studio:drawerH', String(wantH));
    fitActive();
  });

  function fitActive() {
    const s = terminals.get(activeTerm);
    if (!s || drawer.dataset.open !== 'true') return;
    try {
      s.fit.fit();
      if (s.ws.readyState === 1) {
        s.ws.send(JSON.stringify({ type: 'resize', cols: s.term.cols, rows: s.term.rows }));
      }
    } catch { /* host not laid out yet */ }
  }
  window.addEventListener('resize', () => {
    applyDrawerH();
    fitActive();
  });

  function newSession(want) {
    const kind = want === 'claude' ? 'claude' : 'shell';
    const id = `t${++seq}`;
    const name = `${kind === 'claude' ? 'claude' : 'zsh'} ${seq}`;
    const host = document.createElement('div');
    host.className = 'term-host';
    $('term-stage').append(host);

    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.35,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 8000,
      theme: xtermTheme(),
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon.WebLinksAddon());
    term.open(host);

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/pty?cmd=${kind}`);
    ws.binaryType = 'arraybuffer';
    const enc = new TextEncoder();

    // Events land after closeSession has disposed the terminal; it is gone from
    // the map by then, so that is the liveness check.
    ws.onopen = () => {
      if (!terminals.has(id)) return;
      fit.fit();
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    ws.onmessage = (e) => {
      const s = terminals.get(id);
      if (!s) return;
      const payload = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
      term.write(payload);
      window.Buddy?.onTerminalData(payload);
      s.tail = (s.tail + payload).slice(-4000);
      clearTimeout(s.settle);
      s.settle = setTimeout(() => deliver(s), SETTLE_MS);
    };
    // error is always followed by close; whichever comes first marks it dead
    // so sendToTerminal never picks a tab that would swallow the text.
    ws.onerror = ws.onclose = () => {
      const s = terminals.get(id);
      if (!s || s.dead) return;
      s.dead = true;
      tab.dataset.state = 'ended';
      tab.setAttribute('aria-label', `${name} session, ended`);
      term.write('\r\n\x1b[38;5;245m— disconnected —\x1b[0m\r\n');
    };
    // Keystrokes go as binary frames; control messages as text. No escaping needed.
    // Mirror what the user is composing so the buddy can report the real
    // command instead of guessing from output. Printable chars only; backspace
    // rubs one out. Nothing is stored or sent anywhere.
    let composing = '';
    term.onData((d) => {
      if (ws.readyState !== 1) return;
      ws.send(enc.encode(d));
      // A keystroke answers whatever prompt was up; judge only what redraws next.
      const s = terminals.get(id);
      if (s) s.tail = '';
      if (d === '\r') {
        window.Buddy?.onCommand(composing);
        composing = '';
      } else if (d === '\x7f') composing = composing.slice(0, -1);
      else if (d >= ' ' && d.length === 1) composing += d;
    });

    // One button per tab, no nested interactive: the ✕ is mouse sugar, and
    // Delete/Backspace or middle-click close it from the keyboard or wheel.
    const tab = document.createElement('button');
    tab.className = 'term-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-label', `${name} session`);
    tab.title = `${name} — middle-click or Delete to close`;
    tab.innerHTML = `<span></span><span class="close" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></span>`;
    tab.firstChild.textContent = name;
    tab.onclick = (e) => (e.target.closest('.close') ? closeSession(id) : selectSession(id));
    tab.onmousedown = (e) => e.button === 1 && e.preventDefault(); // no autoscroll cursor
    tab.onauxclick = (e) => e.button === 1 && closeSession(id);
    $('term-tabs').append(tab);

    terminals.set(id, { term, fit, ws, host, tab, kind, dead: false, tail: '', settle: 0, ready: false, pending: [] });
    selectSession(id);
    window.Buddy?.event(
      kind === 'claude' ? 'Opening a Claude session for you.' : 'New shell, rooted in the workspace.',
    );
    return id;
  }

  $('term-tabs').setAttribute('role', 'tablist');
  $('term-tabs').setAttribute('aria-label', 'Terminal sessions');
  $('term-tabs').addEventListener('keydown', (e) => {
    const entries = [...terminals];
    const cur = entries.find(([, s]) => s.tab === document.activeElement);
    if (!cur) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      return closeSession(cur[0], { keyboard: true });
    }
    const t = tabKey(e, entries.map(([, s]) => s.tab));
    if (!t) return;
    selectSession(entries.find(([, s]) => s.tab === t)[0], { focusTerm: false });
    t.focus();
  });

  function selectSession(id, { focusTerm = true } = {}) {
    activeTerm = id;
    terminals.forEach((s, key) => {
      const on = key === id;
      s.host.dataset.active = String(on);
      s.tab.dataset.active = String(on);
      s.tab.setAttribute('aria-selected', String(on));
      s.tab.tabIndex = on ? 0 : -1;
    });
    requestAnimationFrame(() => {
      fitActive();
      if (focusTerm) terminals.get(id)?.term.focus();
    });
  }

  function closeSession(id, { keyboard = false } = {}) {
    const s = terminals.get(id);
    if (!s) return;
    terminals.delete(id); // first, so late ws events see it as gone
    clearTimeout(s.settle);
    s.ws.close();
    s.term.dispose();
    s.host.remove();
    s.tab.remove();
    const next = terminals.keys().next();
    if (next.done) {
      drawerOpen(false);
      if (keyboard) $('btn-terminal').focus();
    } else {
      selectSession(next.value, { focusTerm: !keyboard });
      if (keyboard) terminals.get(next.value).tab.focus();
    }
  }

  $('btn-new-shell').onclick = () => newSession('shell');
  $('btn-new-claude').onclick = () => newSession('claude');

  // A fresh session is still booting (Claude draws its UI, may ask "trust this
  // folder?"). Text written now lands in that dialog or is dropped, so queue it
  // until output has been quiet for SETTLE_MS and no confirm prompt is showing.
  // The user answering the prompt redraws, which re-arms the check.
  const SETTLE_MS = 900;
  const PROMPT = /enter\s*to\s*confirm|trust\s*this\s*folder|\(y\/n\)|press\s*enter\s*to\s*continue/i;
  // TUIs (Claude's included) move the cursor instead of printing spaces.
  const plain = (t) => t.replace(/\x1b\[\d*C/g, ' ').replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, '');
  function deliver(s) {
    if (s.dead || s.ws.readyState !== 1) return;
    if (PROMPT.test(plain(s.tail).slice(-1200))) {
      if (s.pending.length) window.Buddy?.event('Answer the prompt in the terminal — the URL follows.');
      return;
    }
    s.ready = true;
    while (s.pending.length) s.ws.send(s.pending.shift());
  }

  // Write text into a live terminal. Without submit the user presses Enter.
  // Control chars are stripped: this text can originate from a clipboard or a
  // web page, and ESC / ^C / bracketed-paste markers would be typed straight
  // into the shell. A caller that means to run something asks for submit.
  function sendToTerminal(text, prefer = 'claude', { submit = false } = {}) {
    const kind = prefer === 'claude' ? 'claude' : 'shell';
    const bytes = new TextEncoder().encode(
      String(text).replace(/[\x00-\x1f\x7f-\x9f]/g, '') + (submit ? '\r' : ''),
    );
    // Always land in a live session of the right kind — a job URL pasted into a
    // bare shell does nothing, so open a Claude session if none is running yet.
    // Pick it before opening the drawer, or an empty drawer spawns a spare shell.
    const live = ([, s] = []) => s && s.kind === kind && !s.dead && s.ws.readyState <= 1;
    const cur = [activeTerm, terminals.get(activeTerm)];
    const id = live(cur) ? activeTerm : [...terminals].find(live)?.[0] ?? newSession(kind);
    drawerOpen(true);
    selectSession(id);
    const s = terminals.get(id);
    if (s.ready && s.ws.readyState === 1) return s.ws.send(bytes);
    s.pending.push(bytes);
    s.ws.addEventListener('close', () => s.pending.length && flash('That session ended before the text could be sent — try again.'), { once: true });
  }

  /* ── jobs pane ──────────────────────────────────────────────────────── */
  // A real top-level window, not an iframe: X-Frame-Options and CSP only apply
  // to framing, so nothing can refuse to load, and your existing logins work.
  // It is named, so every job reuses the same window instead of spawning tabs.
  const WINDOW_NAME = 'careerOpsJob';
  let jobWindow = null;
  let opened = null;
  let wasLive = false;

  const flash = (msg) => toast(msg, 'warn');

  // Trust boundary: this string comes from a clipboard or a text field and ends
  // up typed into a real PTY and window.open. Only a well-formed http(s) URL
  // gets through, and u.href percent-encodes anything control-shaped.
  const parseUrl = (raw) => {
    let v = String(raw ?? '').trim();
    const found = v.match(/https?:\/\/[^\s<>"'`\x00-\x1f\x7f]+/i);
    if (found) v = found[0].replace(/[.,;:!?)\]}]+$/, ''); // sentence punctuation around it
    else if (!v || /\s/.test(v) || /^[a-z][a-z\d+.-]*:(?!\d)/i.test(v)) return null; // prose, or javascript:/mailto:
    else v = `https://${v}`;
    try {
      const u = new URL(v);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
      return u.href;
    } catch {
      return null;
    }
  };

  // Right half of the available screen, so it sits beside the studio.
  const features = () => {
    const w = Math.max(Math.floor(screen.availWidth / 2), 640);
    const h = screen.availHeight;
    const left = screen.availLeft + (screen.availWidth - w);
    return `popup=yes,width=${w},height=${h},left=${left},top=${screen.availTop}`;
  };

  function open(raw) {
    const url = parseUrl(raw);
    if (!url) return flash('That is not an http(s) address I can open.');
    $('url-input').value = url;
    opened = url;
    // Reusing the name keeps every posting in one window; features are honoured
    // on first open, and the browser just navigates the existing one after that.
    window.Buddy?.event(`Opening ${new URL(url).hostname} beside you.`);
    jobWindow = window.open(url, WINDOW_NAME, features());
    if (!jobWindow) {
      return flash('Your browser blocked the window. Allow pop-ups for localhost, then try again.');
    }
    jobWindow.focus();
    remember(url);
    syncWindowState();
  }

  function syncWindowState() {
    const live = !!jobWindow && !jobWindow.closed;
    // Polled every second: speak on the transition only, not every tick.
    if (wasLive && !live) window.Buddy?.event('Job window closed.');
    wasLive = live;
    $('window-state').hidden = !live;
    if (live) {
      try {
        $('window-label').textContent = new URL(opened).hostname;
      } catch {
        $('window-label').textContent = 'job window open';
      }
    }
    $('b-evaluate').disabled = !$('url-input').value.trim();
  }
  setInterval(syncWindowState, 1000);

  $('url-form').onsubmit = (e) => {
    e.preventDefault();
    open($('url-input').value);
  };
  $('b-open').onclick = () => open($('url-input').value);
  $('url-input').oninput = syncWindowState;

  // The job window is cross-origin, so the studio cannot read where you browsed
  // to. Copy the address there (⌘L ⌘C) and this pulls it back in one click.
  const pasteUrl = async () => {
    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return flash('Clipboard access was denied — paste into the field above instead.');
    }
    const url = parseUrl(text);
    if (!url) return flash('Clipboard has no http(s) URL in it.');
    $('url-input').value = url;
    opened = url;
    syncWindowState();
    window.Buddy?.event('Pulled that address off your clipboard.');
  };
  $('b-paste').onclick = pasteUrl;

  const closeJobWindow = () => {
    if (jobWindow && !jobWindow.closed) jobWindow.close();
    syncWindowState();
  };
  $('b-focus').onclick = () => jobWindow && !jobWindow.closed && jobWindow.focus();
  $('b-close-win').onclick = closeJobWindow;

  const evaluate = () => {
    const raw = $('url-input').value;
    const url = parseUrl(raw);
    if (!url) return flash(raw.trim() ? 'Only http(s) job links can go to Claude.' : 'Paste a job URL first.');
    $('url-input').value = url;
    // Pasting a job URL is career-ops' documented auto-pipeline trigger. We stage
    // it in the terminal — never send it — so the human stays in the loop.
    window.Buddy?.event('Handing that job URL to Claude — press Enter to run it.', { hold: 4200 });
    sendToTerminal(url);
    remember(url, { evaluated: true });
  };
  $('b-evaluate').onclick = evaluate;

  /* ── recent postings ─────────────────────────────────────────────────── */
  // What you opened or sent to Claude, newest first. A per-browser convenience:
  // localStorage, capped, and every entry re-validated on the way back in.
  const RECENT_KEY = 'studio:recent';
  const RECENT_MAX = 25;
  let recent = [];
  try {
    const raw = JSON.parse(store.get(RECENT_KEY, '[]'));
    recent = (Array.isArray(raw) ? raw : [])
      .map((r) => ({ url: parseUrl(r?.url), at: Number(r?.at) || 0, evaluated: !!r?.evaluated }))
      .filter((r) => r.url)
      .slice(0, RECENT_MAX);
  } catch { /* corrupt entry: start empty */ }
  const saveRecent = () => store.set(RECENT_KEY, JSON.stringify(recent));

  const remember = (url, { evaluated = false } = {}) => {
    const old = recent.find((r) => r.url === url);
    recent = [{ url, at: Date.now(), evaluated: evaluated || !!old?.evaluated }, ...recent.filter((r) => r !== old)]
      .slice(0, RECENT_MAX);
    saveRecent();
    renderRecent();
  };

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const ago = (t) => {
    const s = (t - Date.now()) / 1000;
    for (const [unit, n] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
      if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), unit);
    }
    return 'just now';
  };

  // The tracked company a posting belongs to: same host, longest path prefix.
  const companyFor = (url) => {
    let u;
    try { u = new URL(url); } catch { return null; }
    let best = null;
    for (const c of companies) {
      let cu;
      try { cu = new URL(c.url); } catch { continue; }
      const base = cu.pathname.replace(/\/$/, '');
      if (cu.hostname === u.hostname && u.pathname.startsWith(base) && (!best || base.length > best.len)) {
        best = { c, len: base.length };
      }
    }
    return best?.c ?? null;
  };

  const iconBtn = (label, path, onclick) => {
    const b = document.createElement('button');
    b.className = 'icon-btn sm';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`; // constant markup only
    b.onclick = onclick;
    return b;
  };
  const I_OPEN = '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>';
  const I_EVAL = '<path d="m12 3 2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4Z"/>';
  const I_DROP = '<path d="M6 6l12 12M18 6 6 18"/>';

  function renderRecent() {
    $('recent-empty').hidden = recent.length > 0;
    $('b-clear-recent').hidden = recent.length === 0;
    $('recent-list').replaceChildren(
      ...recent.map((r) => {
        const u = new URL(r.url);
        const li = document.createElement('li');
        li.className = 'recent';
        const main = document.createElement('button');
        main.className = 'recent-main';
        main.title = `${r.url}\nClick to load into the address bar`;
        const title = document.createElement('span');
        title.className = 'r-title';
        title.textContent = companyFor(r.url)?.name ?? u.hostname.replace(/^www\./, '');
        const sub = document.createElement('span');
        sub.className = 'r-sub';
        sub.textContent = `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
        main.append(title, sub);
        main.onclick = () => {
          $('url-input').value = r.url;
          syncWindowState();
          $('url-input').focus();
        };
        const meta = document.createElement('span');
        meta.className = 'r-meta';
        if (r.evaluated) {
          const tag = document.createElement('span');
          tag.className = 'tag brand';
          tag.textContent = 'Evaluated';
          meta.append(tag);
        }
        const when = document.createElement('time');
        when.dateTime = new Date(r.at).toISOString();
        when.textContent = ago(r.at);
        meta.append(when);
        const actions = document.createElement('span');
        actions.className = 'r-actions';
        actions.append(
          iconBtn('Open beside', I_OPEN, () => open(r.url)),
          iconBtn('Evaluate with Claude', I_EVAL, () => (($('url-input').value = r.url), evaluate())),
          iconBtn('Remove from recent', I_DROP, () => {
            recent = recent.filter((x) => x !== r);
            saveRecent();
            renderRecent();
          }),
        );
        li.append(main, meta, actions);
        return li;
      }),
    );
  }
  $('b-clear-recent').onclick = () => {
    const kept = recent;
    recent = [];
    saveRecent();
    renderRecent();
    toast(`Cleared ${kept.length} recent posting${kept.length === 1 ? '' : 's'}.`);
  };
  setInterval(() => recent.length && onJobs() && renderRecent(), 60_000); // keep "5 minutes ago" honest

  /* ── tracked companies ──────────────────────────────────────────────── */
  // Sourced from the workspace's own portals.yml, grouped by its own section
  // headings, with a few aggregators appended so the pane is useful before
  // portals is set up.
  const FEEDS = [
    { name: "HN Who's hiring", url: 'https://news.ycombinator.com/submitted?id=whoishiring' },
    { name: 'Work at a Startup', url: 'https://www.workatastartup.com/jobs' },
    { name: 'Wellfound', url: 'https://wellfound.com/jobs' },
  ].map((f) => ({ ...f, group: 'Job feeds', ats: null, notes: null }));
  let companies = [];
  let tracked = 0;
  let hits = [];
  let group = store.get('studio:group', 'All');
  let showAll = false;
  const MAX_CHIPS = 60;

  const launch = (c) => {
    window.Buddy?.event(`Looking up ${c.name}.`);
    open(c.url);
  };

  function renderGroups() {
    const counts = new Map([['All', companies.length]]);
    companies.forEach((c) => counts.set(c.group, (counts.get(c.group) ?? 0) + 1));
    if (!counts.has(group)) group = 'All';
    $('group-filter').replaceChildren(
      ...[...counts].map(([name, n]) => {
        const b = document.createElement('button');
        b.className = 'group';
        b.setAttribute('aria-pressed', String(name === group));
        const label = document.createElement('span');
        label.textContent = name;
        const count = document.createElement('span');
        count.className = 'n';
        count.textContent = n;
        b.append(label, count);
        b.onclick = () => {
          group = name;
          store.set('studio:group', name);
          showAll = false;
          renderGroups();
          renderChips();
        };
        return b;
      }),
    );
  }

  function renderChips() {
    const words = $('company-filter').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    hits = companies.filter((c) => {
      if (group !== 'All' && c.group !== group) return false;
      const hay = `${c.name} ${c.group} ${c.ats ?? ''} ${c.notes ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const shown = showAll ? hits : hits.slice(0, MAX_CHIPS);
    $('quick-chips').replaceChildren(
      ...shown.map((c) => {
        const b = document.createElement('button');
        b.className = 'chip';
        const name = document.createElement('span');
        name.textContent = c.name;
        b.append(name);
        if (c.ats) {
          const ats = document.createElement('span');
          ats.className = 'ats';
          ats.textContent = c.ats;
          b.append(ats);
        }
        b.title = c.notes ? `${c.notes}\n${c.url}` : c.url;
        b.onclick = () => launch(c);
        return b;
      }),
    );
    $('b-show-all').hidden = hits.length <= MAX_CHIPS;
    $('b-show-all').textContent = showAll ? 'Show fewer' : `Show all ${hits.length}`;
    $('portal-count').textContent = hits.length
      ? `${shown.length} of ${hits.length}${group === 'All' ? '' : ` in ${group}`} — Enter opens the first.`
      : tracked
        ? 'No match. Paste any URL in the address bar instead.'
        : 'No portals.yml yet — set up companies on the Portals page of the workspace.';
  }

  $('b-show-all').onclick = () => {
    showAll = !showAll;
    renderChips();
  };
  $('company-filter').oninput = () => {
    showAll = false;
    renderChips();
  };
  $('company-filter').onkeydown = (e) => {
    const v = e.target.value.trim();
    if (!v) return; // let Escape fall through to the drawer
    if (e.key === 'Escape') {
      e.preventDefault();
      e.target.value = '';
      renderChips();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // A scheme is unambiguous; a bare dotted host only counts when no tracked
      // company matches, so "scale.ai" still finds a company named that.
      if (/^https?:\/\//i.test(v) || (!hits.length && /^\S+\.\S+$/.test(v))) open(v);
      else if (hits[0]) launch(hits[0]);
    }
  };

  const loadCompanies = (list) => {
    tracked = list.length;
    companies = [...list, ...FEEDS];
    const sections = new Set(list.map((c) => c.group)).size;
    $('portal-total').textContent = tracked ? `${tracked} tracked · ${sections} section${sections === 1 ? '' : 's'}` : '';
    renderGroups();
    renderChips();
    renderRecent(); // company names for recent rows
  };
  fetch('/api/portals')
    .then((r) => r.json())
    .then((list) => loadCompanies(Array.isArray(list) ? list : []))
    .catch(() => loadCompanies([]));
  renderRecent();

  syncWindowState();

  /* ── command palette ────────────────────────────────────────────────── */
  const palette = $('palette');
  const pInput = $('palette-input');
  const pList = $('palette-list');
  let pItems = [];
  let pIndex = 0;

  pInput.setAttribute('role', 'combobox');
  pInput.setAttribute('aria-controls', 'palette-list');
  pInput.setAttribute('aria-autocomplete', 'list');
  pInput.setAttribute('aria-expanded', 'false');
  palette.addEventListener('close', () => pInput.setAttribute('aria-expanded', 'false'));

  const nav = (path) => {
    showPane('app');
    $('app-frame').src = webUrl + path;
  };

  const COMMANDS = [
    { label: 'Today', hint: 'workspace', run: () => nav('/') },
    { label: 'Pipeline', hint: 'workspace', run: () => nav('/pipeline') },
    { label: 'Explore', hint: 'workspace', run: () => nav('/explore') },
    { label: 'Follow-ups', hint: 'workspace', run: () => nav('/followups') },
    { label: 'Portals', hint: 'workspace', run: () => nav('/portals') },
    { label: 'Analytics', hint: 'workspace', run: () => nav('/analytics') },
    { label: 'CV', hint: 'workspace', run: () => nav('/cv') },
    { label: 'Config', hint: 'workspace', run: () => nav('/config') },
    { label: 'Open jobs pane', hint: '⌘2', run: () => showPane('browser') },
    { label: 'Evaluate current URL', hint: 'jobs', run: evaluate },
    { label: 'Paste job URL from clipboard', hint: 'jobs', run: () => (showPane('browser'), pasteUrl()) },
    { label: 'Close job window', hint: 'jobs', run: closeJobWindow },
    { label: 'Toggle terminal', hint: '⌃`', run: toggleDrawer },
    { label: 'New shell session', hint: '', run: () => (drawerOpen(true), newSession('shell')) },
    { label: 'New Claude session', hint: '', run: () => (drawerOpen(true), newSession('claude')) },
    { label: 'Run doctor', hint: 'terminal', run: () => sendToTerminal('npm run doctor', 'shell', { submit: true }) },
    { label: 'Restart workspace server', hint: 'workspace', run: restartWeb },
    { label: 'Toggle studio theme', hint: 'chrome only', run: () => $('btn-theme').click() },
    { label: 'System status', hint: 'workspace, terminals, log', run: () => sys.showPopover() },
    { label: 'Keyboard shortcuts', hint: '?', run: () => showShortcuts() },
    { label: 'Clear recent postings', hint: 'jobs', run: () => $('b-clear-recent').click() },
  ];

  function renderPalette() {
    // Every word must appear somewhere in label or hint: "new cl" finds Claude.
    const words = pInput.value.toLowerCase().split(/\s+/).filter(Boolean);
    pItems = COMMANDS.filter((c) => {
      const hay = `${c.label} ${c.hint}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    pIndex = 0;
    const rows = pItems.map((c, i) => {
      const li = document.createElement('li');
      li.id = `palette-opt-${i}`;
      li.setAttribute('role', 'option');
      const label = document.createElement('span');
      label.textContent = c.label;
      li.append(label);
      if (c.hint) {
        const kbd = document.createElement('span');
        kbd.className = 'kbd';
        kbd.textContent = c.hint;
        li.append(kbd);
      }
      li.onclick = () => run(i);
      // mousemove, not mouseenter: rows scrolling under a still cursor during
      // keyboard navigation must not steal the highlight.
      li.onmousemove = () => pIndex !== i && ((pIndex = i), highlight());
      return li;
    });
    if (!rows.length) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-disabled', 'true');
      li.dataset.empty = 'true';
      li.textContent = 'No matching command';
      rows.push(li);
    }
    pList.replaceChildren(...rows);
    highlight();
  }
  const highlight = () => {
    [...pList.children].forEach((li, i) =>
      li.setAttribute('aria-selected', String(i === pIndex && !!pItems[i])),
    );
    const cur = pItems[pIndex] && pList.children[pIndex];
    if (cur) {
      pInput.setAttribute('aria-activedescendant', cur.id);
      cur.scrollIntoView({ block: 'nearest' });
    } else pInput.removeAttribute('aria-activedescendant');
  };
  const run = (i) => {
    const cmd = pItems[i];
    if (!cmd) return; // the "no match" row
    palette.close();
    window.Buddy?.event(`Running: ${cmd.label}.`);
    cmd.run();
  };

  const openPalette = () => {
    pInput.value = '';
    renderPalette();
    palette.showModal();
    pInput.setAttribute('aria-expanded', 'true');
    pInput.focus();
  };
  $('btn-palette').onclick = openPalette;
  pInput.oninput = renderPalette;
  pInput.onkeydown = (e) => {
    const n = pItems.length;
    const to = { ArrowDown: pIndex + 1, ArrowUp: pIndex - 1 + n, Home: 0, End: n - 1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      if (n) (pIndex = to % n), highlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(pIndex);
    }
  };

  /* ── system panel ───────────────────────────────────────────────────── */
  // Everything the studio knows about itself, in one place: the popover opens
  // from the status pill and refreshes while it is open.
  const sys = $('sys-panel');
  const sysOpen = () => sys.matches(':popover-open');
  const WEB_TEXT = { ready: 'Ready', starting: 'Starting…', down: 'Stopped' };

  async function renderSys() {
    if (!sysOpen()) return;
    const s = lastState;
    $('sys-dot').dataset.state = s ? s.web : 'down';
    $('sys-web').textContent = s
      ? `${WEB_TEXT[s.web] ?? s.web} · ${s.web === 'ready' ? 'started' : 'changed'} ${ago(s.since)}`
      : 'Studio server offline';
    $('sys-url').textContent = $('sys-url').href = webUrl;
    $('sys-root').textContent = s?.root ?? '—';
    const live = [...terminals.values()].filter((t) => !t.dead).length;
    $('sys-terms').textContent = `${live ? `${live} open` : 'None open'}${s && s.terminals !== live ? ` · ${s.terminals} on the server` : ''}`;
    $('sys-job').textContent = jobWindow && !jobWindow.closed ? new URL(opened).hostname : 'Closed';
    $('sys-restart').disabled = !s || s.web === 'starting';
    try {
      const log = (await (await fetch('/api/log')).text()).trim().split('\n').slice(-30).join('\n');
      const pre = $('sys-log');
      const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
      pre.textContent = log || 'No log output yet.';
      if (atEnd) pre.scrollTop = pre.scrollHeight; // don't yank someone reading back
    } catch { /* offline: the header already says so */ }
  }

  let sysTimer = 0;
  sys.addEventListener('beforetoggle', (e) => {
    $('status').setAttribute('aria-expanded', String(e.newState === 'open'));
    if (e.newState !== 'open') return clearInterval(sysTimer);
    // Anchor under the pill; the CSS keeps it on-screen on narrow windows.
    const r = $('status').getBoundingClientRect();
    sys.style.top = `${r.bottom + 8}px`;
    sys.style.right = `${Math.max(8, innerWidth - r.right)}px`;
    sysTimer = setInterval(renderSys, 2000);
  });
  sys.addEventListener('toggle', (e) => e.newState === 'open' && renderSys());
  $('sys-restart').onclick = async () => {
    await restartWeb();
    renderSys();
  };
  $('sys-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(lastState?.root ?? '');
      toast('Folder path copied.');
    } catch {
      toast('Clipboard access was denied.', 'warn');
    }
  };

  /* ── keyboard shortcuts sheet ───────────────────────────────────────── */
  const sheet = $('shortcuts');
  const showShortcuts = () => sheet.open || sheet.showModal();
  $('btn-help').onclick = showShortcuts;

  /* ── global keys ────────────────────────────────────────────────────── */
  window.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    const t = e.target instanceof Element ? e.target : document.body;
    const inTerm = !!t.closest('#term-stage'); // xterm owns Esc and friends
    const typing = inTerm || t.isContentEditable || t.matches('input, textarea, select');
    // ⌃` stays live inside the terminal: xterm swallows it, and it is the way out.
    if (e.ctrlKey && e.key === '`') { e.preventDefault(); toggleDrawer(); return; }
    if (e.defaultPrevented) return;
    if (meta && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      palette.open ? palette.close() : openPalette();
    }
    else if (meta && e.key === '1') { e.preventDefault(); showPane('app'); }
    else if (meta && e.key === '2') { e.preventDefault(); showPane('browser'); }
    else if (meta && e.key.toLowerCase() === 'l' && onJobs()) {
      e.preventDefault();
      $('url-input').focus();
      $('url-input').select();
    }
    else if (e.key === 'Escape' && !inTerm && !palette.open && drawer.dataset.open === 'true') {
      drawerOpen(false);
    }
    else if (e.key === '?' && !meta && !typing && !palette.open) {
      e.preventDefault();
      showShortcuts();
    }
    else if (e.key === '/' && !meta && !e.altKey && !typing && !palette.open && onJobs()) {
      e.preventDefault();
      $('company-filter').focus();
    }
  });
})();
