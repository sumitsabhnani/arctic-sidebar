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

  const STYLE_ID = 'arctic-text-highlight-style';

  function ensureHighlightStylesheet(): void {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
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

  function applyNonMutatingRangeHighlight(range: Range | null): boolean {
    if (!range) return false;
    ensureHighlightStylesheet();
    try {
      const winAny = window as unknown as {
        CSS?: { highlights?: { set: (name: string, hl: unknown) => void } };
        Highlight?: new (...ranges: Range[]) => unknown;
      };
      if (winAny.CSS?.highlights && typeof winAny.Highlight === 'function') {
        winAny.CSS.highlights.set(
          'arctic-text-highlight',
          new winAny.Highlight(range)
        );
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  function isWhitespaceCode(code: number): boolean {
    if (code <= 0x20) {
      return (
        code === 0x20 ||
        code === 0x09 ||
        code === 0x0a ||
        code === 0x0d ||
        code === 0x0c ||
        code === 0x0b
      );
    }
    if (code === 0x00a0) return true;
    return code >= 0x1680 && /\s/.test(String.fromCharCode(code));
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

    ensureHighlightStylesheet();

    const runFindAndHighlight = (): boolean => {
      try {
        if (document.querySelector('mark[data-arctic-highlight="true"]')) {
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
        }
      } catch {
        // ignore
      }

      const MAX_CHARS = 400000;
      const textNodes: Text[] = [];
      let capacity = 4096;
      let nodeIndices = new Int32Array(capacity);
      let charOffsets = new Int32Array(capacity);
      let normLen = 0;
      let lastWasSpace = true;
      const normParts: string[] = [];

      const pushChar = (ch: string, nodeIdx: number, offset: number) => {
        if (normLen >= MAX_CHARS) return;
        if (normLen >= capacity) {
          const nextCap = Math.min(MAX_CHARS, capacity * 2);
          const nextNodes = new Int32Array(nextCap);
          const nextOffsets = new Int32Array(nextCap);
          nextNodes.set(nodeIndices);
          nextOffsets.set(charOffsets);
          nodeIndices = nextNodes;
          charOffsets = nextOffsets;
          capacity = nextCap;
        }
        nodeIndices[normLen] = nodeIdx;
        charOffsets[normLen] = offset;
        normLen += 1;
        lastWasSpace = ch === ' ';
        normParts.push(ch);
      };

      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        {
          acceptNode(node: Node): number {
            if (node.nodeType === 1) {
              const el = node as Element;
              const id = el.id;
              if (
                id === 'arctic-edge-trigger-host' ||
                id === 'arctic-highlight-pill-host' ||
                el.hasAttribute('hidden')
              ) {
                return NodeFilter.FILTER_REJECT;
              }
              const tag = el.tagName;
              if (
                tag === 'SCRIPT' ||
                tag === 'STYLE' ||
                tag === 'NOSCRIPT' ||
                tag === 'TEMPLATE'
              ) {
                return NodeFilter.FILTER_REJECT;
              }
              return NodeFilter.FILTER_SKIP;
            }
            const val = node.nodeValue;
            return val && val.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          }
        }
      );

      let currentNode: Node | null = walker.nextNode();
      let lastParent: Element | null = null;
      let lastBlockParent: Element | null = null;
      let cachedBlockForLastParent: Element | null = null;

      while (currentNode && normLen < MAX_CHARS) {
        const textNode = currentNode as Text;
        const parent = textNode.parentElement;
        if (parent) {
          const raw = textNode.nodeValue || '';
          if (raw.length > 0) {
            const nodeIdx = textNodes.length;
            textNodes.push(textNode);

            let blockParent: Element;
            if (parent === lastParent && cachedBlockForLastParent) {
              blockParent = cachedBlockForLastParent;
            } else {
              blockParent =
                parent.closest(
                  'p, li, blockquote, h1, h2, h3, h4, h5, h6, div, section, article, td, th, pre'
                ) || parent;
              lastParent = parent;
              cachedBlockForLastParent = blockParent;
            }

            if (lastBlockParent && blockParent !== lastBlockParent && normLen > 0 && !lastWasSpace) {
              pushChar(' ', nodeIdx, 0);
            }
            lastBlockParent = blockParent;

            let nodeChunk = '';
            for (let i = 0; i < raw.length && normLen < MAX_CHARS; i++) {
              const code = raw.charCodeAt(i);
              if (isWhitespaceCode(code)) {
                if (!lastWasSpace) {
                  if (normLen >= capacity) {
                    const nextCap = Math.min(MAX_CHARS, capacity * 2);
                    const nextNodes = new Int32Array(nextCap);
                    const nextOffsets = new Int32Array(nextCap);
                    nextNodes.set(nodeIndices);
                    nextOffsets.set(charOffsets);
                    nodeIndices = nextNodes;
                    charOffsets = nextOffsets;
                    capacity = nextCap;
                  }
                  nodeIndices[normLen] = nodeIdx;
                  charOffsets[normLen] = i;
                  normLen += 1;
                  lastWasSpace = true;
                  nodeChunk += ' ';
                }
              } else {
                const lower =
                  code >= 0x41 && code <= 0x5a
                    ? String.fromCharCode(code + 32)
                    : code < 0x80
                      ? raw[i]
                      : raw[i].toLowerCase();
                for (let j = 0; j < lower.length && normLen < MAX_CHARS; j++) {
                  if (normLen >= capacity) {
                    const nextCap = Math.min(MAX_CHARS, capacity * 2);
                    const nextNodes = new Int32Array(nextCap);
                    const nextOffsets = new Int32Array(nextCap);
                    nextNodes.set(nodeIndices);
                    nextOffsets.set(charOffsets);
                    nodeIndices = nextNodes;
                    charOffsets = nextOffsets;
                    capacity = nextCap;
                  }
                  nodeIndices[normLen] = nodeIdx;
                  charOffsets[normLen] = i;
                  normLen += 1;
                  lastWasSpace = false;
                  nodeChunk += lower[j];
                }
              }
            }
            if (nodeChunk) {
              normParts.push(nodeChunk);
            }
          }
        }
        currentNode = walker.nextNode();
      }

      const fullNormText = normParts.join('');
      const startIdx = fullNormText.indexOf(needleStart);

      let matchedRange: Range | null = null;
      let matchedElement: HTMLElement | null = null;

      if (startIdx !== -1 && normLen > 0) {
        let endIdx = startIdx + needleStart.length - 1;
        if (needleEnd) {
          const searchFrom = startIdx + needleStart.length;
          const foundEnd = fullNormText.indexOf(needleEnd, searchFrom);
          if (foundEnd !== -1 && foundEnd - startIdx <= 6000) {
            endIdx = foundEnd + needleEnd.length - 1;
          }
        }
        endIdx = Math.min(endIdx, normLen - 1);

        const startNode = textNodes[nodeIndices[startIdx]];
        const endNode = textNodes[nodeIndices[endIdx]];
        if (startNode && endNode) {
          matchedElement = startNode.parentElement;
          try {
            const range = document.createRange();
            range.setStart(startNode, charOffsets[startIdx]);
            range.setEnd(endNode, charOffsets[endIdx] + 1);
            matchedRange = range;
          } catch {
            // fallback
          }
        }
      }

      if (!matchedElement) return false;

      let scrollTarget: HTMLElement = matchedElement;

      if (matchedRange) {
        const usedCustomHighlight = applyNonMutatingRangeHighlight(matchedRange);

        // Only fall back to <mark> DOM mutation when CSS Custom Highlight API is unavailable (e.g. JSDOM)
        if (!usedCustomHighlight && matchedRange.startContainer === matchedRange.endContainer) {
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

  const OPEN_LINK_SVG = `<svg class="arctic-hl-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`;
  const SEARCH_WEB_SVG = `<svg class="arctic-hl-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
  const COPY_TEXT_SVG = `<svg class="arctic-hl-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
  const LINK_SVG = `<svg class="arctic-hl-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg>`;
  const BOOKMARK_SVG = `<svg class="arctic-hl-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>`;
  const CHECK_SVG = `<svg class="arctic-hl-icon arctic-hl-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;

  const COMMON_BARE_LINK_TLDS = new Set([
    'com', 'org', 'net', 'edu', 'gov', 'mil', 'int',
    'io', 'co', 'ai', 'app', 'dev', 'me', 'us', 'uk', 'ca', 'au', 'de', 'fr',
    'jp', 'in', 'nl', 'se', 'no', 'fi', 'dk', 'ch', 'at', 'be', 'es', 'it',
    'pt', 'pl', 'cz', 'br', 'mx', 'ar', 'kr', 'tw', 'hk', 'sg', 'nz', 'za',
    'il', 'xyz', 'info', 'biz', 'tech', 'cloud', 'gg', 'tv', 'fm', 'ly', 'to',
    'sh', 'rs', 'so', 'new', 'page', 'site', 'online', 'store', 'blog',
    'design', 'news', 'world', 'live', 'pro', 'tools', 'build', 'run'
  ]);

  const NON_DOMAIN_FILE_EXTS = new Set([
    'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'java', 'cpp', 'c',
    'h', 'hpp', 'cs', 'php', 'swift', 'kt', 'scala', 'lua', 'r', 'sql',
    'css', 'scss', 'less', 'sass', 'json', 'xml', 'yml', 'yaml', 'toml',
    'ini', 'env', 'lock', 'log', 'txt', 'csv', 'tsv', 'pdf', 'png', 'jpg',
    'jpeg', 'gif', 'webp', 'svg', 'ico', 'mp3', 'mp4', 'wav', 'mov', 'zip',
    'tar', 'gz', 'dmg', 'exe', 'pkg', 'deb', 'rpm'
  ]);

  function resolveSelectedLinkUrl(rawText: string, range: Range | null): string | null {
    if (!rawText) return null;

    let candidate = rawText.trim().replace(/^[\s'"“”‘’(\[<]+/, '');
    candidate = candidate.replace(/[.,;:!?\s'"“”‘’\]>]+$/, '');
    while (candidate.endsWith(')')) {
      const openCount = (candidate.match(/\(/g) || []).length;
      const closeCount = (candidate.match(/\)/g) || []).length;
      if (closeCount > openCount) {
        candidate = candidate.slice(0, -1).replace(/[.,;:!?]+$/, '');
      } else {
        break;
      }
    }

    if (candidate.length >= 4 && !/\s/.test(candidate)) {
      if (/^https?:\/\//i.test(candidate)) {
        try {
          const parsed = new URL(candidate);
          if (
            (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
            (parsed.hostname.includes('.') ||
              parsed.hostname === 'localhost' ||
              /^(?:\d{1,3}\.){3}\d{1,3}$/.test(parsed.hostname))
          ) {
            return parsed.href;
          }
        } catch {
          // fall through
        }
      } else if (
        /^localhost(?::\d{1,5})?(?:[/?#].*)?$/i.test(candidate) ||
        /^(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:[/?#].*)?$/.test(candidate)
      ) {
        try {
          return new URL(`http://${candidate}`).href;
        } catch {
          // fall through
        }
      } else {
        const domainMatch = candidate.match(
          /^((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+([a-zA-Z]{2,24}))(?::\d{1,5})?([/?#].*)?$/
        );
        if (domainMatch) {
          const hostPart = domainMatch[1];
          const tld = domainMatch[2].toLowerCase();
          const rest = domainMatch[3] || '';
          const hasCamelCaseHost = /[a-z][A-Z]/.test(hostPart);
          const isValidUnschemedDomain =
            !hasCamelCaseHost &&
            (/^www\./i.test(hostPart) ||
              (rest.length > 0 && !NON_DOMAIN_FILE_EXTS.has(tld)) ||
              COMMON_BARE_LINK_TLDS.has(tld));

          if (isValidUnschemedDomain) {
            try {
              return new URL(`https://${candidate}`).href;
            } catch {
              // fall through
            }
          }
        }
      }
    }

    if (range) {
      try {
        const startNode = range.startContainer;
        const endNode = range.endContainer;
        const startEl =
          startNode instanceof Element ? startNode : startNode?.parentElement;
        const endEl =
          endNode instanceof Element ? endNode : endNode?.parentElement;
        const anchor = startEl?.closest?.('a[href]') as HTMLAnchorElement | null;
        if (anchor && endEl?.closest?.('a[href]') === anchor) {
          const rawHref = (anchor.getAttribute('href') || '').trim();
          if (rawHref && !rawHref.startsWith('#') && !/^javascript:/i.test(rawHref)) {
            const normAnchorText = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
            const normSelectedText = rawText.replace(/\s+/g, ' ').trim();
            if (normAnchorText && normAnchorText === normSelectedText) {
              const resolved = new URL(anchor.href || rawHref, window.location.href);
              if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
                return resolved.href;
              }
            }
          }
        }
      } catch {
        // ignore invalid href or detached selection node
      }
    }

    return null;
  }

  let isEnabled = true;
  let themeMode: 'light' | 'dark' | 'system' = 'system';
  let currentSelectedText = '';
  let currentDetectedLinkUrl: string | null = null;
  let lastPointerX = 160;
  let lastPointerY = 120;
  let selectionTimer: ReturnType<typeof setTimeout> | null = null;
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;

  let hostEl: HTMLDivElement | null = null;
  let shadowRootRef: ShadowRoot | null = null;
  let pillEl: HTMLDivElement | null = null;
  let actionBtnEl: HTMLButtonElement | null = null;
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
    currentDetectedLinkUrl = null;
    if (hostEl) {
      hostEl.remove();
      hostEl = null;
      shadowRootRef = null;
      pillEl = null;
      actionBtnEl = null;
      copyTextBtnEl = null;
      copyBtnEl = null;
      saveBtnEl = null;
    }
  }

  function setButtonContent(btn: HTMLButtonElement, iconSvg: string, label: string): void {
    btn.innerHTML = iconSvg;
    const span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(span);
  }

  function fallbackCopyText(text: string): boolean {
    if (typeof document === 'undefined' || !document.body) return false;
    const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    const savedRanges: Range[] = [];
    if (sel) {
      for (let i = 0; i < sel.rangeCount; i++) {
        try {
          savedRanges.push(sel.getRangeAt(i).cloneRange());
        } catch {
          // ignore
        }
      }
    }

    let copied = false;
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.select();
      copied = Boolean(document.execCommand('copy'));
      ta.remove();
    } catch {
      copied = false;
    }

    if (sel && savedRanges.length > 0) {
      try {
        sel.removeAllRanges();
        for (const r of savedRanges) {
          sel.addRange(r);
        }
      } catch {
        // ignore
      }
    }
    return copied;
  }

  function copyWithButtonFeedback(
    text: string,
    getBtn: () => HTMLButtonElement | null,
    defaultIconSvg: string,
    defaultLabel: string,
    successLabel: string
  ): boolean {
    const scheduleAutoHide = () => {
      if (autoHideTimer) clearTimeout(autoHideTimer);
      autoHideTimer = setTimeout(() => {
        unmountPill();
      }, 1100);
    };

    const markSuccess = () => {
      const btn = getBtn();
      if (btn) {
        btn.setAttribute('data-success', 'true');
        setButtonContent(btn, CHECK_SVG, successLabel);
      }
      scheduleAutoHide();
    };

    const revertSuccess = () => {
      const btn = getBtn();
      if (btn) {
        btn.removeAttribute('data-success');
        setButtonContent(btn, defaultIconSvg, defaultLabel);
      }
      if (autoHideTimer) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
      }
    };

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      markSuccess();
      void navigator.clipboard.writeText(text).catch(() => {
        if (!fallbackCopyText(text)) {
          revertSuccess();
        }
      });
      return true;
    }

    if (fallbackCopyText(text)) {
      markSuccess();
      return true;
    }
    return false;
  }

  function mountOrUpdatePill(
    selectedText: string,
    anchorRect: { top: number; bottom: number; left: number; width: number; height: number },
    detectedLinkUrl: string | null = null
  ): void {
    if (!document.body) return;
    currentSelectedText = selectedText;
    currentDetectedLinkUrl = detectedLinkUrl;

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

      actionBtnEl = document.createElement('button');
      actionBtnEl.type = 'button';
      actionBtnEl.className = 'arctic-hl-btn arctic-hl-action-btn';
      actionBtnEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!currentSelectedText || !isExtensionContextValid()) return;
        const linkTarget = currentDetectedLinkUrl;
        const queryText = currentSelectedText;
        unmountPill();

        if (linkTarget) {
          chrome.runtime.sendMessage(
            {
              type: 'OPEN_SELECTED_LINK',
              url: linkTarget
            },
            () => {
              void chrome.runtime.lastError;
            }
          );
        } else {
          chrome.runtime.sendMessage(
            {
              type: 'SEARCH_SELECTED_TEXT',
              query: queryText
            },
            () => {
              void chrome.runtime.lastError;
            }
          );
        }
      });

      const sep0 = document.createElement('div');
      sep0.className = 'arctic-hl-sep';

      copyTextBtnEl = document.createElement('button');
      copyTextBtnEl.type = 'button';
      copyTextBtnEl.className = 'arctic-hl-btn arctic-hl-copy-text-btn';
      copyTextBtnEl.setAttribute('aria-label', 'Copy Selected Text');
      copyTextBtnEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!currentSelectedText) return;

        copyWithButtonFeedback(
          currentSelectedText,
          () => copyTextBtnEl,
          COPY_TEXT_SVG,
          'Copy Text',
          'Copied Text!'
        );
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

        // Capture the user's exact live selection range before any clipboard operations
        const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
        const selectedRange =
          sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;

        const copied = copyWithButtonFeedback(
          highlightUrl,
          () => copyBtnEl,
          LINK_SVG,
          'Copy Link',
          'Copied Link!'
        );
        if (copied) {
          // Highlight the user's selected range in-place via CSS Custom Highlight API
          // without scrolling the page or mutating/normalizing host DOM nodes.
          applyNonMutatingRangeHighlight(selectedRange);
        }
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
            if (resp && resp.ok === false) return;
            if (saveBtnEl) {
              const targetLabel = resp?.spaceName ? `Saved to ${resp.spaceName}!` : 'Saved Highlight!';
              saveBtnEl.setAttribute('data-success', 'true');
              setButtonContent(saveBtnEl, CHECK_SVG, targetLabel);
            }
            if (autoHideTimer) clearTimeout(autoHideTimer);
            autoHideTimer = setTimeout(() => {
              unmountPill();
            }, 1100);
          }
        );
      });

      pillEl.appendChild(actionBtnEl);
      pillEl.appendChild(sep0);
      pillEl.appendChild(copyTextBtnEl);
      pillEl.appendChild(sep1);
      pillEl.appendChild(copyBtnEl);
      pillEl.appendChild(sep2);
      pillEl.appendChild(saveBtnEl);
      shadowRootRef.appendChild(style);
      shadowRootRef.appendChild(pillEl);
      document.body.appendChild(hostEl);
    }

    if (!pillEl || !actionBtnEl || !copyTextBtnEl || !copyBtnEl || !saveBtnEl) return;

    pillEl.setAttribute('data-theme', resolveEffectiveTheme());
    actionBtnEl.removeAttribute('data-success');
    if (detectedLinkUrl) {
      actionBtnEl.setAttribute('data-action', 'open-link');
      actionBtnEl.setAttribute('aria-label', 'Open Link');
      setButtonContent(actionBtnEl, OPEN_LINK_SVG, 'Open Link');
    } else {
      actionBtnEl.setAttribute('data-action', 'search-web');
      actionBtnEl.setAttribute('aria-label', 'Search Web');
      setButtonContent(actionBtnEl, SEARCH_WEB_SVG, 'Search Web');
    }
    copyTextBtnEl.removeAttribute('data-success');
    setButtonContent(copyTextBtnEl, COPY_TEXT_SVG, 'Copy Text');
    copyBtnEl.removeAttribute('data-success');
    setButtonContent(copyBtnEl, LINK_SVG, 'Copy Link');
    saveBtnEl.removeAttribute('data-success');
    setButtonContent(saveBtnEl, BOOKMARK_SVG, 'Save Highlight');

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
    if (rawText.length < 2 || rawText.length > 2500) {
      unmountPill();
      return;
    }

    let range: Range | null = null;
    let rect = { top: 0, bottom: 0, left: 0, width: 0, height: 0 };
    try {
      range = sel.getRangeAt(0);
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

    const detectedLinkUrl = resolveSelectedLinkUrl(rawText, range);
    mountOrUpdatePill(rawText, rect, detectedLinkUrl);
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

  let pageListenersAttached = false;

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
        if (isEnabled) {
          attachPageListeners();
        } else {
          unmountPill();
          detachPageListeners();
        }
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
      detachPageListeners();
    }
  };

  const handleSupersede = () => {
    cleanupAll();
  };

  function checkAndScrollToUrlHighlight(allowNavigationFallback = false): void {
    try {
      let candidateUrl = window.location?.href || '';
      if (
        allowNavigationFallback &&
        !candidateUrl.includes(':~:text=') &&
        typeof performance !== 'undefined'
      ) {
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
    checkAndScrollToUrlHighlight(false);
  };

  function attachPageListeners(): void {
    if (pageListenersAttached) return;
    pageListenersAttached = true;
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('scroll', handleScrollOrResize, { capture: true, passive: true });
    window.addEventListener('resize', handleScrollOrResize, { passive: true });
    window.addEventListener('hashchange', handleHashChange);
  }

  function detachPageListeners(): void {
    if (!pageListenersAttached) return;
    pageListenersAttached = false;
    document.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('pointerdown', handlePointerDown, true);
    document.removeEventListener('keyup', handleKeyUp);
    document.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('scroll', handleScrollOrResize, true);
    window.removeEventListener('resize', handleScrollOrResize);
    window.removeEventListener('hashchange', handleHashChange);
  }

  function cleanupAll(): void {
    unmountPill();
    detachPageListeners();
    document.removeEventListener(SUPERSEDE_EVENT, handleSupersede);
    try {
      chrome.storage?.onChanged?.removeListener(handleStorageChanged);
      chrome.runtime?.onMessage?.removeListener(handleRuntimeMessage);
    } catch {
      // ignore invalidated context
    }
  }

  win.__arcticHighlightPillCleanup = cleanupAll;

  attachPageListeners();
  document.addEventListener(SUPERSEDE_EVENT, handleSupersede);

  // If the page was opened with a #:~:text=... highlight URL, scroll to and highlight the passage
  checkAndScrollToUrlHighlight(true);

  if (isExtensionContextValid()) {
    try {
      chrome.storage.onChanged.addListener(handleStorageChanged);
      chrome.runtime.onMessage.addListener(handleRuntimeMessage);
      chrome.storage.local.get(['highlightPillEnabled', 'theme'], (res) => {
        void chrome.runtime.lastError;
        if (!isExtensionContextValid()) return;
        if (typeof res?.highlightPillEnabled === 'boolean') {
          isEnabled = res.highlightPillEnabled;
          if (!isEnabled) {
            unmountPill();
            detachPageListeners();
          }
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
