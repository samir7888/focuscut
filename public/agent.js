(function () {
  const script = document.currentScript;
  const studioOrigin = script?.dataset?.studio || window.location.origin;
  let agentNowOffset = 0;
  let studioTime = 0;
  let recording = false;

  function send(type, payload = {}) {
    try {
      window.opener?.postMessage({ type: 'focuscut-agent', sub: type, ...payload }, studioOrigin);
    } catch (e) {}
  }

  function getElementRef(el) {
    if (!el || el === document.body || el === document.documentElement) return undefined;
    if (el.closest && el.closest('[data-focuscut-ignore]')) return undefined;
    const rect = el.getBoundingClientRect();
    let label = el.getAttribute('aria-label') || el.innerText || '';
    if (label.length > 60) label = label.slice(0, 57) + '...';
    let selector = el.tagName.toLowerCase();
    if (el.id) selector = '#' + el.id;
    else if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
      if (cls) selector += '.' + cls;
    }
    return {
      selector,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      label: label || undefined,
      rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
    };
  }

  window.addEventListener('message', (ev) => {
    if (ev.origin !== studioOrigin && studioOrigin !== '*') return;
    const data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'hello') {
      studioTime = data.studioTime || 0;
      const agentT = performance.now();
      send('hello-reply', { agentTime: agentT, wall: Date.now() });
    } else if (data.type === 'start-record') {
      recording = true;
      send('recording-started', { t: performance.now() });
    } else if (data.type === 'stop-record') {
      recording = false;
      send('recording-stopped', { t: performance.now() });
    } else if (data.type === 'sync-ping') {
      send('sync-pong', { agentTime: performance.now(), idx: data.idx });
    }
  });

  let lastMove = 0;
  document.addEventListener(
    'pointermove',
    (e) => {
      if (!recording) return;
      const now = performance.now();
      if (now - lastMove < 16) return;
      lastMove = now;
      send('event', { t: now, type: 'pointer', x: e.clientX, y: e.clientY });
    },
    { passive: true },
  );

  document.addEventListener('click', (e) => {
    if (!recording) return;
    const target = e.target;
    const ref = getElementRef(target);
    send('event', { t: performance.now(), type: 'click', x: e.clientX, y: e.clientY, button: e.button, target: ref });
  });

  document.addEventListener('focusin', (e) => {
    if (!recording) return;
    const ref = getElementRef(e.target);
    if (ref) send('event', { t: performance.now(), type: 'focus', target: ref });
  });

  document.addEventListener('focusout', (e) => {
    if (!recording) return;
    const ref = getElementRef(e.target);
    if (ref) send('event', { t: performance.now(), type: 'blur', target: ref });
  });

  document.addEventListener('input', (e) => {
    if (!recording) return;
    const ref = getElementRef(e.target);
    if (ref) send('event', { t: performance.now(), type: 'input', target: ref });
  });

  document.addEventListener('keydown', (e) => {
    if (!recording) return;
    if (!(e.ctrlKey || e.metaKey || e.altKey || e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab')) return;
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.metaKey) parts.push('Cmd');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey && e.key.length > 1) parts.push('Shift');
    parts.push(e.key === ' ' ? 'Space' : e.key);
    send('event', { t: performance.now(), type: 'key', combo: parts.join('+') });
  });

  let lastScroll = 0;
  document.addEventListener(
    'scroll',
    () => {
      if (!recording) return;
      const now = performance.now();
      if (now - lastScroll < 33) return;
      lastScroll = now;
      send('event', { t: now, type: 'scroll', x: window.scrollX, y: window.scrollY });
    },
    { passive: true },
  );

  function sendViewport() {
    if (!recording) return;
    send('event', {
      t: performance.now(),
      type: 'viewport',
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio,
    });
  }

  window.addEventListener('resize', sendViewport);
  if (window.matchMedia) {
    try {
      window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', sendViewport);
    } catch (e) {}
  }

  window.__focuscut = { version: 1 };
  send('agent-ready', { href: location.href, title: document.title });
})();
