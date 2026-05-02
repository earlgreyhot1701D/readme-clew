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
  // Meta / OpenGraph helpers
  // ============================================================

  function setMeta(id, attr, value) {
    const el = document.getElementById(id);
    if (el) el.setAttribute(attr, value);
  }

  function updateMetaForRepo(owner, repo) {
    const title = 'readme clew — ' + owner + '/' + repo;
    const desc = owner + '/' + repo + ' scanned by readme clew: factual claims checked against actual code. Findings only. No rewrites. Nothing saved.';
    const imgUrl = window.location.origin + '/cover-artwork.jpg';
    const pageUrl = window.location.href;

    document.title = title;
    setMeta('og-title', 'content', title);
    setMeta('og-description', 'content', desc);
    setMeta('og-image', 'content', imgUrl);
    setMeta('tw-title', 'content', title);
    setMeta('tw-description', 'content', desc);
    setMeta('tw-image', 'content', imgUrl);

    // og:url — point at the shareable ?repo= link
    let ogUrl = document.getElementById('og-url');
    if (!ogUrl) {
      ogUrl = document.createElement('meta');
      ogUrl.setAttribute('property', 'og:url');
      ogUrl.id = 'og-url';
      document.head.appendChild(ogUrl);
    }
    ogUrl.setAttribute('content', pageUrl);
  }

  function resetMeta() {
    const title = 'readme clew — audit your own receipts';
    const desc = 'Paste a public GitHub repo URL. Clew extracts every factual claim your README makes and checks it against your actual code. Findings only. No rewrites. Nothing saved.';
    const imgUrl = window.location.origin + '/cover-artwork.jpg';

    document.title = title;
    setMeta('og-title', 'content', title);
    setMeta('og-description', 'content', desc);
    setMeta('og-image', 'content', imgUrl);
    setMeta('tw-title', 'content', title);
    setMeta('tw-description', 'content', desc);
    setMeta('tw-image', 'content', imgUrl);
    const ogUrl = document.getElementById('og-url');
    if (ogUrl) ogUrl.setAttribute('content', window.location.origin + '/');
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

  // Bucket metadata: symbol, verb phrase for CODE column
  var BUCKET_META = {
    verified:     { symbol: '●', verb: 'the code confirms:' },
    unverifiable: { symbol: '○', verb: 'the code cannot confirm —' },
    missing:      { symbol: '▲', verb: 'the code does not show:' },
    contradicted: { symbol: '✕', verb: 'the code contradicts:' },
  };

  // Within-bucket visual weight: dependencies + envvars are high-signal findings.
  // In contradicted, everything is high-weight — a contradiction is always news.
  function findingWeight(finding, bucket) {
    if (bucket === 'contradicted') return 'high';
    if (finding.category === 'dependencies' || finding.category === 'envvars') return 'high';
    return 'low';
  }

  // Sort findings: high-weight categories first, low-weight last.
  function sortByWeight(findings, bucket) {
    return findings.slice().sort(function (a, b) {
      var wa = findingWeight(a, bucket) === 'high' ? 0 : 1;
      var wb = findingWeight(b, bucket) === 'high' ? 0 : 1;
      return wa - wb;
    });
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

  // Two-column sentence-form finding (README | divider | CODE)
  function createFindingEl(finding, bucket) {
    const meta = BUCKET_META[bucket] || { symbol: '·', verb: 'the code:' };

    const row = document.createElement('div');
    row.className = 'finding finding--' + findingWeight(finding, bucket) + '-weight';

    // ── README column ──────────────────────────────────────────
    const readmeCol = document.createElement('div');
    readmeCol.className = 'finding-readme';

    const readmeLabel = document.createElement('span');
    readmeLabel.className = 'finding-col-label';
    setText(readmeLabel, 'README');
    readmeCol.appendChild(readmeLabel);

    const readmeBody = document.createElement('p');
    readmeBody.className = 'finding-readme-body';

    const leadSpan = document.createElement('span');
    leadSpan.className = 'finding-lead';
    setText(leadSpan, 'the readme claims ');
    readmeBody.appendChild(leadSpan);

    const quoteSpan = document.createElement('span');
    quoteSpan.className = 'finding-quote-span';
    const quoteText = finding.verbatimQuote || finding.claimText || '';
    setText(quoteSpan, '\u201C' + quoteText + '\u201D');
    readmeBody.appendChild(quoteSpan);

    readmeCol.appendChild(readmeBody);
    row.appendChild(readmeCol);

    // ── Center divider with bucket symbol ──────────────────────
    const divider = document.createElement('div');
    divider.className = 'finding-divider';

    const symbolEl = document.createElement('span');
    symbolEl.className = 'finding-symbol ' + bucket + '-symbol';
    setText(symbolEl, meta.symbol);
    divider.appendChild(symbolEl);

    row.appendChild(divider);

    // ── CODE column ────────────────────────────────────────────
    const codeCol = document.createElement('div');
    codeCol.className = 'finding-code';

    const codeLabel = document.createElement('span');
    codeLabel.className = 'finding-col-label';
    setText(codeLabel, 'CODE');
    codeCol.appendChild(codeLabel);

    const codeBody = document.createElement('p');
    codeBody.className = 'finding-code-body';
    codeBody.appendChild(text(meta.verb + ' '));
    if (finding.evidence) {
      renderEvidenceText(codeBody, finding.evidence);
    }
    codeCol.appendChild(codeBody);

    // Category tag — bottom-right
    if (finding.category) {
      const catTag = document.createElement('span');
      catTag.className = 'finding-category';
      setText(catTag, finding.category);
      codeCol.appendChild(catTag);
    }

    row.appendChild(codeCol);
    return row;
  }

  function renderBucket(bucketId, itemsId, countId, findings, bucket) {
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
      const sorted = sortByWeight(findings, bucket);
      for (const finding of sorted) {
        itemsEl.appendChild(createFindingEl(finding, bucket));
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

    // Scan notes read line — shown above stat bar when present
    var notesReadEl = document.getElementById('scan-notes-read');
    if (notesReadEl) {
      if (data.notes && data.notes.read) {
        setText(notesReadEl, data.notes.read);
        notesReadEl.style.display = '';
      } else {
        notesReadEl.style.display = 'none';
      }
    }

    renderBucket('bucket-verified',     'items-verified',     'count-verified',     data.verified     || [], 'verified');
    renderBucket('bucket-unverifiable', 'items-unverifiable', 'count-unverifiable', data.unverifiable || [], 'unverifiable');
    renderBucket('bucket-missing',      'items-missing',      'count-missing',      data.missing      || [], 'missing');
    renderBucket('bucket-contradicted', 'items-contradicted', 'count-contradicted', data.contradicted || [], 'contradicted');

    // Bucket context lines — shown under each heading when present
    var bucketNames = ['verified', 'unverifiable', 'missing', 'contradicted'];
    for (var bi = 0; bi < bucketNames.length; bi++) {
      var bname = bucketNames[bi];
      var ctxEl = document.getElementById('bucket-context-' + bname);
      if (ctxEl) {
        var ctx = data.notes && data.notes.bucketContext && data.notes.bucketContext[bname];
        if (ctx) {
          setText(ctxEl, ctx);
          ctxEl.style.display = '';
        } else {
          ctxEl.style.display = 'none';
        }
      }
    }

    // Stats bar counts
    var statIds = ['verified', 'unverifiable', 'missing', 'contradicted'];
    for (var i = 0; i < statIds.length; i++) {
      var sid = statIds[i];
      var countEl = document.getElementById('stat-count-' + sid);
      if (countEl) setText(countEl, String((data[sid] || []).length));
    }

    const owner = (data.meta && data.meta.owner) || '';
    const repo = (data.meta && data.meta.repo) || '';
    if (owner && repo) updateMetaForRepo(owner, repo);

    // Wire up "scan this repo" button
    const scanThisBtn = document.getElementById('scan-this-repo-btn');
    if (scanThisBtn) {
      const o = (data.meta && data.meta.owner) || '';
      const r = (data.meta && data.meta.repo) || '';
      if (o && r) {
        setText(scanThisBtn, 'scan ' + o + '/' + r + ' ↗');
        scanThisBtn.style.display = '';
        const newBtn = scanThisBtn.cloneNode(true);
        scanThisBtn.parentNode.replaceChild(newBtn, scanThisBtn);
        newBtn.addEventListener('click', function () {
          submitScan('https://github.com/' + o + '/' + r);
        });
      } else {
        scanThisBtn.style.display = 'none';
      }
    }

    // Wire up share on X button
    const shareXBtn = document.getElementById('share-x-btn');
    if (shareXBtn) {
      const newShareBtn = shareXBtn.cloneNode(true);
      shareXBtn.parentNode.replaceChild(newShareBtn, shareXBtn);
      newShareBtn.addEventListener('click', function () {
        const v = (data.verified     || []).length;
        const u = (data.unverifiable || []).length;
        const m = (data.missing      || []).length;
        const c = (data.contradicted || []).length;
        const o = (data.meta && data.meta.owner) || '';
        const r = (data.meta && data.meta.repo)  || '';
        const tweetText =
          'readme clew scanned ' + o + '/' + r + ':\n' +
          '● ' + v + ' verified  ○ ' + u + ' unverifiable  ▲ ' + m + ' missing  ✕ ' + c + ' contradicted\n' +
          'audit your own receipts →';
        const tweetUrl = 'https://twitter.com/intent/tweet' +
          '?text=' + encodeURIComponent(tweetText) +
          '&url=' + encodeURIComponent(window.location.href);
        window.open(tweetUrl, '_blank', 'noopener,noreferrer');
      });
    }

    // Wire up copy-link button
    const copyLinkBtn = document.getElementById('copy-link-btn');
    if (copyLinkBtn) {
      const newCopyBtn = copyLinkBtn.cloneNode(true);
      copyLinkBtn.parentNode.replaceChild(newCopyBtn, copyLinkBtn);
      newCopyBtn.addEventListener('click', function () {
        const shareUrl = window.location.href;
        const reset = function () { setText(newCopyBtn, 'copy link \u2197'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareUrl).then(function () {
            setText(newCopyBtn, 'copied!');
            setTimeout(reset, 1500);
          }).catch(reset);
        } else {
          var ta = document.createElement('textarea');
          ta.value = shareUrl;
          ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); setText(newCopyBtn, 'copied!'); } catch (e) {}
          document.body.removeChild(ta);
          setTimeout(reset, 1500);
        }
      });
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
      resetMeta();
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
