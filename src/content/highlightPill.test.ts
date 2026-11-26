import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockChrome } from '../test/setup';

describe('highlightPill content script (on-page floating selection pill)', () => {
  let capturedShadowRoots: ShadowRoot[] = [];
  const origAttachShadow = Element.prototype.attachShadow;

  beforeEach(() => {
    capturedShadowRoots = [];
    vi.resetModules();
    document.body.innerHTML = '';
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
      const root = origAttachShadow.call(this, { ...init, mode: 'open' });
      capturedShadowRoots.push(root);
      return root;
    };
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
  });

  afterEach(() => {
    const win = window as Window & { __arcticHighlightPillCleanup?: () => void };
    if (typeof win.__arcticHighlightPillCleanup === 'function') {
      win.__arcticHighlightPillCleanup();
      delete win.__arcticHighlightPillCleanup;
    }
    window.getSelection()?.removeAllRanges();
    Element.prototype.attachShadow = origAttachShadow;
    document.getElementById('arctic-highlight-pill-host')?.remove();
  });

  it('mounts floating pill when text is selected on page, copies #:~:text= link, and saves highlight to active Space', async () => {
    mockChrome.__setLocalStorage({
      highlightPillEnabled: true,
      theme: 'dark'
    });

    mockChrome.runtime.onMessage.addListener(
      (
        msg: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (resp?: unknown) => void
      ) => {
        const m = msg as { type?: string };
        if (m?.type === 'SAVE_HIGHLIGHT_BOOKMARK') {
          sendResponse({ ok: true, bookmarkId: 'bm-hl-1', spaceName: 'Work' });
        }
      }
    );

    await import('./highlightPill');
    await new Promise((r) => setTimeout(r, 10));

    // Initially 0 DOM footprint when nothing is selected
    expect(document.getElementById('arctic-highlight-pill-host')).toBeNull();

    // Select text inside an article paragraph
    const p = document.createElement('p');
    p.textContent = 'Arc lets you share a deep link to any highlighted quote.';
    document.body.appendChild(p);

    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 140 })
    );
    await new Promise((r) => setTimeout(r, 25));

    const host = document.getElementById('arctic-highlight-pill-host');
    expect(host).not.toBeNull();
    expect(capturedShadowRoots.length).toBe(1);

    const actionBtn = capturedShadowRoots[0].querySelector(
      'button.arctic-hl-action-btn'
    ) as HTMLButtonElement;
    const copyTextBtn = capturedShadowRoots[0].querySelector(
      'button.arctic-hl-copy-text-btn'
    ) as HTMLButtonElement;
    const copyBtn = capturedShadowRoots[0].querySelector(
      'button.arctic-hl-copy-btn'
    ) as HTMLButtonElement;
    const saveBtn = capturedShadowRoots[0].querySelector(
      'button.arctic-hl-save-btn'
    ) as HTMLButtonElement;
    expect(actionBtn).not.toBeNull();
    expect(actionBtn.getAttribute('data-action')).toBe('search-web');
    expect(actionBtn.textContent).toContain('Search Web');
    expect(copyTextBtn).not.toBeNull();
    expect(copyTextBtn.textContent).toContain('Copy Text');
    expect(copyBtn).not.toBeNull();
    expect(saveBtn).not.toBeNull();

    // 1. Click "Copy Text" -> writes raw selected text to clipboard and shows "Copied Text!"
    copyTextBtn.click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'Arc lets you share a deep link to any highlighted quote.'
    );
    expect(copyTextBtn.textContent).toContain('Copied Text!');

    // 2. Click "Copy Link" -> writes #:~:text=... URL to clipboard and shows "Copied Link!"
    copyBtn.click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining(
        '#:~:text=Arc%20lets%20you%20share%20a%20deep%20link%20to%20any%20highlighted%20quote.'
      )
    );
    expect(copyBtn.textContent).toContain('Copied Link!');

    // 3. Click "Save Highlight" -> sends SAVE_HIGHLIGHT_BOOKMARK and shows "Saved to Work!"
    mockChrome.runtime.sendMessage.mockClear();
    saveBtn.click();
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SAVE_HIGHLIGHT_BOOKMARK',
        quote: 'Arc lets you share a deep link to any highlighted quote.',
        url: expect.stringContaining('#:~:text=')
      }),
      expect.any(Function)
    );
    expect(saveBtn.textContent).toContain('Saved to Work!');

    // Pressing Escape dismisses the pill immediately
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('arctic-highlight-pill-host')).toBeNull();
  });

  it('ignores selections inside editable inputs/textareas and unmounts on ARCTIC_REMOVE_HIGHLIGHT_PILL', async () => {
    mockChrome.__setLocalStorage({ highlightPillEnabled: true });
    await import('./highlightPill');
    await new Promise((r) => setTimeout(r, 10));

    const input = document.createElement('input');
    input.value = 'Text inside an input field';
    document.body.appendChild(input);
    input.focus();

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 25));

    expect(document.getElementById('arctic-highlight-pill-host')).toBeNull();
    input.remove();

    // Select normal paragraph text -> mounts pill
    const p = document.createElement('p');
    p.textContent = 'Valid article quote selection';
    document.body.appendChild(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 25));
    expect(document.getElementById('arctic-highlight-pill-host')).not.toBeNull();

    // Receiving ARCTIC_REMOVE_HIGHLIGHT_PILL unmounts pill
    chrome.runtime.sendMessage({ type: 'ARCTIC_REMOVE_HIGHLIGHT_PILL' });
    expect(document.getElementById('arctic-highlight-pill-host')).toBeNull();
  });

  it('automatically scrolls to and highlights #:~:text= passage on page load or hashchange', async () => {
    const p = document.createElement('p');
    p.textContent = 'Deep linked passage that should be highlighted on load.';
    document.body.appendChild(p);

    const origHref = window.location.href;
    window.history.replaceState(
      null,
      '',
      '#:~:text=Deep%20linked%20passage%20that%20should%20be%20highlighted'
    );

    try {
      await import('./highlightPill');
      await new Promise((r) => setTimeout(r, 15));

      const mark = p.querySelector('mark[data-arctic-highlight="true"]');
      expect(mark).not.toBeNull();
      expect(mark?.textContent).toBe('Deep linked passage that should be highlighted');
    } finally {
      window.history.replaceState(null, '', origHref);
    }
  });

  it('shows Open Link when selected text is a URL/domain or inline anchor link, and Search Web for regular text or code identifiers', async () => {
    mockChrome.__setLocalStorage({ highlightPillEnabled: true, theme: 'dark' });
    await import('./highlightPill');
    await new Promise((r) => setTimeout(r, 10));

    const selectElementContents = async (el: HTMLElement) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: 180, clientY: 120 })
      );
      await new Promise((r) => setTimeout(r, 25));
    };

    // 1. Plain-text URL wrapped in parentheses + punctuation -> shows Open Link & preserves balanced URL parens
    const urlSpan = document.createElement('span');
    urlSpan.textContent = '(https://en.wikipedia.org/wiki/Rust_(programming_language)).';
    document.body.appendChild(urlSpan);
    await selectElementContents(urlSpan);

    let root = capturedShadowRoots[capturedShadowRoots.length - 1];
    let actionBtn = root.querySelector('button.arctic-hl-action-btn') as HTMLButtonElement;
    expect(actionBtn.getAttribute('data-action')).toBe('open-link');
    expect(actionBtn.textContent).toContain('Open Link');

    mockChrome.runtime.sendMessage.mockClear();
    actionBtn.click();
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: 'OPEN_SELECTED_LINK',
        url: 'https://en.wikipedia.org/wiki/Rust_(programming_language)'
      },
      expect.any(Function)
    );
    expect(document.getElementById('arctic-highlight-pill-host')).toBeNull();

    // 2. Unschemed domain with path -> shows Open Link with https://
    const domainSpan = document.createElement('span');
    domainSpan.textContent = 'github.com/vitejs/vite';
    document.body.appendChild(domainSpan);
    await selectElementContents(domainSpan);

    root = capturedShadowRoots[capturedShadowRoots.length - 1];
    actionBtn = root.querySelector('button.arctic-hl-action-btn') as HTMLButtonElement;
    expect(actionBtn.getAttribute('data-action')).toBe('open-link');

    mockChrome.runtime.sendMessage.mockClear();
    actionBtn.click();
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: 'OPEN_SELECTED_LINK',
        url: 'https://github.com/vitejs/vite'
      },
      expect.any(Function)
    );

    // 3. Inline <a href="..."> anchor text -> shows Open Link resolving anchor href
    const linkEl = document.createElement('a');
    linkEl.href = 'https://docs.example.com/getting-started';
    linkEl.textContent = 'Read Getting Started';
    document.body.appendChild(linkEl);
    await selectElementContents(linkEl);

    root = capturedShadowRoots[capturedShadowRoots.length - 1];
    actionBtn = root.querySelector('button.arctic-hl-action-btn') as HTMLButtonElement;
    expect(actionBtn.getAttribute('data-action')).toBe('open-link');

    mockChrome.runtime.sendMessage.mockClear();
    actionBtn.click();
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: 'OPEN_SELECTED_LINK',
        url: 'https://docs.example.com/getting-started'
      },
      expect.any(Function)
    );

    // 4. Code identifier / filename like "App.tsx" or plain phrase -> shows Search Web (not false-positive link)
    const codeSpan = document.createElement('span');
    codeSpan.textContent = 'App.tsx';
    document.body.appendChild(codeSpan);
    await selectElementContents(codeSpan);

    root = capturedShadowRoots[capturedShadowRoots.length - 1];
    actionBtn = root.querySelector('button.arctic-hl-action-btn') as HTMLButtonElement;
    expect(actionBtn.getAttribute('data-action')).toBe('search-web');
    expect(actionBtn.textContent).toContain('Search Web');

    mockChrome.runtime.sendMessage.mockClear();
    actionBtn.click();
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: 'SEARCH_SELECTED_TEXT',
        query: 'App.tsx'
      },
      expect.any(Function)
    );
  });
});
