(() => {
  'use strict';

  const token = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);

  const panel = document.getElementById('caption-panel');
  const unavailable = document.getElementById('unavailable');
  const unavailableMessage = document.getElementById('unavailable-message');
  const expiryNote = document.getElementById('expiry-note');
  const copyButton = document.getElementById('copy-caption');
  const copyStatus = document.getElementById('copy-status');
  const captionText = document.getElementById('caption-text');
  let expiresAt = 0;
  let countdown;

  function showUnavailable(message) {
    if (countdown) window.clearInterval(countdown);
    panel.hidden = true;
    unavailable.hidden = false;
    unavailableMessage.textContent = message;
    expiryNote.textContent = 'Your content remains available in PublishOS.';
  }

  function updateCountdown() {
    const remaining = Math.max(0, expiresAt - Date.now());
    if (remaining === 0) {
      showUnavailable('This caption link has expired. Generate a new QR code in PublishOS.');
      return;
    }
    const minutes = Math.floor(remaining / 60_000);
    const seconds = Math.floor((remaining % 60_000) / 1000);
    expiryNote.textContent = `Link expires in ${minutes}:${String(seconds).padStart(2, '0')}. Your content will remain available in PublishOS.`;
  }

  async function resolveCaption() {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      showUnavailable('This caption link is unavailable. Generate a new QR code in PublishOS.');
      return;
    }

    let response;
    try {
      response = await window.fetch('/v1/mobile-caption-handoffs/resolve', {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
    } catch {
      showUnavailable('Caption could not be loaded. Check your connection and scan the code again.');
      return;
    }

    if (!response.ok) {
      showUnavailable(response.status === 410
        ? 'This caption link has expired. Generate a new QR code in PublishOS.'
        : 'This caption link is unavailable. Generate a new QR code in PublishOS.');
      return;
    }

    const data = await response.json();
    document.getElementById('content-title').textContent = data.title || '';
    document.getElementById('target-account').textContent = data.targetTikTokAccount || 'Target account unavailable';
    captionText.value = data.captionText || '';
    document.getElementById('hashtags').textContent = Array.isArray(data.hashtags) ? data.hashtags.join(' ') : '';
    document.getElementById('expires-at').textContent = new Date(data.expiresAt).toLocaleString();
    expiresAt = Date.parse(data.expiresAt);
    unavailable.hidden = true;
    panel.hidden = false;
    updateCountdown();
    countdown = window.setInterval(updateCountdown, 1000);
  }

  copyButton.addEventListener('click', async () => {
    copyStatus.className = 'status';
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is unavailable');
      await navigator.clipboard.writeText(captionText.value);
      copyStatus.textContent = 'Caption copied';
      copyStatus.classList.add('success');
    } catch {
      captionText.focus();
      captionText.select();
      copyStatus.textContent = 'Could not copy automatically. Long-press the caption text and copy it manually.';
      copyStatus.classList.add('error');
    }
  });

  void resolveCaption();
})();
