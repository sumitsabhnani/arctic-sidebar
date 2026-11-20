(() => {
  if (typeof window === 'undefined' || window.top !== window.self) {
    return;
  }

  const HOST_ID = 'arctic-highlight-pill-host';
  const SUPERSEDE_EVENT = 'arctic-highlight-pill-supersede';

  interface GlobalWithHighlightCleanup extends Window {
    __arcticHighlightPillCleanup?: () => void;
  }

  const win = window as GlobalWithHighlightCleanup;
  if (typeof win.__arcticHighlightPillCleanup === 'function') {
    try {
      win.__arcticHighlightPillCleanup();
    } catch {
      // ignore previous cleanup errors
    }
  }

  try {
    document.dispatchEvent(new CustomEvent(SUPERSEDE_EVENT));
    document.querySelectorAll(`#${HOST_ID}`).forEach((el) => el.remove());
  } catch {
    // ignore
  }

  function encodeToken(text: string): string {
    return encodeURIComponent(text)
      .replace(/-/g, '%2D')
      .replace(/,/g, '%2C')
      .replace(/&/g, '%26');
  }

  function buildDirective(rawSelection: string): string {
    if (!rawSelection) return '';
    const segments = rawSelection
      .split(/\r?\n+/)
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    if (segments.length === 0) return '';

    if (segments.length === 1) {
      const single = segments[0];
      const words = single.split(' ').filter(Boolean);
      if (single.length <= 120 && words.length <= 20) {
        return `text=${encodeToken(single)}`;
      }
      const startSnippet = words.slice(0, 6).join(' ');
      const endSnippet = words.slice(-6).join(' ');
      if (startSnippet && endSnippet && startSnippet !== endSnippet) {
        return `text=${encodeToken(startSnippet)},${encodeToken(endSnippet)}`;
      }
      return `text=${encodeToken(single.slice(0, 120).trim())}`;
    }

    const firstWords = segments[0].split(' ').filter(Boolean);
    const lastWords = segments[segments.length - 1].split(' ').filter(Boolean);
    const startSnippet = firstWords.slice(0, 6).join(' ');
    const endSnippet = lastWords.slice(-6).join(' ');

    if (startSnippet && endSnippet && startSnippet !== endSnippet) {
      return `text=${encodeToken(startSnippet)},${encodeToken(endSnippet)}`;
    }
    const fallback = startSnippet || segments[0].slice(0, 100).trim();
    return fallback ? `text=${encodeToken(fallback)}` : '';
  }

  function stripExistingFragmentDirective(url: string): string {
    if (!url || !url.includes(':~:')) return url;
    const hashIdx = url.indexOf('#');
    if (hashIdx === -1) return url;
    const beforeHash = url.slice(0, hashIdx);
    const hashPart = url.slice(hashIdx + 1);
    const directiveIdx = hashPart.indexOf(':~:');
    if (directiveIdx === -1) return url;
    const cleanAnchor = hashPart.slice(0, directiveIdx);
    return cleanAnchor ? `${beforeHash}#${cleanAnchor}` : beforeHash;
  }

  function buildPageHighlightUrl(pageUrl: string, selectedText: string): string {
    if (!pageUrl || !selectedText) return '';
    const trimmedUrl = pageUrl.trim();
    if (!/^https?:\/\//i.test(trimmedUrl)) return '';
    const directive = buildDirective(selectedText);
    if (!directive) return '';
    const baseUrl = stripExistingFragmentDirective(trimmedUrl);
    return baseUrl.includes('#')
      ? `${baseUrl}:~:${directive}`
      : `${baseUrl}#:~:${directive}`;
  }

  function extractHighlightFromUrl(
    url?: string
  ): { textStart: string; textEnd?: string } | null {
    if (!url || !/#.*?:~:text=/i.test(url)) return null;
    const match = url.match(/#.*?:~:text=([^&#]+)/i);
    if (!match || !match[1]) return null;

    const tokens = match[1].split(',');
    if (tokens.length > 1 && tokens[0].endsWith('-')) {
      tokens.shift();
    }
    if (tokens.length > 1 && tokens[tokens.length - 1].startsWith('-')) {
      tokens.pop();
    }
    if (tokens.length === 0) return null;

    const safeDecode = (val: string): string => {
      try {
        return decodeURIComponent(val).replace(/\s+/g, ' ').trim();
      } catch {
        return val.replace(/%20/g, ' ').replace(/\s+/g, ' ').trim();
      }
    };

    const textStart = safeDecode(tokens[0] || '');
    if (!textStart) return null;
    const textEnd = tokens.length > 1 ? safeDecode(tokens[1] || '') : undefined;
    return { textStart, ...(textEnd ? { textEnd } : {}) };
  }

  function scrollToHighlightInDocument(payload: {
    textStart: string;
    textEnd?: string;
  }): boolean {
    if (
      typeof window === 'undefined' ||
      typeof document === 'undefined' ||
      !document.body ||
      !payload?.textStart
    ) {
      return false;
    }

    const needleStart = payload.textStart.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!needleStart) return false;
    const needleEnd = payload.textEnd
      ? payload.textEnd.replace(/\s+/g, ' ').trim().toLowerCase()
      : '';

    const STYLE_ID = 'arctic-text-highlight-style';
    if (!document.getElementById(STYLE_ID)) {
      try {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
          ::highlight(arctic-text-highlight) {
            background-color: rgba(250, 204, 21, 0.45);
            color: inherit;
          }
          mark[data-arctic-highlight="true"] {
            background-color: rgba(250, 204, 21, 0.42) !important;
            color: inherit !important;
            border-radius: 3px;
            padding: 1px 0;
            box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.22);
          }
        `;
        (document.head || document.documentElement).appendChild(style);
      } catch {
        // ignore
      }
    }

    const runFindAndHighlight = (): boolean => {
      try {
        const oldMarks = document.querySelectorAll('mark[data-arctic-highlight="true"]');
        oldMarks.forEach((mark) => {
          const parent = mark.parentNode;
          if (parent) {
            while (mark.firstChild) {
              parent.insertBefore(mark.firstChild, mark);
            }
            parent.removeChild(mark);
            parent.normalize();
          }
        });
      } catch {
        // ignore
      }

      interface CharPos {
        node: Text;
        offset: number;
      }

      const charMap: CharPos[] = [];
      const normChars: string[] = [];
      const MAX_CHARS = 400000;

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let currentNode: Node | null = walker.nextNode();
      let lastBlockParent: Element | null = null;

      while (currentNode && normChars.length < MAX_CHARS) {
        const textNode = currentNode as Text;
        const parent = textNode.parentElement;
        if (
          parent &&
          parent.id !== 'arctic-edge-trigger-host' &&
          parent.id !== 'arctic-highlight-pill-host'
        ) {
          const tag = parent.tagName;
          if (
            tag !== 'SCRIPT' &&
            tag !== 'STYLE' &&
            tag !== 'NOSCRIPT' &&
            tag !== 'TEMPLATE' &&
            !parent.closest('#arctic-edge-trigger-host, #arctic-highlight-pill-host, [hidden]')
          ) {
            const raw = textNode.nodeValue || '';
            if (raw.length > 0) {
              const blockParent =
                parent.closest(
                  'p, li, blockquote, h1, h2, h3, h4, h5, h6, div, section, article, td, th, pre'
                ) || parent;
              if (
                lastBlockParent &&
                blockParent !== lastBlockParent &&
                normChars.length > 0 &&
                normChars[normChars.length - 1] !== ' '
              ) {
                normChars.push(' ');
                charMap.push({ node: textNode, offset: 0 });
              }
              lastBlockParent = blockParent;

              for (let i = 0; i < raw.length && normChars.length < MAX_CHARS; i++) {
                const ch = raw[i];
                if (/\s/.test(ch)) {
                  if (normChars.length === 0 || normChars[normChars.length - 1] !== ' ') {
                    normChars.push(' ');
                    charMap.push({ node: textNode, offset: i });
                  }
                } else {
                  normChars.push(ch.toLowerCase());
                  charMap.push({ node: textNode, offset: i });
                }
              }
            }
          }
        }
        currentNode = walker.nextNode();
      }

      const fullNormText = normChars.join('');
      const startIdx = fullNormText.indexOf(needleStart);

      let matchedRange: Range | null = null;
      let matchedElement: HTMLElement | null = null;

      if (startIdx !== -1) {
        let endIdx = startIdx + needleStart.length - 1;
        if (needleEnd) {
          const searchFrom = startIdx + needleStart.length;
          const foundEnd = fullNormText.indexOf(needleEnd, searchFrom);
          if (foundEnd !== -1 && foundEnd - startIdx <= 6000) {
            endIdx = foundEnd + needleEnd.length - 1;
          }
        }
        endIdx = Math.min(endIdx, charMap.length - 1);

        const startPos = charMap[startIdx];
        const endPos = charMap[endIdx];
        if (startPos && endPos) {
          matchedElement = startPos.node.parentElement;
          try {
            const range = document.createRange();
            range.setStart(startPos.node, startPos.offset);
            range.setEnd(endPos.node, endPos.offset + 1);
            matchedRange = range;
          } catch {
            // fallback
          }
        }
      }

      if (!matchedElement) return false;

      let scrollTarget: HTMLElement = matchedElement;

      if (matchedRange) {
        try {
          const winAny = window as unknown as {
            CSS?: { highlights?: { set: (name: string, hl: unknown) => void } };
            Highlight?: new (...ranges: Range[]) => unknown;
          };
          if (winAny.CSS?.highlights && typeof winAny.Highlight === 'function') {
            winAny.CSS.highlights.set(
              'arctic-text-highlight',
              new winAny.Highlight(matchedRange)
            );
          }
        } catch {
          // ignore
        }

        if (matchedRange.startContainer === matchedRange.endContainer) {
          try {
            const mark = document.createElement('mark');
            mark.setAttribute('data-arctic-highlight', 'true');
            matchedRange.surroundContents(mark);
            scrollTarget = mark;
          } catch {
            // ignore
          }
        }
      }

      try {
        scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {
        try {
          scrollTarget.scrollIntoView();
        } catch {
          // ignore
        }
      }

      try {
        const prevBg = matchedElement.style.backgroundColor;
        const prevTransition = matchedElement.style.transition;
        const prevRadius = matchedElement.style.borderRadius;

        matchedElement.style.transition = 'background-color 0.35s ease';
        matchedElement.style.backgroundColor = 'rgba(251, 191, 36, 0.32)';
        if (!prevRadius) {
          matchedElement.style.borderRadius = '4px';
        }

        setTimeout(() => {
          try {
            if (prevBg) matchedElement!.style.backgroundColor = prevBg;
            else matchedElement!.style.removeProperty('background-color');
            setTimeout(() => {
              try {
                if (prevTransition) matchedElement!.style.transition = prevTransition;
                else matchedElement!.style.removeProperty('transition');
                if (!prevRadius) matchedElement!.style.removeProperty('border-radius');
              } catch {
                // ignore
              }
            }, 400);
          } catch {
            // ignore
          }
        }, 2200);
      } catch {
        // ignore
      }

      return true;
    };

    if (runFindAndHighlight()) {
      return true;
    }

    setTimeout(() => {
      if (!runFindAndHighlight()) {
        setTimeout(() => {
          runFindAndHighlight();
        }, 500);
      }
    }, 250);

    return false;
  }

  const COPY_TEXT_SVG = `<svg class="arctic-hl-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
  const LINK_SVG = `<svg class="arctic-hl-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg>`;
  const BOOKMARK_SVG = `<svg class="arctic-hl-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>`;
  const CHECK_SVG = `<svg class="arctic-hl-icon arctic-hl-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;

  let isEnabled = true;
  let themeMode: 'light' | 'dark' | 'system' = 'system';
  let currentSelectedText = '';
  let lastPointerX = 160;
  let lastPointerY = 120;
  let selectionTimer: ReturnType<typeof setTimeout> | null = null;
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;

  let hostEl: HTMLDivElement | null = null;
  let shadowRootRef: ShadowRoot | null = null;
  let pillEl: HTMLDivElement | null = null;
  let copyTextBtnEl: HTMLButtonElement | null = null;
  let copyBtnEl: HTMLButtonElement | null = null;
  let saveBtnEl: HTMLButtonElement | null = null;

  function isExtensionContextValid(): boolean {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function resolveEffectiveTheme(): 'dark' | 'light' {
    if (themeMode === 'dark') return 'dark';
    if (themeMode === 'light') return 'light';
    try {
      if (typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
    } catch {
      // ignore
    }
    return 'dark';
  }

  function isEditableTarget(node: Node | null): boolean {
    if (!node) return false;
    const el =
      node instanceof HTMLElement ? node : node.parentElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    const ce = el.getAttribute?.('contenteditable');
    if (ce === '' || ce === 'true') return true;
    if (el.closest?.('input, textarea, [contenteditable=""], [contenteditable="true"], [role="textbox"]')) {
      return true;
    }
    return false;
  }

  function unmountPill(): void {
    if (selectionTimer) {
      clearTimeout(selectionTimer);
      selectionTimer = null;
    }
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
    currentSelectedText = '';
    if (hostEl) {
      hostEl.remove();
      hostEl = null;
      shadowRootRef = null;
      pillEl = null;
      copyTextBtnEl = null;
      copyBtnEl = null;
      saveBtnEl = null;
    }
  }

  function copyTextToClipboard(text: string): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).catch(() => {
        fallbackCopyText(text);
      });
    }
    fallbackCopyText(text);
    return Promise.resolve();
  }

  function fallbackCopyText(text: string): void {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch {
      // ignore
    }
  }

  function mountOrUpdatePill(
    selectedText: string,
    anchorRect: { top: number; bottom: number; left: number; width: number; height: number }
  ): void {
    if (!document.body) return;
    currentSelectedText = selectedText;

    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }

    if (!hostEl) {
      hostEl = document.createElement('div');
      hostEl.id = HOST_ID;
      shadowRootRef = hostEl.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = `
        :host {
          all: initial;
          position: fixed;
          top: 0;
          left: 0;
          width: 0;
          height: 0;
          z-index: 2147483646;
          pointer-events: none;
        }
        .arctic-hl-pill {
          position: fixed;
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 3px;
          border-radius: 11px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 11.5px;
          font-weight: 500;
          line-height: 1;
          pointer-events: auto;
          user-select: none;
          -webkit-user-select: none;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.24), 0 2px 6px rgba(0, 0, 0, 0.12);
          animation: arcticHlFadeIn 0.12s cubic-bezier(0.16, 1, 0.3, 1);
          white-space: nowrap;
        }
        .arctic-hl-pill[data-theme="dark"] {
          background: rgba(24, 24, 27, 0.96);
          border: 1px solid rgba(255, 255, 255, 0.14);
          color: #f4f4f5;
        }
        .arctic-hl-pill[data-theme="light"] {
          background: rgba(255, 255, 255, 0.97);
          border: 1px solid rgba(0, 0, 0, 0.11);
          color: #18181b;
        }
        @keyframes arcticHlFadeIn {
          from {
            opacity: 0;
            transform: translateY(3px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .arctic-hl-btn {
          all: unset;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 8px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 11.5px;
          font-weight: 500;
          color: inherit;
          transition: background-color 0.12s ease, color 0.12s ease, transform 0.1s ease;
        }
        .arctic-hl-pill[data-theme="dark"] .arctic-hl-btn:hover {
          background: rgba(255, 255, 255, 0.11);
          color: #ffffff;
        }
        .arctic-hl-pill[data-theme="light"] .arctic-hl-btn:hover {
          background: rgba(0, 0, 0, 0.06);
          color: #09090b;
        }
        .arctic-hl-btn:active {
          transform: scale(0.96);
        }
        .arctic-hl-btn[data-success="true"] {
          color: #10b981 !important;
          background: rgba(16, 185, 129, 0.14) !important;
        }
        .arctic-hl-sep {
          width: 1px;
          height: 14px;
          background: rgba(128, 128, 128, 0.24);
        }
        .arctic-hl-icon {
          width: 13px;
          height: 13px;
          flex-shrink: 0;
        }
      `;

      pillEl = document.createElement('div');
      pillEl.className = 'arctic-hl-pill';
      pillEl.setAttribute('role', 'toolbar');
      pillEl.setAttribute('aria-label', 'Arctic Highlight Actions');

      // Prevent mousedown inside pill from collapsing the page's text selection
      pillEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      pillEl.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
      });

      copyTextBtnEl = document.createElement('button');
      copyTextBtnEl.type = 'button';
      copyTextBtnEl.className = 'arctic-hl-btn arctic-hl-copy-text-btn';
      copyTextBtnEl.setAttribute('aria-label', 'Copy Selected Text');
      copyTextBtnEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!currentSelectedText) return;

        void copyTextToClipboard(currentSelectedText);
        if (copyTextBtnEl) {
          copyTextBtnEl.setAttribute('data-success', 'true');
          copyTextBtnEl.innerHTML = `${CHECK_SVG}<span>Copied Text!</span>`;
        }
        if (autoHideTimer) clearTimeout(autoHideTimer);
        autoHideTimer = setTimeout(() => {
          unmountPill();
        }, 1100);
      });

      const sep1 = document.createElement('div');
      sep1.className = 'arctic-hl-sep';

      copyBtnEl = document.createElement('button');
      copyBtnEl.type = 'button';
      copyBtnEl.className = 'arctic-hl-btn arctic-hl-copy-btn';
      copyBtnEl.setAttribute('aria-label', 'Copy Link to Highlight');
      copyBtnEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!currentSelectedText) return;
        const highlightUrl = buildPageHighlightUrl(
          window.location.href,
          currentSelectedText
        );
        if (!highlightUrl) return;

        void copyTextToClipboard(highlightUrl);
        const extracted = extractHighlightFromUrl(highlightUrl);
        if (extracted) {
          scrollToHighlightInDocument(extracted);
        }
        if (copyBtnEl) {
          copyBtnEl.setAttribute('data-success', 'true');
          copyBtnEl.innerHTML = `${CHECK_SVG}<span>Copied Link!</span>`;
        }
        if (autoHideTimer) clearTimeout(autoHideTimer);
        autoHideTimer = setTimeout(() => {
          unmountPill();
        }, 1100);
      });

      const sep2 = document.createElement('div');
      sep2.className = 'arctic-hl-sep';

      saveBtnEl = document.createElement('button');
      saveBtnEl.type = 'button';
      saveBtnEl.className = 'arctic-hl-btn arctic-hl-save-btn';
      saveBtnEl.setAttribute('aria-label', 'Save Highlight to Space');
      saveBtnEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!currentSelectedText || !isExtensionContextValid()) return;
        const highlightUrl = buildPageHighlightUrl(
          window.location.href,
          currentSelectedText
        );
        if (!highlightUrl) return;

        chrome.runtime.sendMessage(
          {
            type: 'SAVE_HIGHLIGHT_BOOKMARK',
            url: highlightUrl,
            pageUrl: window.location.href,
            pageTitle: document.title || '',
            quote: currentSelectedText
          },
          (resp: { ok?: boolean; spaceName?: string } | undefined) => {
            void chrome.runtime.lastError;
            if (saveBtnEl) {
              const targetLabel = resp?.spaceName ? `Saved to ${resp.spaceName}!` : 'Saved Highlight!';
              saveBtnEl.setAttribute('data-success', 'true');
              saveBtnEl.innerHTML = `${CHECK_SVG}<span>${targetLabel}</span>`;
            }
            if (autoHideTimer) clearTimeout(autoHideTimer);
            autoHideTimer = setTimeout(() => {
              unmountPill();
            }, 1100);
          }
        );
      });

      pillEl.appendChild(copyTextBtnEl);
      pillEl.appendChild(sep1);
      pillEl.appendChild(copyBtnEl);
      pillEl.appendChild(sep2);
      pillEl.appendChild(saveBtnEl);
      shadowRootRef.appendChild(style);
      shadowRootRef.appendChild(pillEl);
      document.body.appendChild(hostEl);
    }

    if (!pillEl || !copyTextBtnEl || !copyBtnEl || !saveBtnEl) return;

    pillEl.setAttribute('data-theme', resolveEffectiveTheme());
    copyTextBtnEl.removeAttribute('data-success');
    copyTextBtnEl.innerHTML = `${COPY_TEXT_SVG}<span>Copy Text</span>`;
    copyBtnEl.removeAttribute('data-success');
    copyBtnEl.innerHTML = `${LINK_SVG}<span>Copy Link</span>`;
    saveBtnEl.removeAttribute('data-success');
    saveBtnEl.innerHTML = `${BOOKMARK_SVG}<span>Save Highlight</span>`;

    const measuredRect = pillEl.getBoundingClientRect();
    const estimatedWidth = measuredRect.width > 0 ? Math.ceil(measuredRect.width) : 316;
    const estimatedHeight = measuredRect.height > 0 ? Math.ceil(measuredRect.height) : 32;
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;

    const hasBox = anchorRect.width > 0 || anchorRect.height > 0;
    const centerX = hasBox
      ? anchorRect.left + anchorRect.width / 2
      : lastPointerX;
    const rawTop = hasBox
      ? anchorRect.top > 48
        ? anchorRect.top - estimatedHeight - 8
        : anchorRect.bottom + 8
      : Math.max(8, lastPointerY - estimatedHeight - 10);

    const clampedLeft = Math.max(
      8,
      Math.min(Math.round(centerX - estimatedWidth / 2), vw - estimatedWidth - 8)
    );
    const clampedTop = Math.max(8, Math.min(Math.round(rawTop), vh - estimatedHeight - 8));

    pillEl.style.left = `${clampedLeft}px`;
    pillEl.style.top = `${clampedTop}px`;
  }

  function evaluateSelection(): void {
    if (!isExtensionContextValid()) {
      cleanupAll();
      return;
    }
    if (!isEnabled) {
      unmountPill();
      return;
    }
    if (isEditableTarget(document.activeElement)) {
      unmountPill();
      return;
    }

    const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      unmountPill();
      return;
    }

    if (isEditableTarget(sel.anchorNode) || isEditableTarget(sel.focusNode)) {
      unmountPill();
      return;
    }

    const rawText = sel.toString().trim();
    if (rawText.length < 3 || rawText.length > 2500) {
      unmountPill();
      return;
    }

    let rect = { top: 0, bottom: 0, left: 0, width: 0, height: 0 };
    try {
      const range = sel.getRangeAt(0);
      const r = range.getBoundingClientRect();
      rect = {
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        width: r.width,
        height: r.height
      };
    } catch {
      // use pointer fallback
    }

    mountOrUpdatePill(rawText, rect);
  }

  const handleMouseUp = (e: MouseEvent) => {
    if (!isExtensionContextValid()) {
      cleanupAll();
      return;
    }
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (hostEl && (e.target === hostEl || path.includes(hostEl))) {
      return;
    }

    lastPointerX = e.clientX || 160;
    lastPointerY = e.clientY || 120;

    if (selectionTimer) clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      selectionTimer = null;
      evaluateSelection();
    }, 15);
  };

  const handlePointerDown = (e: MouseEvent | PointerEvent) => {
    if (!hostEl) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (e.target === hostEl || path.includes(hostEl)) {
      return;
    }
    unmountPill();
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (!isExtensionContextValid()) {
      cleanupAll();
      return;
    }
    if (e.key === 'Escape') {
      unmountPill();
      return;
    }
    if (
      e.shiftKey &&
      (e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown')
    ) {
      if (selectionTimer) clearTimeout(selectionTimer);
      selectionTimer = setTimeout(() => {
        selectionTimer = null;
        evaluateSelection();
      }, 15);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && hostEl) {
      unmountPill();
    }
  };

  const handleScrollOrResize = () => {
    if (hostEl) {
      unmountPill();
    }
  };

  const handleStorageChanged = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string
  ) => {
    if (!isExtensionContextValid()) {
      cleanupAll();
      return;
    }
    if (areaName === 'local') {
      if (changes.highlightPillEnabled !== undefined) {
        isEnabled = changes.highlightPillEnabled.newValue !== false;
        if (!isEnabled) unmountPill();
      }
      if (
        changes.theme?.newValue === 'light' ||
        changes.theme?.newValue === 'dark' ||
        changes.theme?.newValue === 'system'
      ) {
        themeMode = changes.theme.newValue;
        if (pillEl) {
          pillEl.setAttribute('data-theme', resolveEffectiveTheme());
        }
      }
    }
  };

  const handleRuntimeMessage = (message: { type?: string }) => {
    if (message && message.type === 'ARCTIC_REMOVE_HIGHLIGHT_PILL') {
      isEnabled = false;
      unmountPill();
    }
  };

  const handleSupersede = () => {
    cleanupAll();
  };

  function checkAndScrollToUrlHighlight(): void {
    try {
      let candidateUrl = window.location?.href || '';
      if (!candidateUrl.includes(':~:text=') && typeof performance !== 'undefined') {
        const navEntries = performance.getEntriesByType?.('navigation');
        const navName = (navEntries?.[0] as { name?: string } | undefined)?.name;
        if (navName && navName.includes(':~:text=')) {
          candidateUrl = navName;
        }
      }
      const extracted = extractHighlightFromUrl(candidateUrl);
      if (extracted) {
        scrollToHighlightInDocument(extracted);
      }
    } catch {
      // ignore
    }
  }

  const handleHashChange = () => {
    checkAndScrollToUrlHighlight();
  };

  function cleanupAll(): void {
    unmountPill();
    document.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('pointerdown', handlePointerDown, true);
    document.removeEventListener('keyup', handleKeyUp);
    document.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('scroll', handleScrollOrResize, true);
    window.removeEventListener('resize', handleScrollOrResize);
    window.removeEventListener('hashchange', handleHashChange);
    document.removeEventListener(SUPERSEDE_EVENT, handleSupersede);
    try {
      chrome.storage?.onChanged?.removeListener(handleStorageChanged);
      chrome.runtime?.onMessage?.removeListener(handleRuntimeMessage);
    } catch {
      // ignore invalidated context
    }
  }

  win.__arcticHighlightPillCleanup = cleanupAll;

  document.addEventListener('mouseup', handleMouseUp);
  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('keyup', handleKeyUp);
  document.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('scroll', handleScrollOrResize, { capture: true, passive: true });
  window.addEventListener('resize', handleScrollOrResize, { passive: true });
  window.addEventListener('hashchange', handleHashChange);
  document.addEventListener(SUPERSEDE_EVENT, handleSupersede);

  // If the page was opened with a #:~:text=... highlight URL, scroll to and highlight the passage
  checkAndScrollToUrlHighlight();

  if (isExtensionContextValid()) {
    try {
      chrome.storage.onChanged.addListener(handleStorageChanged);
      chrome.runtime.onMessage.addListener(handleRuntimeMessage);
      chrome.storage.local.get(['highlightPillEnabled', 'theme'], (res) => {
        void chrome.runtime.lastError;
        if (!isExtensionContextValid()) return;
        if (typeof res?.highlightPillEnabled === 'boolean') {
          isEnabled = res.highlightPillEnabled;
        }
        if (
          res?.theme === 'light' ||
          res?.theme === 'dark' ||
          res?.theme === 'system'
        ) {
          themeMode = res.theme;
        }
      });
    } catch {
      cleanupAll();
    }
  }
})();

export type {};
