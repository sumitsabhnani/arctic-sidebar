import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { isLikelyUrl, formatNavigationUrl, App } from './App';

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
      expect(screen.getByText('Space Bookmark')).toBeInTheDocument();

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
  });
});
