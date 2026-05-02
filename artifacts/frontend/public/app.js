// app.js — state machine, form handling, results rendering
// All user-supplied data inserted via .textContent (never .innerHTML)

(function () {
  'use strict';

  // ============================================================
  // State machine
  // ============================================================

  const STATES = ['landing', 'loading', 'results'];
  let currentState = 'landing';

  function showState(state) {
    currentState = state;
    for (const s of STATES) {
      const el = document.getElementById('state-' + s);
      if (el) {
        el.classList.toggle('active', s === state);
      }
    }
  }

  // ============================================================
  // Loading messages
  // ============================================================

  const LOADING_MESSAGES = [
    'fetching readme...',
    'reading the fine print...',
    'calling claude...',
    'extracting claims...',
    'verifying against code...',
    'checking package.json...',
    'scanning file tree...',
    'almost there...',
  ];

  let loadingInterval = null;
  let loadingIndex = 0;

  function startLoadingMessages() {
    const label = document.getElementById('loading-label');
    loadingIndex = 0;
    if (label) label.textContent = LOADING_MESSAGES[0];
    loadingInterval = setInterval(function () {
      loadingIndex = (loadingIndex + 1) % LOADING_MESSAGES.length;
      if (label) label.textContent = LOADING_MESSAGES[loadingIndex];
    }, 2800);
  }

  function stopLoadingMessages() {
    if (loadingInterval) {
      clearInterval(loadingInterval);
      loadingInterval = null;
    }
  }

  // ============================================================
  // URL / deep-link helpers
  // ============================================================

  function setRepoParam(repoUrl) {
    const url = new URL(window.location.href);
    url.search = '?repo=' + encodeURIComponent(repoUrl);
    history.pushState({ repo: repoUrl }, '', url.toString());
  }

  function clearRepoParam() {
    const url = new URL(window.location.href);
    url.search = '';
    history.pushState({}, '', url.toString());
  }

  function getRepoParam() {
    return new URLSearchParams(window.location.search).get('repo');
  }

  // ============================================================
  // Form handling
  // ============================================================

  function clearInputError() {
    const errEl = document.getElementById('input-error');
    const input = document.getElementById('repo-url');
    if (errEl) errEl.textContent = '';
    if (input) input.classList.remove('error');
  }

  function showInputError(message) {
    const errEl = document.getElementById('input-error');
    const input = document.getElementById('repo-url');
    if (errEl) errEl.textContent = message;
    if (input) {
      input.classList.add('error');
      input.focus();
    }
  }

  function getBaseUrl() {
    // Works in both dev (root) and deployed environments
    return window.location.origin;
  }

  async function submitScan(repoUrl) {
    clearInputError();
    showState('loading');
    startLoadingMessages();

    try {
      const response = await fetch(getBaseUrl() + '/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        stopLoadingMessages();
        showState('landing');
        clearRepoParam();
        showInputError(data.error || 'something went wrong. try again.');
        return;
      }

      stopLoadingMessages();
      setRepoParam(repoUrl);
      renderResults(repoUrl, data);
      showState('results');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      stopLoadingMessages();
      showState('landing');
      clearRepoParam();
      showInputError('network error — check your connection and try again.');
    }
  }

  // ============================================================
  // Form submission
  // ============================================================

  function initForm() {
    const form = document.getElementById('scan-form');
    const input = document.getElementById('repo-url');
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;

    if (!form || !input) return;

    input.addEventListener('input', function () {
      clearInputError();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const raw = input.value.trim();

      if (!raw) {
        showInputError('enter a github repo url to scan');
        return;
      }

      // Basic client-side format check
      const cleaned = raw.replace(/^https?:\/\//, '');
      if (!cleaned.startsWith('github.com/')) {
        showInputError('url must start with github.com/owner/repo');
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      submitScan(raw).finally(function () {
        if (submitBtn) submitBtn.disabled = false;
      });
    });
  }

  // ============================================================
  // Render results
  // ============================================================

  // Safely create a text node
  function text(str) {
    return document.createTextNode(str || '');
  }

  // Safely set textContent on an element
  function setText(el, str) {
    el.textContent = str || '';
  }

  // Create a finding row DOM node (never innerHTML for user data)
  function createFindingEl(finding) {
    const row = document.createElement('div');
    row.className = 'finding';

    const margin = document.createElement('div');
    margin.className = 'finding-margin';
    setText(margin, finding.category);
    row.appendChild(margin);

    const body = document.createElement('div');
    body.className = 'finding-body';

    const claim = document.createElement('p');
    claim.className = 'finding-claim';
    setText(claim, finding.claimText);
    body.appendChild(claim);

    if (finding.verbatimQuote && finding.verbatimQuote !== finding.claimText) {
      const quote = document.createElement('div');
      quote.className = 'finding-quote';
      setText(quote, '"' + finding.verbatimQuote + '"');
      body.appendChild(quote);
    }

    if (finding.evidence) {
      const evidence = document.createElement('p');
      evidence.className = 'finding-evidence';
      // evidence may contain backtick-wrapped code; render safely
      renderEvidenceText(evidence, finding.evidence);
      body.appendChild(evidence);
    }

    row.appendChild(body);
    return row;
  }

  // Render evidence text: wrap `code` spans safely (no innerHTML with user data)
  function renderEvidenceText(container, evidenceStr) {
    const parts = evidenceStr.split(/(`[^`]*`)/g);
    for (const part of parts) {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        const code = document.createElement('code');
        setText(code, part.slice(1, -1));
        container.appendChild(code);
      } else {
        container.appendChild(text(part));
      }
    }
  }

  function renderBucket(bucketId, itemsId, countId, findings) {
    const countEl = document.getElementById(countId);
    const itemsEl = document.getElementById(itemsId);

    if (!itemsEl) return;

    const count = findings ? findings.length : 0;
    if (countEl) setText(countEl, count + ' finding' + (count !== 1 ? 's' : ''));

    itemsEl.innerHTML = ''; // safe — no user data here, just clearing

    if (count === 0) {
      const empty = document.createElement('p');
      empty.className = 'bucket-empty';
      empty.textContent = 'none';
      itemsEl.appendChild(empty);
    } else {
      for (const finding of findings) {
        itemsEl.appendChild(createFindingEl(finding));
      }
    }
  }

  function renderResults(repoUrl, data) {
    const meta = document.getElementById('results-meta');
    if (meta) {
      const totalClaims = (data.meta && data.meta.claimsExtracted) || 0;
      const owner = (data.meta && data.meta.owner) || '';
      const repo = (data.meta && data.meta.repo) || '';
      const repoSpan = document.createElement('strong');
      setText(repoSpan, owner + '/' + repo);
      meta.textContent = '';
      meta.appendChild(repoSpan);
      meta.appendChild(text(' — ' + totalClaims + ' claim' + (totalClaims !== 1 ? 's' : '') + ' extracted'));

      if (data.meta && data.meta.readmeTruncated) {
        const truncNote = document.createElement('span');
        truncNote.style.color = 'var(--oxblood)';
        truncNote.style.marginLeft = '16px';
        setText(truncNote, '(readme exceeded 50KB — only first 50KB scanned)');
        meta.appendChild(truncNote);
      }

      if (data.meta && data.meta.extractionError) {
        const errNote = document.createElement('span');
        errNote.style.color = 'var(--oxblood)';
        errNote.style.marginLeft = '16px';
        setText(errNote, '(extraction warning: ' + data.meta.extractionError.slice(0, 80) + ')');
        meta.appendChild(errNote);
      }
    }

    renderBucket('bucket-verified', 'items-verified', 'count-verified', data.verified || []);
    renderBucket('bucket-unverifiable', 'items-unverifiable', 'count-unverifiable', data.unverifiable || []);
    renderBucket('bucket-missing', 'items-missing', 'count-missing', data.missing || []);
    renderBucket('bucket-contradicted', 'items-contradicted', 'count-contradicted', data.contradicted || []);

    // Wire up "scan this repo" button with the current repo URL
    const scanThisBtn = document.getElementById('scan-this-repo-btn');
    if (scanThisBtn) {
      const owner = (data.meta && data.meta.owner) || '';
      const repo = (data.meta && data.meta.repo) || '';
      if (owner && repo) {
        setText(scanThisBtn, 'scan ' + owner + '/' + repo + ' ↗');
        scanThisBtn.style.display = '';
        const newBtn = scanThisBtn.cloneNode(true);
        scanThisBtn.parentNode.replaceChild(newBtn, scanThisBtn);
        newBtn.addEventListener('click', function () {
          submitScan('https://github.com/' + owner + '/' + repo);
        });
      } else {
        scanThisBtn.style.display = 'none';
      }
    }
  }

  // ============================================================
  // Scan again button
  // ============================================================

  function initScanAgain() {
    const btn = document.getElementById('scan-again-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      clearRepoParam();
      showState('landing');
      const input = document.getElementById('repo-url');
      if (input) {
        input.value = '';
        clearInputError();
        setTimeout(function () { input.focus(); }, 100);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ============================================================
  // Init — check for ?repo= deep-link on load
  // ============================================================

  document.addEventListener('DOMContentLoaded', function () {
    showState('landing');
    initForm();
    initScanAgain();

    const repoParam = getRepoParam();
    if (repoParam) {
      const input = document.getElementById('repo-url');
      if (input) input.value = repoParam;
      submitScan(repoParam);
    }
  });
})();
