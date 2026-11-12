import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { isLikelyUrl, formatNavigationUrl, getArcticBookmarks, App } from './App';
import { mockChrome } from '../test/setup';
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
      expect(screen.getByText(/Theme: Glacier Blue/i)).toBeInTheDocument();
      expect(screen.getByText(/Sleep Inactive Background Tabs/i)).toBeInTheDocument();
    });

    it('filters commands when typing after >', async () => {
      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: '> sleep' } });
      });

      expect(screen.getByText('Sleep Inactive Background Tabs')).toBeInTheDocument();
      expect(screen.queryByText(/Theme: Glacier Blue/i)).not.toBeInTheDocument();
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

      const crystalAquaCmd = screen.getByText('Theme: Crystal Aqua');
      const aquaLagoonCmd = screen.getByText('Theme: Aqua Lagoon');
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

    it('lists and filters all themes directly when typing "Theme:" in the command bar', async () => {
      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i);

      // Typing "Theme:" without leading ">" shows all 12 theme commands
      await act(async () => {
        fireEvent.change(input, { target: { value: 'Theme:' } });
      });

      expect(screen.getByText('Themes & Appearance')).toBeInTheDocument();
      expect(screen.getByText('12 available')).toBeInTheDocument();
      expect(screen.getByText('Theme: Pure Monochrome')).toBeInTheDocument();
      expect(screen.getByText('Theme: Glacier Blue')).toBeInTheDocument();
      expect(screen.getByText('Theme: Arctic Aurora')).toBeInTheDocument();

      // Filtering with "Theme: amethyst" narrows down to Midnight Amethyst
      await act(async () => {
        fireEvent.change(input, { target: { value: 'Theme: amethyst' } });
      });

      const midnightAmethystCmd = screen.getByText('Theme: Midnight Amethyst');
      expect(midnightAmethystCmd).toBeInTheDocument();
      expect(screen.queryByText('Theme: Glacier Blue')).not.toBeInTheDocument();

      await act(async () => {
        fireEvent.click(midnightAmethystCmd);
      });

      const local = await chrome.storage.local.get(['colorTheme']);
      expect(local.colorTheme).toBe('midnight-amethyst');
      expect(document.documentElement.getAttribute('data-color-theme')).toBe('midnight-amethyst');
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

  describe('Google Autocomplete Suggestions', () => {
    it('fetches and shows Google suggestions when keyword is not in bookmarks or history', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => [
          'quantum computing',
          [
            'quantum computing',
            'quantum computing explained',
            'quantum computing stocks',
            'quantum computing news'
          ]
        ]
      } as unknown as Response);

      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i) as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: 'quantum computing' } });
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://suggestqueries.google.com/complete/search?client=firefox&q=quantum%20computing',
        expect.any(Object)
      );

      expect(await screen.findByText('Search Web for "quantum computing"')).toBeInTheDocument();
      expect(await screen.findByText('quantum computing explained')).toBeInTheDocument();
      expect(screen.getByText('quantum computing stocks')).toBeInTheDocument();
      expect(screen.getByText('quantum computing news')).toBeInTheDocument();
      expect(screen.getAllByText('Google Suggestion')).toHaveLength(3);
    });

    it('navigates to selected Google suggestion on ArrowDown + Enter and supports Tab to refine query', async () => {
      vi.mocked(chrome.tabs.update).mockClear();
      vi.mocked(chrome.search.query).mockClear();
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        json: async () => [
          'how to center',
          ['how to center a div', 'how to center text in css']
        ]
      } as unknown as Response);

      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i) as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: 'how to center' } });
      });

      expect(await screen.findByText('how to center a div')).toBeInTheDocument();

      // ArrowDown to select "how to center a div"
      await act(async () => {
        fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
      });

      // Press Tab to populate "how to center a div" into the input box
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' });
      });

      expect(input.value).toBe('how to center a div');

      // ArrowDown to select "how to center text in css" and press Enter to search
      await act(async () => {
        fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
      });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      });

      expect(chrome.search.query).toHaveBeenCalledWith({
        text: 'how to center text in css',
        disposition: 'CURRENT_TAB'
      });
      expect(chrome.tabs.update).toHaveBeenCalledWith(1, {
        url: 'https://www.google.com/search?q=how%20to%20center%20text%20in%20css',
        active: true
      });
    });

    it('executes web search immediately with Shift+Enter even when a bookmark or history item is selected first', async () => {
      vi.mocked(chrome.search.query).mockClear();
      vi.mocked(chrome.tabs.update).mockClear();

      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i) as HTMLInputElement;

      // "github" matches the local history item "GitHub: Let’s build from here" at index 0
      await act(async () => {
        fireEvent.change(input, { target: { value: 'github' } });
      });

      expect(await screen.findByText(/GitHub: Let’s build from here/i)).toBeInTheDocument();
      expect(screen.getByText('Search Web for "github"')).toBeInTheDocument();
      expect(screen.getByTestId('shift-enter-search-hint')).toHaveTextContent('⇧ ↵');

      // Press Shift+Enter directly without navigating down to the search row
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true });
      });

      expect(chrome.search.query).toHaveBeenCalledWith({
        text: 'github',
        disposition: 'CURRENT_TAB'
      });
    });

    it('does not fetch Google suggestions when keyword already matches local history or bookmarks', async () => {
      vi.mocked(globalThis.fetch).mockClear();

      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i) as HTMLInputElement;

      // "github" matches default mockChrome history item
      await act(async () => {
        fireEvent.change(input, { target: { value: 'github' } });
      });

      expect(await screen.findByText(/GitHub: Let’s build from here/i)).toBeInTheDocument();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('keeps command bar anchored at top (justify-start) and preserves previous Google suggestions while typing new letters to prevent layout flicker', async () => {
      let resolveSecondFetch: ((val: Response) => void) | null = null;
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            'quantum',
            ['quantum physics', 'quantum mechanics']
          ]
        } as unknown as Response)
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              resolveSecondFetch = resolve;
            })
        );

      const { container } = render(<App />);
      const rootWrapper = container.firstElementChild as HTMLElement;
      expect(rootWrapper.className).toContain('justify-start');
      expect(rootWrapper.className).not.toContain('justify-center');

      const input = screen.getByPlaceholderText(/type > for commands/i) as HTMLInputElement;

      // Type first query
      await act(async () => {
        fireEvent.change(input, { target: { value: 'quantum' } });
      });

      expect(await screen.findByText('quantum physics')).toBeInTheDocument();
      expect(screen.getByText('quantum mechanics')).toBeInTheDocument();

      // Type next character while second network fetch is still pending
      await act(async () => {
        fireEvent.change(input, { target: { value: 'quantum c' } });
      });

      // Primary search item updates immediately AND previous Google suggestions stay visible (no collapse to 1 item)
      expect(screen.getByText('Search Web for "quantum c"')).toBeInTheDocument();
      expect(screen.getByText('quantum physics')).toBeInTheDocument();
      expect(screen.getByText('quantum mechanics')).toBeInTheDocument();

      // Resolve second fetch and verify suggestions update smoothly in place
      await act(async () => {
        resolveSecondFetch?.({
          ok: true,
          json: async () => [
            'quantum c',
            ['quantum computing', 'quantum computer']
          ]
        } as unknown as Response);
      });

      expect(await screen.findByText('quantum computing')).toBeInTheDocument();
      expect(screen.getByText('quantum computer')).toBeInTheDocument();
    });

    it('excludes Scratchpad Backup bookmarks from getArcticBookmarks and Command Bar search suggestions', async () => {
      mockChrome.__setBookmarksTree([
        {
          id: '0',
          title: 'Root',
          children: [
            {
              id: '2',
              title: 'Other Bookmarks',
              children: [
                {
                  id: '10',
                  title: 'Arctic',
                  children: [
                    {
                      id: 'bm-scratch',
                      title: 'Scratchpad Backup',
                      url: 'https://arctic.local/scratchpad#secret_scratchpad_keyword'
                    },
                    {
                      id: '12',
                      title: 'Home',
                      children: [
                        {
                          id: 'b1',
                          title: 'Secret Project Docs',
                          url: 'https://docs.example.com/secret'
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]);

      const arcticItems = await getArcticBookmarks();
      expect(arcticItems.some((item) => item.title === 'Scratchpad Backup')).toBe(false);
      expect(arcticItems.some((item) => item.title === 'Secret Project Docs')).toBe(true);

      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i) as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: 'secret' } });
      });

      expect(await screen.findByText('Secret Project Docs')).toBeInTheDocument();
      expect(screen.queryByText('Scratchpad Backup')).not.toBeInTheDocument();
    });
  });

  describe('Sleeping tabs, canonical redirects, and duplicate prevention in Command Bar', () => {
    it('wakes and binds an unbound sleeping canonical-redirected tab (pendingUrl) and persists binding to local storage', async () => {
      mockChrome.__setBookmarksTree([
        {
          id: '0',
          title: 'Root',
          children: [
            {
              id: '2',
              title: 'Other Bookmarks',
              children: [
                {
                  id: '10',
                  title: 'Arctic',
                  children: [
                    {
                      id: '12',
                      title: 'Home',
                      children: [
                        { id: 'bm-gmail', title: 'Gmail Inbox', url: 'https://gmail.com' }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]);

      // Tab 1 is the active Arctic Command launcher; Tab 2 is a sleeping Gmail tab with pendingUrl
      mockChrome.__setTabs([
        {
          id: 1,
          windowId: 10,
          url: 'chrome-extension://mock-extension-id/command.html',
          title: 'Arctic Command',
          active: true
        } as chrome.tabs.Tab,
        {
          id: 2,
          windowId: 10,
          url: '',
          pendingUrl: 'https://mail.google.com/mail/u/0/#inbox',
          title: 'Inbox - Gmail',
          discarded: true,
          active: false
        } as chrome.tabs.Tab
      ]);
      mockChrome.__setSessionStorage({});
      mockChrome.__setLocalStorage({});

      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Gmail Inbox' } });
      });

      const bmItem = await screen.findByText('Gmail Inbox');
      await act(async () => {
        fireEvent.click(bmItem);
      });

      // Sleeping tab 2 was woken/focused and bound to bm-gmail; launcher tab 1 was closed
      expect(chrome.tabs.update).toHaveBeenCalledWith(2, { active: true });
      expect(chrome.tabs.remove).toHaveBeenCalledWith(1);

      const session = mockChrome.__getSessionStorage();
      expect((session.bookmarkIdByTabId as Record<number, string>)[2]).toBe('bm-gmail');
      expect(
        (mockChrome.__getLocalStorage().persistedBindingsByBookmarkId as Record<string, any>)?.[
          'bm-gmail'
        ]?.currentUrl
      ).toBe('https://mail.google.com/mail/u/0/#inbox');
    });

    it('does not steal a tab already bound to a different Arctic bookmark when opening a second bookmark with the same URL', async () => {
      mockChrome.__setBookmarksTree([
        {
          id: '0',
          title: 'Root',
          children: [
            {
              id: '2',
              title: 'Other Bookmarks',
              children: [
                {
                  id: '10',
                  title: 'Arctic',
                  children: [
                    {
                      id: '12',
                      title: 'Home',
                      children: [
                        { id: 'bm-gh-1', title: 'GitHub Primary', url: 'https://github.com' },
                        { id: 'bm-gh-2', title: 'GitHub Secondary', url: 'https://github.com' }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]);

      // Tab 1 is Command Bar launcher; Tab 2 is ALREADY bound to bm-gh-1
      mockChrome.__setTabs([
        {
          id: 1,
          windowId: 10,
          url: 'chrome-extension://mock-extension-id/command.html',
          title: 'Arctic Command',
          active: true
        } as chrome.tabs.Tab,
        {
          id: 2,
          windowId: 10,
          url: 'https://github.com',
          title: 'GitHub',
          active: false
        } as chrome.tabs.Tab
      ]);
      mockChrome.__setSessionStorage({
        bindingsByBookmarkId: {
          'bm-gh-1': {
            bookmarkId: 'bm-gh-1',
            tabId: 2,
            windowId: 10,
            originalUrl: 'https://github.com',
            currentUrl: 'https://github.com',
            currentTitle: 'GitHub',
            isNavigatedAway: false
          }
        },
        bookmarkIdByTabId: { 2: 'bm-gh-1' }
      });

      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: 'GitHub Secondary' } });
      });

      const secondItem = await screen.findByText('GitHub Secondary');
      await act(async () => {
        fireEvent.click(secondItem);
      });

      // Must NOT steal tab 2 from bm-gh-1; instead opens in current launcher tab 1 and binds tab 1 -> bm-gh-2
      const session = mockChrome.__getSessionStorage();
      expect((session.bookmarkIdByTabId as Record<number, string>)[2]).toBe('bm-gh-1');
      expect((session.bookmarkIdByTabId as Record<number, string>)[1]).toBe('bm-gh-2');
      expect(chrome.tabs.update).toHaveBeenCalledWith(1, {
        url: 'https://github.com',
        active: true
      });
    });

    it('prunes stale dead binding in Case A and re-binds an existing matching tab cleanly', async () => {
      mockChrome.__setBookmarksTree([
        {
          id: '0',
          title: 'Root',
          children: [
            {
              id: '2',
              title: 'Other Bookmarks',
              children: [
                {
                  id: '10',
                  title: 'Arctic',
                  children: [
                    {
                      id: '12',
                      title: 'Home',
                      children: [
                        { id: 'bm-linear', title: 'Linear App', url: 'https://linear.app' }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]);

      // Session claims bm-linear is bound to dead tab 999, while tab 3 is an unbound Linear tab
      mockChrome.__setTabs([
        {
          id: 1,
          windowId: 10,
          url: 'chrome-extension://mock-extension-id/command.html',
          title: 'Arctic Command',
          active: true
        } as chrome.tabs.Tab,
        {
          id: 3,
          windowId: 10,
          url: 'https://linear.app',
          title: 'Linear',
          active: false
        } as chrome.tabs.Tab
      ]);
      mockChrome.__setSessionStorage({
        bindingsByBookmarkId: {
          'bm-linear': {
            bookmarkId: 'bm-linear',
            tabId: 999,
            windowId: 10,
            originalUrl: 'https://linear.app',
            currentUrl: 'https://linear.app',
            currentTitle: 'Linear',
            isNavigatedAway: false
          }
        },
        bookmarkIdByTabId: { 999: 'bm-linear' }
      });

      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Linear App' } });
      });

      const linearItem = await screen.findByText('Linear App');
      await act(async () => {
        fireEvent.click(linearItem);
      });

      const session = mockChrome.__getSessionStorage();
      // Dead tab 999 entry was pruned, and live tab 3 is now bound to bm-linear
      expect((session.bookmarkIdByTabId as Record<number, string>)[999]).toBeUndefined();
      expect((session.bookmarkIdByTabId as Record<number, string>)[3]).toBe('bm-linear');
      expect(chrome.tabs.update).toHaveBeenCalledWith(3, { active: true });
    });

    it('Close Duplicate Tabs command detects and closes sleeping duplicate tabs using pendingUrl', async () => {
      mockChrome.__setTabs([
        {
          id: 1,
          windowId: 10,
          url: 'chrome-extension://mock-extension-id/command.html',
          title: 'Arctic Command',
          active: true
        } as chrome.tabs.Tab,
        {
          id: 2,
          windowId: 10,
          url: 'https://docs.example.com/guide/',
          title: 'Guide',
          active: false
        } as chrome.tabs.Tab,
        {
          id: 3,
          windowId: 10,
          url: '',
          pendingUrl: 'https://docs.example.com/guide#intro',
          title: 'Guide (Sleeping)',
          discarded: true,
          active: false
        } as chrome.tabs.Tab
      ]);

      render(<App />);
      const input = screen.getByPlaceholderText(/type > for commands/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: '> close duplicate' } });
      });

      const cmdItem = await screen.findByText('Close Duplicate Tabs');
      await act(async () => {
        fireEvent.click(cmdItem);
      });

      // Sleeping duplicate tab 3 was detected via pendingUrl and removed
      expect(chrome.tabs.remove).toHaveBeenCalledWith(3);
      expect(await screen.findByText('Closed 1 duplicate tab')).toBeInTheDocument();
    });
  });
});
