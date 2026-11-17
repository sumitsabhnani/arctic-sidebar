import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildHighlightUrl,
  buildTextFragmentDirective,
  encodeTextFragmentToken,
  extractHighlightFromUrl,
  formatHighlightBookmarkTitle,
  getActiveTabHighlightSelection,
  getSelectionInDocument,
   getStoredHighlights,
  hasTextFragment,
  parseHighlightBookmarkDisplay,
  removeStoredHighlights,
  scrollToHighlightInDocument,
  scrollToHighlightInTab,
  stripTextFragmentFromUrl,
  upsertStoredHighlight
} from './highlight';
import { mockChrome } from '../../test/setup';

describe('Highlight URL & Text Fragment utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('encodes Text Fragment tokens including syntax delimiters (-, ,, &)', () => {
    expect(encodeTextFragmentToken('first-class, fast & reliable')).toBe(
      'first%2Dclass%2C%20fast%20%26%20reliable'
    );
  });

  it('builds exact text fragment for short single-line selections and start,end range for long or multi-paragraph selections', () => {
    expect(buildTextFragmentDirective('Curiosity is the best guide')).toBe(
      'text=Curiosity%20is%20the%20best%20guide'
    );

    const multiParagraph =
      'First paragraph starts with these important words right here.\n\nSecond paragraph ends with a memorable conclusion today.';
    const directive = buildTextFragmentDirective(multiParagraph);
    expect(directive).toBe(
      'text=First%20paragraph%20starts%20with%20these%20important,ends%20with%20a%20memorable%20conclusion%20today.'
    );
  });

  it('builds highlight URLs, preserves existing hash anchors, and replaces stale text fragments', () => {
    const simpleUrl = buildHighlightUrl(
      'https://paulgraham.com/greatwork.html',
      'Curiosity is the best guide'
    );
    expect(simpleUrl).toBe(
      'https://paulgraham.com/greatwork.html#:~:text=Curiosity%20is%20the%20best%20guide'
    );
    expect(hasTextFragment(simpleUrl)).toBe(true);

    // Preserves #section anchor
    const anchorUrl = buildHighlightUrl(
      'https://example.com/docs#architecture',
      'isolated shadow root'
    );
    expect(anchorUrl).toBe(
      'https://example.com/docs#architecture:~:text=isolated%20shadow%20root'
    );
    expect(stripTextFragmentFromUrl(anchorUrl)).toBe(
      'https://example.com/docs#architecture'
    );

    // Replaces existing :~:text= directive cleanly
    const replacedUrl = buildHighlightUrl(simpleUrl, 'New highlighted quote');
    expect(replacedUrl).toBe(
      'https://paulgraham.com/greatwork.html#:~:text=New%20highlighted%20quote'
    );
    expect(stripTextFragmentFromUrl(replacedUrl)).toBe(
      'https://paulgraham.com/greatwork.html'
    );
  });

  it('extracts and decodes both exact and range highlights from #:~:text= URLs', () => {
    const exact = extractHighlightFromUrl(
      'https://example.com/post#:~:text=first%2Dclass%2C%20fast%20%26%20reliable'
    );
    expect(exact).toEqual({
      textStart: 'first-class, fast & reliable',
      displayQuote: 'first-class, fast & reliable'
    });

    const range = extractHighlightFromUrl(
      'https://example.com/post#:~:text=prefix-,Start%20of%20quote,end%20of%20quote,-suffix'
    );
    expect(range).toEqual({
      textStart: 'Start of quote',
      textEnd: 'end of quote',
      displayQuote: 'Start of quote … end of quote'
    });
  });

  it('formats highlight bookmark titles and parses displayTitle + quoteText without duplication', () => {
    const title = formatHighlightBookmarkTitle(
      'The best way to predict the future is to invent it.',
      'Alan Kay — Wikipedia',
      'https://en.wikipedia.org/wiki/Alan_Kay'
    );
    expect(title).toBe(
      '“The best way to predict the future is to invent it.” — Alan Kay — Wikipedia'
    );

    const url = buildHighlightUrl(
      'https://en.wikipedia.org/wiki/Alan_Kay',
      'The best way to predict the future is to invent it.'
    );

    // 1. Auto-formatted title separates page title and quote cleanly
    const parsed = parseHighlightBookmarkDisplay(title, url);
    expect(parsed).toEqual({
      displayTitle: 'Alan Kay — Wikipedia',
      quoteText: 'The best way to predict the future is to invent it.',
      isHighlight: true
    });

    // 2. Custom renamed bookmark keeps custom title and still surfaces full stored quote
    const customParsed = parseHighlightBookmarkDisplay(
      'Favorite Alan Kay Quote',
      url,
      'The best way to predict the future is to invent it — full passage from 1971.'
    );
    expect(customParsed).toEqual({
      displayTitle: 'Favorite Alan Kay Quote',
      quoteText:
        'The best way to predict the future is to invent it — full passage from 1971.',
      isHighlight: true
    });

    // 3. Regular bookmark without highlight returns isHighlight: false
    expect(
      parseHighlightBookmarkDisplay('GitHub', 'https://github.com')
    ).toEqual({
      displayTitle: 'GitHub',
      quoteText: null,
      isHighlight: false
    });
  });

  it('persists and removes highlight metadata in chrome.storage.local', async () => {
    mockChrome.__setLocalStorage({});
    await upsertStoredHighlight({
      bookmarkId: 'bm-1',
      quote: 'Saved quote 1',
      pageTitle: 'Article 1',
      pageUrl: 'https://example.com/1',
      createdAt: 1000
    });
    await upsertStoredHighlight({
      bookmarkId: 'bm-2',
      quote: 'Saved quote 2',
      pageTitle: 'Article 2',
      pageUrl: 'https://example.com/2',
      createdAt: 2000
    });

    let stored = await getStoredHighlights();
    expect(Object.keys(stored)).toEqual(['bm-1', 'bm-2']);
    expect(stored['bm-1'].quote).toBe('Saved quote 1');

    await removeStoredHighlights(['bm-1']);
    stored = await getStoredHighlights();
    expect(Object.keys(stored)).toEqual(['bm-2']);
  });

  it('reads non-editable selection via getSelectionInDocument and getActiveTabHighlightSelection', async () => {
    const p = document.createElement('p');
    p.textContent = 'Simplicity is prerequisite for reliability.';
    document.body.appendChild(p);

    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const inDoc = getSelectionInDocument();
    expect(inDoc?.text).toBe('Simplicity is prerequisite for reliability.');

    // Ignores selection when an input is focused
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(getSelectionInDocument()).toBeNull();
    input.remove();

    // getActiveTabHighlightSelection executes script when host permission is granted
    mockChrome.__setHostPermissionsGranted(true);
    (chrome.scripting.executeScript as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        result: {
          text: 'Simplicity is prerequisite for reliability.',
          url: 'https://cs.utexas.edu/ewd',
          title: 'Edsger W. Dijkstra Archive'
        }
      }
    ]);

    const activeSel = await getActiveTabHighlightSelection(
      1,
      'https://cs.utexas.edu/ewd'
    );
    expect(activeSel).toEqual({
      text: 'Simplicity is prerequisite for reliability.',
      highlightUrl:
        'https://cs.utexas.edu/ewd#:~:text=Simplicity%20is%20prerequisite%20for%20reliability.',
      pageUrl: 'https://cs.utexas.edu/ewd',
      pageTitle: 'Edsger W. Dijkstra Archive'
    });
  });

  it('scrolls to matching highlight passage in document and pulses highlight background', async () => {
    const article = document.createElement('article');
    const para1 = document.createElement('p');
    para1.textContent = 'Introductory paragraph at the top.';
    const para2 = document.createElement('p');
    para2.textContent = 'Target highlighted quote inside the second paragraph.';
    const scrollSpy = vi.fn();
    para2.scrollIntoView = scrollSpy;
    article.appendChild(para1);
    article.appendChild(para2);
    document.body.appendChild(article);

    const scrolled = scrollToHighlightInDocument({
      textStart: 'Target highlighted quote'
    });
    expect(scrolled).toBe(true);
    expect(para2.querySelector('mark[data-arctic-highlight="true"]')?.textContent).toBe(
      'Target highlighted quote'
    );
    expect(para2.style.backgroundColor).toContain('rgba(251, 191, 36');

    // Also matches across inline elements (<b>, <a>, <span>)
    const para3 = document.createElement('p');
    para3.innerHTML = 'One of the <b>nice features</b> in <a>Arc browser</a> was sharing highlights.';
    article.appendChild(para3);

    const multiNodeScrolled = scrollToHighlightInDocument({
      textStart: 'one of the nice features in arc browser'
    });
    expect(multiNodeScrolled).toBe(true);

    mockChrome.__setHostPermissionsGranted(true);
    (chrome.scripting.executeScript as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { result: true }
    ]);
    const tabResult = await scrollToHighlightInTab(
      1,
      'https://example.com/article#:~:text=Target%20highlighted%20quote'
    );
    expect(tabResult).toBe(true);
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 1 },
        args: [{ textStart: 'Target highlighted quote', textEnd: undefined }]
      })
    );
  });
});
