import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { isLikelyUrl, formatNavigationUrl, getArcticBookmarks, App } from './App';
import {
  findMatchingSiteEngine,
  getGhostAutocomplete,
  buildSiteSearchUrl
} from './utils/siteSearch';

describe('newtab url detection and formatting', () => {
  describe('isLikelyUrl', () => {
    it('identifies standard web protocols as URLs (positive)', () => {
      expect(isLikelyUrl('https://google.com')).toBe(true);
      expect(isLikelyUrl('http://example.com/path')).toBe(true);
      expect(isLikelyUrl('HTTPS://GITHUB.COM')).toBe(true);
    });

    it('identifies localhost and local IP addresses with ports (positive)', () => {
      expect(isLikelyUrl('localhost')).toBe(true);
      expect(isLikelyUrl('localhost:3000')).toBe(true);
      expect(isLikelyUrl('localhost:8080/dashboard')).toBe(true);
      expect(isLikelyUrl('127.0.0.1:5173')).toBe(true);
      expect(isLikelyUrl('192.168.1.1')).toBe(true);
    });

    it('identifies domain-like strings without protocols (positive)', () => {
      expect(isLikelyUrl('github.com')).toBe(true);
      expect(isLikelyUrl('sub.domain.co.uk')).toBe(true);
      expect(isLikelyUrl('news.ycombinator.com/item?id=123')).toBe(true);
    });

    it('rejects general search queries and multi-word phrases (negative)', () => {
      expect(isLikelyUrl('react hooks tutorial')).toBe(false);
      expect(isLikelyUrl('how to center a div')).toBe(false);
      expect(isLikelyUrl('hello world')).toBe(false);
    });

    it('rejects single words without domain extension or protocol (negative)', () => {
      expect(isLikelyUrl('hello')).toBe(false);
      expect(isLikelyUrl('search')).toBe(false);
      expect(isLikelyUrl('')).toBe(false);
      expect(isLikelyUrl('   ')).toBe(false);
    });
  });

  describe('formatNavigationUrl', () => {
    it('preserves existing http / https scheme for valid URLs (positive)', () => {
      expect(formatNavigationUrl('https://google.com')).toBe('https://google.com');
      expect(formatNavigationUrl('http://example.org')).toBe('http://example.org');
    });

    it('prepends https:// to domain-like strings (positive)', () => {
      expect(formatNavigationUrl('github.com')).toBe('https://github.com');
      expect(formatNavigationUrl('localhost:3000')).toBe('https://localhost:3000');
    });

    it('converts non-URL search queries into Google search URLs (negative/search fallback)', () => {
      expect(formatNavigationUrl('vitest mock setup')).toBe('https://www.google.com/search?q=vitest%20mock%20setup');
      expect(formatNavigationUrl('hello world')).toBe('https://www.google.com/search?q=hello%20world');
    });

    it('handles leading and trailing whitespace cleanly', () => {
      expect(formatNavigationUrl('   nytimes.com   ')).toBe('https://nytimes.com');
      expect(formatNavigationUrl('   typescript tips   ')).toBe('https://www.google.com/search?q=typescript%20tips');
    });
  });

  describe('Command Palette Actions', () => {
    it('shows action commands when user types > in the search bar', async () => {
      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i);
      expect(input).toBeInTheDocument();

      await act(async () => {
        fireEvent.change(input, { target: { value: '>' } });
      });

      expect(screen.getByText('Action Commands')).toBeInTheDocument();
      expect(screen.getByText(/Switch to (Light|Dark) Mode/i)).toBeInTheDocument();
      expect(screen.getByText(/Palette: Glacier Blue/i)).toBeInTheDocument();
      expect(screen.getByText(/Sleep Inactive Background Tabs/i)).toBeInTheDocument();
    });

    it('filters commands when typing after >', async () => {
      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: '> sleep' } });
      });

      expect(screen.getByText('Sleep Inactive Background Tabs')).toBeInTheDocument();
      expect(screen.queryByText(/Palette: Glacier Blue/i)).not.toBeInTheDocument();
    });

    it('executes a command on click and displays feedback toast', async () => {
      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: '> theme' } });
      });

      const themeCmd = screen.getByText(/Switch to (Light|Dark) Mode/i);
      await act(async () => {
        fireEvent.click(themeCmd);
      });

      expect(screen.getByText(/Theme switched to (light|dark) mode/i)).toBeInTheDocument();
    });

    it('opens Arctic settings when searching for "Settings" in the command bar', async () => {
      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Settings' } });
      });

      const settingsCmd = await screen.findByText('Open Arctic Settings');
      expect(settingsCmd).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(settingsCmd);
      });

      expect(chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 10 });
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'OPEN_ARCTIC_SETTINGS' });
      const local = await chrome.storage.local.get(['openArcticSettings']);
      expect(local.openArcticSettings).toBeTruthy();
      expect(screen.getByText('Opened Arctic Settings')).toBeInTheDocument();
    });

    it('auto-applies system light/dark theme when Theme is set to "System"', async () => {
      let changeListener: ((e: MediaQueryListEvent) => void) | null = null;
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: true, // OS is in dark mode
        media: query,
        onchange: null,
        addEventListener: vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
          if (event === 'change') changeListener = cb;
        }),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }));

      try {
        render(<App />);
        const input = screen.getByPlaceholderText(/type > for commands/i);

        await act(async () => {
          fireEvent.change(input, { target: { value: 'system' } });
        });

        const systemThemeCmd = await screen.findByText('Theme: System (Auto Light/Dark)');
        expect(systemThemeCmd).toBeInTheDocument();

        await act(async () => {
          fireEvent.click(systemThemeCmd);
        });

        const local = await chrome.storage.local.get(['theme']);
        expect(local.theme).toBe('system');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(screen.getByText('Theme set to System (auto light/dark)')).toBeInTheDocument();

        // Simulate OS switching from Dark to Light mode while in 'system' mode
        expect(changeListener).not.toBeNull();
        await act(async () => {
          changeListener?.({ matches: false } as MediaQueryListEvent);
        });
        expect(document.documentElement.classList.contains('light')).toBe(true);
        expect(document.documentElement.classList.contains('dark')).toBe(false);
      } finally {
        window.matchMedia = originalMatchMedia;
      }
    });

    it('supports new Aqua and multi-tone color themes in the command bar', async () => {
      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: '> aqua' } });
      });

      const crystalAquaCmd = screen.getByText('Palette: Crystal Aqua');
      const aquaLagoonCmd = screen.getByText('Palette: Aqua Lagoon');
      expect(crystalAquaCmd).toBeInTheDocument();
      expect(aquaLagoonCmd).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(aquaLagoonCmd);
      });

      const local = await chrome.storage.local.get(['colorTheme']);
      expect(local.colorTheme).toBe('aqua-lagoon');
      expect(document.documentElement.getAttribute('data-color-theme')).toBe('aqua-lagoon');
      expect(screen.getByText('Color palette set to Aqua Lagoon')).toBeInTheDocument();
    });
  });

  describe('Bookmark Search and Tab Binding Navigation', () => {
    it('binds tab and switches space when selecting an unopened Arctic bookmark', async () => {
      // 1. Setup Arctic bookmark hierarchy in mock Chrome
      const otherNode = (await chrome.bookmarks.getSubTree('2'))[0];
      const arcticRoot = await chrome.bookmarks.create({
        parentId: otherNode.id,
        title: 'Arctic'
      });
      const workFolder = await chrome.bookmarks.create({
        parentId: arcticRoot.id,
        title: 'Work'
      });
      const linearBm = await chrome.bookmarks.create({
        parentId: workFolder.id,
        title: 'Linear App',
        url: 'https://linear.app'
      });

      await chrome.storage.local.set({
        spaces: [
          { id: 'home', name: 'Home' },
          { id: 'work', name: 'Work', folderId: workFolder.id }
        ],
        activeSpaceId: 'home'
      });

      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: 'linear' } });
      });

      // Verify Linear App suggestion appears with Space badge
      const bmItem = await screen.findByText('Linear App');
      expect(bmItem).toBeInTheDocument();
      expect(screen.getByText('Space Tab')).toBeInTheDocument();

      // Press Enter to open
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      });

      // Verify session storage bindings were created
      const session = await chrome.storage.session.get(['bindingsByBookmarkId', 'bookmarkIdByTabId']);
      expect(session.bindingsByBookmarkId[linearBm.id]).toBeDefined();
      expect(session.bindingsByBookmarkId[linearBm.id].originalUrl).toBe('https://linear.app');
      expect(session.bookmarkIdByTabId[1]).toBe(linearBm.id);

      // Verify activeSpaceId was switched to 'work'
      const local = await chrome.storage.local.get(['activeSpaceId']);
      expect(local.activeSpaceId).toBe('work');

      // Verify chrome.tabs.update was invoked with destination url
      expect(chrome.tabs.update).toHaveBeenCalledWith(1, {
        url: 'https://linear.app',
        active: true
      });
    });

    it('focuses existing tab and closes command launcher when bookmark is already open', async () => {
      const otherNode = (await chrome.bookmarks.getSubTree('2'))[0];
      const arcticRoot = await chrome.bookmarks.create({
        parentId: otherNode.id,
        title: 'Arctic'
      });
      const qaFolder = await chrome.bookmarks.create({
        parentId: arcticRoot.id,
        title: 'Quick Access'
      });
      const githubBm = await chrome.bookmarks.create({
        parentId: qaFolder.id,
        title: 'GitHub',
        url: 'https://github.com'
      });

      // Create existing tab 2 for GitHub
      const openTab = await chrome.tabs.create({ url: 'https://github.com', active: false });

      // Pre-bind tab in session storage
      await chrome.storage.session.set({
        bindingsByBookmarkId: {
          [githubBm.id]: {
            bookmarkId: githubBm.id,
            tabId: openTab.id,
            windowId: 10,
            originalUrl: 'https://github.com',
            currentUrl: 'https://github.com',
            currentTitle: 'GitHub',
            isNavigatedAway: false
          }
        },
        bookmarkIdByTabId: {
          [openTab.id!]: githubBm.id
        }
      });

      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: 'github' } });
      });

      const bmItem = await screen.findByText('GitHub');
      expect(bmItem).toBeInTheDocument();

      // Click the bookmark item
      await act(async () => {
        fireEvent.click(bmItem);
      });

      // Verify existing tab 2 was focused
      expect(chrome.tabs.update).toHaveBeenCalledWith(openTab.id, { active: true });

      // Verify the launcher tab (tab 1) was closed
      expect(chrome.tabs.remove).toHaveBeenCalledWith(1);
    });

    it('immediately fades out command bar, shows progress bar, and disables input on enter', async () => {
      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: 'https://news.ycombinator.com' } });
      });

      // Initially not navigating
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(input).not.toBeDisabled();

      // Press Enter to navigate
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      });

      // Immediately shows navigation progress bar
      expect(screen.getByRole('progressbar')).toBeInTheDocument();

      // Input becomes disabled immediately
      expect(input).toBeDisabled();

      // Palette card has opacity-0 and pointer-events-none class
      const paletteContainer = input.closest('.max-w-\\[620px\\]');
      expect(paletteContainer).toHaveClass('opacity-0');
      expect(paletteContainer).toHaveClass('pointer-events-none');

      // Navigation was initiated
      expect(chrome.tabs.update).toHaveBeenCalledWith(1, {
        url: 'https://news.ycombinator.com',
        active: true
      });
    });

    it('prevents multiple submit attempts when user presses enter repeatedly', async () => {
      vi.mocked(chrome.tabs.update).mockClear();
      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: 'https://apple.com' } });
      });

      // Press Enter multiple times in rapid succession
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      });

      // Only invoked once
      expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
      expect(chrome.tabs.update).toHaveBeenCalledWith(1, {
        url: 'https://apple.com',
        active: true
      });
    });
  });

  describe('getArcticBookmarks with nested Quick Access folders', () => {
    it('properly indexes nested Quick Access under Home and other Spaces', async () => {
      const otherNode = (await chrome.bookmarks.getSubTree('2'))[0];
      const arcticRoot = await chrome.bookmarks.create({
        parentId: otherNode.id,
        title: 'Arctic'
      });

      // 1. Home space with nested Quick Access and regular folder
      const homeFolder = await chrome.bookmarks.create({
        parentId: arcticRoot.id,
        title: 'Home'
      });
      const homeQa = await chrome.bookmarks.create({
        parentId: homeFolder.id,
        title: 'Quick Access'
      });
      await chrome.bookmarks.create({
        parentId: homeQa.id,
        title: 'Gmail',
        url: 'https://mail.google.com'
      });
      await chrome.bookmarks.create({
        parentId: homeFolder.id,
        title: 'Home Bookmark',
        url: 'https://home.example.com'
      });

      // 2. Learning space with nested Quick Access and subfolder
      const learningFolder = await chrome.bookmarks.create({
        parentId: arcticRoot.id,
        title: 'Learning'
      });
      const learningQa = await chrome.bookmarks.create({
        parentId: learningFolder.id,
        title: 'Quick Access'
      });
      await chrome.bookmarks.create({
        parentId: learningQa.id,
        title: 'Coursera',
        url: 'https://coursera.org'
      });
      const learningSub = await chrome.bookmarks.create({
        parentId: learningFolder.id,
        title: 'AI Courses'
      });
      await chrome.bookmarks.create({
        parentId: learningSub.id,
        title: 'DeepLearning.AI',
        url: 'https://deeplearning.ai'
      });

      // 3. Stored spaces configuration
      await chrome.storage.local.set({
        spaces: [
          { id: 'home', name: 'Home', folderId: homeFolder.id, quickAccessFolderId: homeQa.id },
          { id: 'space-learning', name: 'Learning', folderId: learningFolder.id, quickAccessFolderId: learningQa.id }
        ]
      });

      const indexed = await getArcticBookmarks();

      // Check Gmail inside Home / Quick Access
      const gmailItem = indexed.find((b) => b.title === 'Gmail');
      expect(gmailItem).toBeDefined();
      expect(gmailItem?.isQuickAccess).toBe(true);
      expect(gmailItem?.spaceName).toBe('Quick Access');
      expect(gmailItem?.spaceId).toBe('home');

      // Check Coursera inside Learning / Quick Access
      const courseraItem = indexed.find((b) => b.title === 'Coursera');
      expect(courseraItem).toBeDefined();
      expect(courseraItem?.isQuickAccess).toBe(true);
      expect(courseraItem?.spaceName).toBe('Quick Access (Learning)');
      expect(courseraItem?.spaceId).toBe('space-learning');

      // Check DeepLearning.AI inside Learning subfolder
      const dlItem = indexed.find((b) => b.title === 'DeepLearning.AI');
      expect(dlItem).toBeDefined();
      expect(dlItem?.isQuickAccess).toBe(false);
      expect(dlItem?.spaceName).toBe('Learning');
      expect(dlItem?.spaceId).toBe('space-learning');

      // Check Home regular bookmark
      const homeBm = indexed.find((b) => b.title === 'Home Bookmark');
      expect(homeBm).toBeDefined();
      expect(homeBm?.isQuickAccess).toBe(false);
      expect(homeBm?.spaceName).toBe('Home');
      expect(homeBm?.spaceId).toBe('home');
    });
  });

  describe('Arc-style Tab to Search (Site Search Mode)', () => {
    it('matches site search engines by prefix and alias and computes ghost text', () => {
      const yt = findMatchingSiteEngine('you');
      expect(yt?.id).toBe('youtube');
      expect(getGhostAutocomplete('you', yt)).toBe('tube');

      const gh = findMatchingSiteEngine('gh');
      expect(gh?.id).toBe('github');
      expect(buildSiteSearchUrl(gh!, 'arctic sidebar')).toBe(
        'https://github.com/search?q=arctic%20sidebar'
      );

      // Multi-word queries or command queries do not trigger site match
      expect(findMatchingSiteEngine('you tube')).toBeNull();
      expect(findMatchingSiteEngine('>you')).toBeNull();
    });

    it('suggests YouTube on typing "you", activates site search pill on Tab, and searches YouTube on Enter', async () => {
      vi.mocked(chrome.tabs.update).mockClear();
      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i) as HTMLInputElement;

      // 1. Type "you"
      await act(async () => {
        fireEvent.change(input, { target: { value: 'you' } });
      });

      // Verify ghost autocomplete ("tube") and Tab hint badge appear
      expect(screen.getByTestId('ghost-autocomplete')).toHaveTextContent('youtube');
      const tabHint = screen.getByTestId('tab-to-search-hint');
      expect(tabHint).toHaveTextContent('Search YouTube');

      // 2. Press Tab to enter YouTube Site Search Mode
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' });
      });

      // Input clears, active site pill appears, placeholder updates
      expect(input.value).toBe('');
      expect(screen.getByTestId('active-site-pill')).toHaveTextContent('Search YouTube');
      expect(input.placeholder).toBe('Search YouTube...');

      // 3. Type search query for YouTube and press Enter
      await act(async () => {
        fireEvent.change(input, { target: { value: 'veritasium' } });
      });

      expect(await screen.findByText('Search YouTube for "veritasium"')).toBeInTheDocument();

      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      });

      expect(chrome.tabs.update).toHaveBeenCalledWith(1, {
        url: 'https://www.youtube.com/results?search_query=veritasium',
        active: true
      });
    });

    it('exits site search mode when pressing Backspace on empty input', async () => {
      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i) as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: 'you' } });
      });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' });
      });

      expect(screen.getByTestId('active-site-pill')).toBeInTheDocument();

      // Press Backspace while query is empty
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Backspace', code: 'Backspace' });
      });

      expect(screen.queryByTestId('active-site-pill')).not.toBeInTheDocument();
      expect(input.placeholder).toMatch(/type > for commands/i);
    });

    it('dismisses the Tab-to-search suggestion pill and keeps "you" when pressing Escape before Tab', async () => {
      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i) as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: 'you' } });
      });

      expect(screen.getByTestId('tab-to-search-hint')).toBeInTheDocument();
      expect(screen.getByTestId('ghost-autocomplete')).toBeInTheDocument();

      // Press Escape to dismiss the suggestion pill without clearing "you"
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });
      });

      expect(screen.queryByTestId('tab-to-search-hint')).not.toBeInTheDocument();
      expect(screen.queryByTestId('ghost-autocomplete')).not.toBeInTheDocument();
      expect(input.value).toBe('you');
    });

    it('restores "you" and removes the site pill when pressing Escape right after pressing Tab', async () => {
      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i) as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: 'you' } });
      });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' });
      });

      expect(screen.getByTestId('active-site-pill')).toBeInTheDocument();
      expect(input.value).toBe('');

      // Press Escape immediately -> removes pill and restores "you"
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });
      });

      expect(screen.queryByTestId('active-site-pill')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tab-to-search-hint')).not.toBeInTheDocument();
      expect(input.value).toBe('you');
    });

    it('removes only the site pill and preserves entered text when pressing Escape in site search mode', async () => {
      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i) as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: 'you' } });
      });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' });
      });

      expect(screen.getByTestId('active-site-pill')).toBeInTheDocument();

      // Type text in YouTube search mode
      await act(async () => {
        fireEvent.change(input, { target: { value: 'lofi hip hop' } });
      });
      expect(input.value).toBe('lofi hip hop');

      // First Escape removes the site pill but keeps "lofi hip hop"
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });
      });

      expect(screen.queryByTestId('active-site-pill')).not.toBeInTheDocument();
      expect(input.value).toBe('lofi hip hop');
    });

    it('shows full URLs on second line and loads selected URL into input with cursor at end on ArrowDown + Tab', async () => {
      const otherNode = (await chrome.bookmarks.getSubTree('2'))[0];
      const arcticRoot = await chrome.bookmarks.create({
        parentId: otherNode.id,
        title: 'Arctic'
      });
      const homeFolder = await chrome.bookmarks.create({
        parentId: arcticRoot.id,
        title: 'Home'
      });
      await chrome.bookmarks.create({
        parentId: homeFolder.id,
        title: 'Deep Link Page',
        url: 'https://docs.example.com/guides/getting-started?tab=1'
      });

      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i) as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: 'deep link' } });
      });

      // Full URL is rendered on the second line
      const fullUrlText = await screen.findByText(
        'https://docs.example.com/guides/getting-started?tab=1'
      );
      expect(fullUrlText).toBeInTheDocument();

      // Navigate with ArrowDown / ArrowUp and verify the row Tab hint is shown
      await act(async () => {
        fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'ArrowUp', code: 'ArrowUp' });
      });

      const rowTabHint = screen.getByTestId('row-tab-to-edit-hint');
      expect(rowTabHint).toHaveTextContent('Tab ⇥');

      await act(async () => {
        fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' });
      });

      const expectedUrl = 'https://docs.example.com/guides/getting-started?tab=1';
      expect(input.value).toBe(expectedUrl);
      expect(input.selectionStart).toBe(expectedUrl.length);
      expect(input.selectionEnd).toBe(expectedUrl.length);
    });

    it('does not render redundant Arctic Command header title above the command bar', () => {
      render(<App />);
      expect(screen.queryByText('Arctic Command')).not.toBeInTheDocument();
    });

    it('debounces suggestion updates when debounceMs is configured', async () => {
      vi.useFakeTimers();
      try {
        render(<App debounceMs={120} />);
        const input = screen.getByPlaceholderText(/type > for commands/i) as HTMLInputElement;

        await act(async () => {
          fireEvent.change(input, { target: { value: '> sleep' } });
        });

        // Before 120ms debounce elapses, Action Commands are not yet shown
        expect(screen.queryByText('Sleep Inactive Background Tabs')).not.toBeInTheDocument();

        // Advance timers by 120ms
        await act(async () => {
          vi.advanceTimersByTime(125);
        });

        expect(screen.getByText('Sleep Inactive Background Tabs')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
