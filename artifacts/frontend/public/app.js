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
    'almost there...',
  ];

  // ============================================================
  // Verifier progress animation
  // ============================================================

  var VERIFIERS = [
    { id: 'dependencies', doneMsg: 'package.json scanned',  checkAt:  280, doneAt: 1200 },
    { id: 'commands',     doneMsg: 'scripts verified',       checkAt:  500, doneAt: 2100 },
    { id: 'envvars',      doneMsg: 'source files checked',   checkAt:  720, doneAt: 2900 },
    { id: 'references',   doneMsg: 'urls + paths checked',   checkAt:  940, doneAt: 3700 },
    { id: 'coverage',     doneMsg: 'deps cross-referenced',  checkAt: 1160, doneAt: 4500 },
  ];

  var _vrTimers = [];

  function _setVrState(id, state, symbol, status) {
    var row = document.getElementById('vr-' + id);
    if (!row) return;
    row.setAttribute('data-state', state);
    var sym = row.querySelector('.vr-symbol');
    var sta = row.querySelector('.vr-status');
    if (sym) sym.textContent = symbol;
    if (sta) sta.textContent = status;
  }

  function startVerifierProgress() {
    stopVerifierProgress();
    for (var i = 0; i < VERIFIERS.length; i++) {
      _setVrState(VERIFIERS[i].id, 'pending', '·', '');
    }
    for (var j = 0; j < VERIFIERS.length; j++) {
      (function (v) {
        _vrTimers.push(setTimeout(function () {
          _setVrState(v.id, 'checking', '○', 'checking...');
        }, v.checkAt));
        _vrTimers.push(setTimeout(function () {
          _setVrState(v.id, 'done', '✓', v.doneMsg);
        }, v.doneAt));
      })(VERIFIERS[j]);
    }
  }

  function stopVerifierProgress() {
    for (var i = 0; i < _vrTimers.length; i++) clearTimeout(_vrTimers[i]);
    _vrTimers = [];
    for (var j = 0; j < VERIFIERS.length; j++) {
      _setVrState(VERIFIERS[j].id, 'done', '✓', VERIFIERS[j].doneMsg);
    }
  }

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
    startVerifierProgress();
  }

  function stopLoadingMessages() {
    if (loadingInterval) {
      clearInterval(loadingInterval);
      loadingInterval = null;
    }
    stopVerifierProgress();
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

  function updateMetaForRepo(owner, repo, v, u, m, c, readLine) {
    const hasCounts = typeof v === 'number';
    const title = hasCounts
      ? owner + '/' + repo + ' — ' + v + ' verified, ' + u + ' unverifiable, ' + m + ' missing, ' + c + ' contradicted'
      : 'readme clew — ' + owner + '/' + repo;
    const desc = hasCounts
      ? (readLine || (owner + '/' + repo + ' — ' + (v + u + m + c) + ' README claims checked by readme clew: ' + v + ' verified, ' + u + ' unverifiable, ' + m + ' missing, ' + c + ' contradicted.'))
      : owner + '/' + repo + ' scanned by readme clew: factual claims checked against actual code. Findings only. No rewrites. Nothing saved.';
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

  // ============================================================
  // Recent repos (localStorage)
  // ============================================================

  var RECENT_KEY = 'readme-clew-recent';
  var RECENT_MAX = 8;

  function saveRecentRepo(repoUrl) {
    try {
      var existing = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      var filtered = existing.filter(function (u) { return u !== repoUrl; });
      filtered.unshift(repoUrl);
      localStorage.setItem(RECENT_KEY, JSON.stringify(filtered.slice(0, RECENT_MAX)));
      renderRecentRepos();
    } catch (e) {}
  }

  function getRecentRepos() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function wireTryChips() {
    var chips = document.querySelectorAll('.try-chip');
    for (var i = 0; i < chips.length; i++) {
      (function (chip) {
        chip.addEventListener('click', function () {
          var url = chip.getAttribute('data-repo');
          if (!url) return;
          var inp = document.getElementById('repo-url');
          if (inp) inp.value = url;
          submitScan(url);
        });
      })(chips[i]);
    }
  }

  function renderRecentRepos() {
    var container = document.getElementById('recent-repos');
    if (!container) return;
    var repos = getRecentRepos();
    if (repos.length === 0) { container.style.display = 'none'; return; }
    container.style.display = '';
    container.innerHTML = '';
    var label = document.createElement('span');
    label.className = 'recent-label';
    label.textContent = 'recent:';
    container.appendChild(label);
    for (var i = 0; i < repos.length; i++) {
      (function (url) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'recent-chip';
        chip.textContent = url.replace(/^https?:\/\/github\.com\//, '');
        chip.addEventListener('click', function () {
          var inp = document.getElementById('repo-url');
          if (inp) inp.value = url;
          submitScan(url);
        });
        container.appendChild(chip);
      })(repos[i]);
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
      saveRecentRepo(repoUrl);
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

  // Current repo context — set in renderResults, read in createFindingEl
  var _repoOwner = '';
  var _repoName  = '';

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

    // Deep-link to the relevant file in GitHub
    if (finding.filePath && _repoOwner && _repoName) {
      const viewLink = document.createElement('a');
      viewLink.className = 'finding-view-link';
      viewLink.href = 'https://github.com/' + _repoOwner + '/' + _repoName + '/blob/main/' + finding.filePath;
      viewLink.target = '_blank';
      viewLink.rel = 'noopener noreferrer';
      setText(viewLink, finding.filePath + ' \u2197');
      codeCol.appendChild(viewLink);
    }

    row.appendChild(codeCol);
    return row;
  }

  function renderBucket(bucketId, itemsId, countId, findings, bucket) {
    const sectionEl = document.getElementById(bucketId);
    const countEl   = document.getElementById(countId);
    const itemsEl   = document.getElementById(itemsId);

    if (!itemsEl) return;

    const count = findings ? findings.length : 0;

    // Hide the entire section when empty — stat bar already shows the count
    if (sectionEl) sectionEl.style.display = count === 0 ? 'none' : '';

    if (countEl) setText(countEl, count + ' finding' + (count !== 1 ? 's' : ''));

    itemsEl.innerHTML = '';

    if (count === 0) return;

    // Group by category when multiple categories and >= 4 items total
    const sorted = sortByWeight(findings, bucket);
    var cats = {};
    var catOrder = [];
    for (var fi = 0; fi < sorted.length; fi++) {
      var cat = sorted[fi].category || 'other';
      if (!cats[cat]) { cats[cat] = []; catOrder.push(cat); }
      cats[cat].push(sorted[fi]);
    }

    if (catOrder.length > 1 && count >= 4) {
      for (var ci = 0; ci < catOrder.length; ci++) {
        var cname = catOrder[ci];
        var subhead = document.createElement('p');
        subhead.className = 'bucket-category-subhead';
        setText(subhead, cname + ' \u00b7 ' + cats[cname].length);
        itemsEl.appendChild(subhead);
        for (var fi2 = 0; fi2 < cats[cname].length; fi2++) {
          itemsEl.appendChild(createFindingEl(cats[cname][fi2], bucket));
        }
      }
    } else {
      for (var fi3 = 0; fi3 < sorted.length; fi3++) {
        itemsEl.appendChild(createFindingEl(sorted[fi3], bucket));
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

    // Stats bar counts + contradicted colour flip when zero
    var statIds = ['verified', 'unverifiable', 'missing', 'contradicted'];
    for (var i = 0; i < statIds.length; i++) {
      var sid = statIds[i];
      var countEl = document.getElementById('stat-count-' + sid);
      if (countEl) setText(countEl, String((data[sid] || []).length));
    }
    var contradictedStatEl = document.querySelector('.stat-contradicted');
    if (contradictedStatEl) {
      var cCount = (data.contradicted || []).length;
      if (cCount === 0) {
        contradictedStatEl.classList.add('stat--zero');
      } else {
        contradictedStatEl.classList.remove('stat--zero');
      }
    }

    const owner = (data.meta && data.meta.owner) || '';
    const repo = (data.meta && data.meta.repo) || '';
    _repoOwner = owner;
    _repoName  = repo;
    if (owner && repo) {
      const _v = (data.verified     || []).length;
      const _u = (data.unverifiable || []).length;
      const _m = (data.missing      || []).length;
      const _c = (data.contradicted || []).length;
      const _readLine = (data.notes && data.notes.read) || null;
      updateMetaForRepo(owner, repo, _v, _u, _m, _c, _readLine);
    }

    // Badge section — populate and show
    const badgeSec = document.getElementById('badge-section');
    const badgeImg = document.getElementById('badge-img');
    const badgeCodeEl = document.getElementById('badge-code');
    if (badgeSec && badgeImg && badgeCodeEl && owner && repo) {
      const badgeUrl = window.location.origin + '/api/badge/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
      const markdown = '[![readme clew](' + badgeUrl + ')](' + window.location.href + ')';
      badgeImg.src = badgeUrl;
      setText(badgeCodeEl, markdown);
      badgeSec.style.display = '';
      const copyBadgeBtn = document.getElementById('copy-badge-btn');
      if (copyBadgeBtn) {
        const newCopyBadgeBtn = copyBadgeBtn.cloneNode(true);
        copyBadgeBtn.parentNode.replaceChild(newCopyBadgeBtn, copyBadgeBtn);
        newCopyBadgeBtn.addEventListener('click', function () {
          navigator.clipboard.writeText(markdown).then(function () {
            setText(newCopyBadgeBtn, 'copied!');
            setTimeout(function () { setText(newCopyBadgeBtn, 'copy markdown \u2197'); }, 1500);
          }).catch(function () {});
        });
      }
    } else if (badgeSec) {
      badgeSec.style.display = 'none';
    }

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

    // Wire up share on LinkedIn button
    const shareLinkedinBtn = document.getElementById('share-linkedin-btn');
    if (shareLinkedinBtn) {
      const newLinkedinBtn = shareLinkedinBtn.cloneNode(true);
      shareLinkedinBtn.parentNode.replaceChild(newLinkedinBtn, shareLinkedinBtn);
      newLinkedinBtn.addEventListener('click', function () {
        const o = (data.meta && data.meta.owner) || '';
        const r = (data.meta && data.meta.repo)  || '';
        const shareUrl = (o && r)
          ? window.location.origin + '/api/og?owner=' + encodeURIComponent(o) + '&repo=' + encodeURIComponent(r)
          : window.location.href;
        const linkedinUrl = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(shareUrl);
        window.open(linkedinUrl, '_blank', 'noopener,noreferrer');
      });
    }

    // Wire up share on Instagram button (Web Share API on mobile, clipboard on desktop)
    const shareInstagramBtn = document.getElementById('share-instagram-btn');
    if (shareInstagramBtn) {
      const newInstagramBtn = shareInstagramBtn.cloneNode(true);
      shareInstagramBtn.parentNode.replaceChild(newInstagramBtn, shareInstagramBtn);
      newInstagramBtn.addEventListener('click', function () {
        const v = (data.verified     || []).length;
        const u = (data.unverifiable || []).length;
        const m = (data.missing      || []).length;
        const c = (data.contradicted || []).length;
        const o = (data.meta && data.meta.owner) || '';
        const r = (data.meta && data.meta.repo)  || '';
        const shareText =
          'readme clew scanned ' + o + '/' + r + ':\n' +
          '● ' + v + ' verified  ○ ' + u + ' unverifiable\n' +
          '▲ ' + m + ' missing  ✕ ' + c + ' contradicted\n' +
          'audit your own receipts → ' + window.location.href;
        if (navigator.share) {
          navigator.share({ text: shareText, url: window.location.href }).catch(function () {});
        } else {
          navigator.clipboard.writeText(shareText).then(function () {
            setText(newInstagramBtn, 'copied!');
            setTimeout(function () { setText(newInstagramBtn, 'share on instagram \u2197'); }, 1800);
          }).catch(function () {});
        }
      });
    }

    // Wire up post to dev.to button (pre-fills new post editor)
    const shareDevtoBtn = document.getElementById('share-devto-btn');
    if (shareDevtoBtn) {
      const newDevtoBtn = shareDevtoBtn.cloneNode(true);
      shareDevtoBtn.parentNode.replaceChild(newDevtoBtn, shareDevtoBtn);
      newDevtoBtn.addEventListener('click', function () {
        const v = (data.verified     || []).length;
        const u = (data.unverifiable || []).length;
        const m = (data.missing      || []).length;
        const c = (data.contradicted || []).length;
        const o = (data.meta && data.meta.owner) || '';
        const r = (data.meta && data.meta.repo)  || '';
        const postTitle = 'I scanned ' + o + '/' + r + ' with readme clew';
        const postBody =
          'I ran [readme clew](' + window.location.href + ') on ' +
          '[' + o + '/' + r + '](https://github.com/' + o + '/' + r + ')' +
          ' to cross-check its README claims against the actual code.\n\n' +
          '**Results:**\n\n' +
          '- \u25cf ' + v + ' verified\n' +
          '- \u25cb ' + u + ' unverifiable\n' +
          '- \u25b2 ' + m + ' missing\n' +
          '- \u2715 ' + c + ' contradicted\n\n' +
          'Audit your own README: ' + window.location.origin;
        const devtoUrl = 'https://dev.to/new?prefill=' + encodeURIComponent(postBody) +
          '&title=' + encodeURIComponent(postTitle);
        window.open(devtoUrl, '_blank', 'noopener,noreferrer');
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

    // Wire up export JSON button
    const exportJsonBtn = document.getElementById('export-json-btn');
    if (exportJsonBtn) {
      const newJsonBtn = exportJsonBtn.cloneNode(true);
      exportJsonBtn.parentNode.replaceChild(newJsonBtn, exportJsonBtn);
      newJsonBtn.addEventListener('click', function () {
        const o = (data.meta && data.meta.owner) || 'unknown';
        const r = (data.meta && data.meta.repo)  || 'repo';
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = 'readme-clew-' + o + '-' + r + '.json';
        a.click();
        URL.revokeObjectURL(dlUrl);
      });
    }

    // Wire up export Markdown button
    const exportMdBtn = document.getElementById('export-md-btn');
    if (exportMdBtn) {
      const newMdBtn = exportMdBtn.cloneNode(true);
      exportMdBtn.parentNode.replaceChild(newMdBtn, exportMdBtn);
      newMdBtn.addEventListener('click', function () {
        const o = (data.meta && data.meta.owner) || 'unknown';
        const r = (data.meta && data.meta.repo)  || 'repo';
        const v = (data.verified     || []).length;
        const u = (data.unverifiable || []).length;
        const m = (data.missing      || []).length;
        const c = (data.contradicted || []).length;
        const date = new Date().toISOString().slice(0, 10);
        const lines = [];
        lines.push('# readme clew \u2014 ' + o + '/' + r);
        lines.push('');
        if (data.notes && data.notes.read) {
          lines.push('> ' + data.notes.read);
          lines.push('');
        }
        lines.push('**Scanned:** ' + date + ' \u00b7 **Claims extracted:** ' + (v + u + m + c));
        lines.push('');
        lines.push('| | Count |');
        lines.push('|---|---|');
        lines.push('| \u25cf Verified | ' + v + ' |');
        lines.push('| \u25cb Unverifiable | ' + u + ' |');
        lines.push('| \u25b2 Missing | ' + m + ' |');
        lines.push('| \u2715 Contradicted | ' + c + ' |');
        lines.push('');
        var bkts = [
          { key: 'verified',     label: '\u25cf Verified' },
          { key: 'unverifiable', label: '\u25cb Unverifiable' },
          { key: 'missing',      label: '\u25b2 Missing' },
          { key: 'contradicted', label: '\u2715 Contradicted' },
        ];
        for (var bi = 0; bi < bkts.length; bi++) {
          var bkt = bkts[bi];
          var items = data[bkt.key] || [];
          lines.push('---');
          lines.push('');
          lines.push('## ' + bkt.label + ' (' + items.length + ')');
          lines.push('');
          var ctx = data.notes && data.notes.bucketContext && data.notes.bucketContext[bkt.key];
          if (ctx) { lines.push('*' + ctx + '*'); lines.push(''); }
          if (items.length === 0) {
            lines.push('*No ' + bkt.key + ' claims.*');
          } else {
            for (var fi = 0; fi < items.length; fi++) {
              var f = items[fi];
              lines.push('**' + (f.claimText || '') + '** `[' + (f.category || '') + ']`');
              if (f.evidence) lines.push('> ' + f.evidence);
              lines.push('');
            }
          }
          lines.push('');
        }
        lines.push('---');
        lines.push('');
        lines.push('*Generated by [readme clew](' + window.location.origin + ') \u2014 audit your own receipts*');
        const md = lines.join('\n');
        const blob = new Blob([md], { type: 'text/markdown' });
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = 'readme-clew-' + o + '-' + r + '.md';
        a.click();
        URL.revokeObjectURL(dlUrl);
      });
    }

    // Wire up print / save as PDF button
    const printBtn = document.getElementById('print-btn');
    if (printBtn) {
      const newPrintBtn = printBtn.cloneNode(true);
      printBtn.parentNode.replaceChild(newPrintBtn, printBtn);
      newPrintBtn.addEventListener('click', function () { window.print(); });
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
    wireTryChips();
    renderRecentRepos();

    const wordmark = document.getElementById('results-wordmark');
    if (wordmark) {
      wordmark.addEventListener('click', function () {
        clearRepoParam();
        resetMeta();
        showState('landing');
        const input = document.getElementById('repo-url');
        if (input) { input.value = ''; clearInputError(); setTimeout(function () { input.focus(); }, 100); }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    const repoParam = getRepoParam();
    if (repoParam) {
      const input = document.getElementById('repo-url');
      if (input) input.value = repoParam;
      submitScan(repoParam);
    }
  });
})();
