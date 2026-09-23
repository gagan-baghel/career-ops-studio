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
  const showPane = (name) => {
    document.querySelectorAll('.seg').forEach((b) =>
      b.setAttribute('aria-selected', String(b.dataset.pane === name)),
    );
    $('pane-app').dataset.active = String(name === 'app');
    $('pane-browser').dataset.active = String(name === 'browser');
    if (name === 'browser') $('url-input').focus();
    window.Buddy?.event(
      name === 'browser' ? 'Jobs pane. Pick a company or paste a URL.' : 'Back to the workspace.',
    );
  };
  document.querySelectorAll('.seg').forEach((b) => (b.onclick = () => showPane(b.dataset.pane)));

  /* ── workspace boot state ───────────────────────────────────────────── */
  let webUrl = 'http://localhost:3000';
  const setStatus = (state, text) => {
    $('status').querySelector('.dot').dataset.state = state;
    $('status-text').textContent = text;
  };

  async function pollState() {
    try {
      const s = await (await fetch('/api/state')).json();
      webUrl = s.webUrl;
      if (s.web === 'ready') {
        if ($('status-text').textContent !== 'workspace ready') {
          window.Buddy?.event('Workspace is up. We are in business.');
        }
        setStatus('ready', 'workspace ready');
        const frame = $('app-frame');
        if (!frame.src) frame.src = webUrl;
        $('app-overlay').hidden = true;
        setTimeout(pollState, 3000);
        return;
      }
      if (s.web === 'down') {
        if ($('status-text').textContent !== 'server stopped') {
          window.Buddy?.event('The workspace server stopped. Check the log.');
        }
        setStatus('down', 'server stopped');
        $('app-overlay').hidden = false;
        $('app-overlay').querySelector('.spinner').style.display = 'none';
        $('app-overlay').querySelector('h2').textContent = 'Workspace server stopped';
        $('app-overlay').querySelector('p').textContent =
          'The career-ops web server is not running. The log below says why.';
        $('btn-retry').hidden = false;
      } else {
        setStatus('starting', 'starting…');
        $('app-overlay').hidden = false;
        $('app-overlay').querySelector('.spinner').style.display = '';
        $('btn-retry').hidden = true;
      }
      $('boot-log').textContent = (await (await fetch('/api/log')).text()).trim().split('\n').slice(-14).join('\n');
      $('boot-log').scrollTop = $('boot-log').scrollHeight;
      setTimeout(pollState, 900);
    } catch {
      setStatus('down', 'studio offline');
      setTimeout(pollState, 2000);
    }
  }
  $('btn-retry').onclick = async () => {
    $('btn-retry').hidden = true;
    await fetch('/api/restart', { method: 'POST' }).catch(() => {});
    $('app-frame').removeAttribute('src');
  };
  pollState();

  /* ── terminal drawer ────────────────────────────────────────────────── */
  const drawer = $('drawer');
  const terminals = new Map();
  let activeTerm = null;
  let seq = 0;

  drawer.style.setProperty('--drawer-h', store.get('studio:drawerH', '320') + 'px');

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
      const h = Math.min(Math.max(window.innerHeight - ev.clientY, 120), window.innerHeight - 160);
      drawer.style.setProperty('--drawer-h', h + 'px');
      fitActive();
    };
    const up = () => {
      resizer.dataset.dragging = 'false';
      store.set('studio:drawerH', String(parseInt(getComputedStyle(drawer).height, 10)));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
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
  window.addEventListener('resize', fitActive);

  function newSession(kind) {
    const id = `t${++seq}`;
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

    ws.onopen = () => {
      fit.fit();
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    ws.onmessage = (e) => {
      const payload = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
      term.write(payload);
      window.Buddy?.onTerminalData(payload);
    };
    ws.onclose = () => term.write('\r\n\x1b[38;5;245m— disconnected —\x1b[0m\r\n');
    // Keystrokes go as binary frames; control messages as text. No escaping needed.
    // Mirror what the user is composing so the buddy can report the real
    // command instead of guessing from output. Printable chars only; backspace
    // rubs one out. Nothing is stored or sent anywhere.
    let composing = '';
    term.onData((d) => {
      if (ws.readyState !== 1) return;
      ws.send(enc.encode(d));
      if (d === '\r') {
        window.Buddy?.onCommand(composing);
        composing = '';
      } else if (d === '\x7f') composing = composing.slice(0, -1);
      else if (d >= ' ' && d.length === 1) composing += d;
    });

    const tab = document.createElement('button');
    tab.className = 'term-tab';
    tab.innerHTML = `<span>${kind === 'claude' ? 'claude' : 'zsh'} ${seq}</span>
      <span class="close" role="button" aria-label="Close session">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></span>`;
    tab.onclick = (e) => {
      if (e.target.closest('.close')) return closeSession(id);
      selectSession(id);
    };
    $('term-tabs').append(tab);

    terminals.set(id, { term, fit, ws, host, tab });
    selectSession(id);
    window.Buddy?.event(
      kind === 'claude' ? 'Opening a Claude session for you.' : 'New shell, rooted in the workspace.',
    );
    return id;
  }

  function selectSession(id) {
    activeTerm = id;
    terminals.forEach((s, key) => {
      s.host.dataset.active = String(key === id);
      s.tab.dataset.active = String(key === id);
    });
    requestAnimationFrame(() => {
      fitActive();
      terminals.get(id)?.term.focus();
    });
  }

  function closeSession(id) {
    const s = terminals.get(id);
    if (!s) return;
    s.ws.close();
    s.term.dispose();
    s.host.remove();
    s.tab.remove();
    terminals.delete(id);
    const next = terminals.keys().next();
    if (next.done) drawerOpen(false);
    else selectSession(next.value);
  }

  $('btn-new-shell').onclick = () => newSession('shell');
  $('btn-new-claude').onclick = () => newSession('claude');

  // Write text into a terminal without submitting it — the user presses Enter.
  function sendToTerminal(text, prefer = 'claude') {
    drawerOpen(true);
    // Always land in a session of the right kind — a job URL pasted into a bare
    // shell does nothing, so open a Claude session if none is running yet.
    const wanted = [...terminals.entries()].find(([, s]) => s.tab.textContent.includes(prefer));
    const id = wanted ? wanted[0] : newSession(prefer);
    selectSession(id);
    const s = terminals.get(id);
    const send = () => s.ws.send(new TextEncoder().encode(text));
    if (s.ws.readyState === 1) send();
    else s.ws.addEventListener('open', send, { once: true });
  }

  /* ── jobs pane ──────────────────────────────────────────────────────── */
  // A real top-level window, not an iframe: X-Frame-Options and CSP only apply
  // to framing, so nothing can refuse to load, and your existing logins work.
  // It is named, so every job reuses the same window instead of spawning tabs.
  const WINDOW_NAME = 'careerOpsJob';
  let jobWindow = null;
  let opened = null;

  const normalize = (raw) => {
    const v = (raw ?? '').trim();
    if (!v) return null;
    return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  };

  // Right half of the available screen, so it sits beside the studio.
  const features = () => {
    const w = Math.max(Math.floor(screen.availWidth / 2), 640);
    const h = screen.availHeight;
    const left = screen.availLeft + (screen.availWidth - w);
    return `popup=yes,width=${w},height=${h},left=${left},top=${screen.availTop}`;
  };

  function open(raw) {
    const url = normalize(raw);
    if (!url) return;
    $('url-input').value = url;
    opened = url;
    // Reusing the name keeps every posting in one window; features are honoured
    // on first open, and the browser just navigates the existing one after that.
    try {
      window.Buddy?.event(`Opening ${new URL(url).hostname} beside you.`);
    } catch { /* not a parseable host */ }
    jobWindow = window.open(url, WINDOW_NAME, features());
    if (!jobWindow) {
      $('portal-count').textContent =
        'Your browser blocked the window. Allow pop-ups for localhost, then try again.';
      return;
    }
    jobWindow.focus();
    syncWindowState();
  }

  function syncWindowState() {
    const live = jobWindow && !jobWindow.closed;
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
  $('b-paste').onclick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const url = normalize(text);
      if (!url) {
        $('portal-count').textContent = 'Clipboard has no URL in it.';
        return;
      }
      $('url-input').value = url;
      opened = url;
      syncWindowState();
      window.Buddy?.event('Pulled that address off your clipboard.');
    } catch {
      $('portal-count').textContent =
        'Clipboard access was denied — paste into the field above instead.';
    }
  };

  $('b-focus').onclick = () => jobWindow && !jobWindow.closed && jobWindow.focus();
  $('b-close-win').onclick = () => {
    if (jobWindow && !jobWindow.closed) jobWindow.close();
    syncWindowState();
  };

  $('b-evaluate').onclick = () => {
    const url = normalize($('url-input').value);
    if (!url) return;
    // Pasting a job URL is career-ops' documented auto-pipeline trigger. We stage
    // it in the terminal — never send it — so the human stays in the loop.
    window.Buddy?.event('Handing that job URL to Claude — press Enter to run it.', { hold: 4200 });
    sendToTerminal(url);
  };

  // Company launcher — sourced from the workspace's own portals.yml, with a few
  // aggregators appended so the pane is still useful before portals is set up.
  const FEEDS = [
    { name: "HN Who's hiring", url: 'https://news.ycombinator.com/submitted?id=whoishiring' },
    { name: 'Work at a Startup', url: 'https://www.workatastartup.com/jobs' },
    { name: 'Wellfound', url: 'https://wellfound.com/jobs' },
  ];
  let companies = [];
  const MAX_CHIPS = 24;

  function renderChips() {
    const q = $('company-filter').value.trim().toLowerCase();
    const hits = companies.filter((c) => c.name.toLowerCase().includes(q));
    $('quick-chips').replaceChildren(
      ...hits.slice(0, MAX_CHIPS).map((c) => {
        const b = document.createElement('button');
        b.className = 'chip';
        b.textContent = c.name;
        b.title = c.url;
        b.onclick = () => {
          window.Buddy?.event(`Looking up ${c.name}.`);
          open(c.url);
        };
        return b;
      }),
    );
    const shown = Math.min(hits.length, MAX_CHIPS);
    $('portal-count').textContent = hits.length
      ? `Showing ${shown} of ${hits.length} — type to narrow, or paste any URL above.`
      : 'No match. Paste a URL in the address bar instead.';
  }

  $('company-filter').oninput = renderChips;

  fetch('/api/portals')
    .then((r) => r.json())
    .then((list) => {
      companies = [...list, ...FEEDS];
      renderChips();
    })
    .catch(() => {
      companies = FEEDS;
      renderChips();
    });

  syncWindowState();

  /* ── command palette ────────────────────────────────────────────────── */
  const palette = $('palette');
  const pInput = $('palette-input');
  const pList = $('palette-list');
  let pItems = [];
  let pIndex = 0;

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
    { label: 'Toggle terminal', hint: '⌃`', run: toggleDrawer },
    { label: 'New shell session', hint: '', run: () => (drawerOpen(true), newSession('shell')) },
    { label: 'New Claude session', hint: '', run: () => (drawerOpen(true), newSession('claude')) },
    { label: 'Run doctor', hint: 'terminal', run: () => sendToTerminal('npm run doctor\r', 'zsh') },
    { label: 'Toggle studio theme', hint: 'chrome only', run: () => $('btn-theme').click() },
  ];

  function renderPalette() {
    const q = pInput.value.toLowerCase();
    pItems = COMMANDS.filter((c) => c.label.toLowerCase().includes(q));
    pIndex = 0;
    pList.innerHTML = '';
    pItems.forEach((c, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === pIndex));
      li.innerHTML = `<span>${c.label}</span>${c.hint ? `<span class="kbd">${c.hint}</span>` : ''}`;
      li.onclick = () => run(i);
      pList.append(li);
    });
  }
  const highlight = () =>
    [...pList.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === pIndex)));
  const run = (i) => {
    const cmd = pItems[i];
    palette.close();
    if (cmd) window.Buddy?.event(`Running: ${cmd.label}.`);
    cmd?.run();
  };

  const openPalette = () => {
    pInput.value = '';
    renderPalette();
    palette.showModal();
    pInput.focus();
  };
  $('btn-palette').onclick = openPalette;
  pInput.oninput = renderPalette;
  pInput.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); pIndex = Math.min(pIndex + 1, pItems.length - 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); pIndex = Math.max(pIndex - 1, 0); highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(pIndex); }
  };

  /* ── global keys ────────────────────────────────────────────────────── */
  window.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    else if (e.ctrlKey && e.key === '`') { e.preventDefault(); toggleDrawer(); }
    else if (meta && e.key === '1') { e.preventDefault(); showPane('app'); }
    else if (meta && e.key === '2') { e.preventDefault(); showPane('browser'); }
  });
})();
