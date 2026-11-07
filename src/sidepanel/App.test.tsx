import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { App } from './App';
import { mockChrome } from '../test/setup';

describe('Sidepanel App Integration', () => {
  it('renders sidepanel without Quick Access appearing as a folder in the active space tree, and displays spaces in the switcher', async () => {
    // Seed bookmarks with Arctic > Home > Quick Access (Gmail) and Sheets
    // and Arctic > Learning > Quick Access (Docs)
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
                      {
                        id: '11',
                        title: 'Quick Access',
                        children: [{ id: '111', title: 'Gmail', url: 'https://mail.google.com' }]
                      },
                      {
                        id: '13',
                        title: 'Sheets',
                        children: [{ id: '131', title: 'Spreadsheet', url: 'https://sheets.google.com' }]
                      }
                    ]
                  },
                  {
                    id: '20',
                    title: 'Learning',
                    children: [
                      {
                        id: '21',
                        title: 'Quick Access',
                        children: [{ id: '211', title: 'Coursera', url: 'https://coursera.org' }]
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
    mockChrome.__setLocalStorage({});
    mockChrome.__setSyncStorage({});

    render(<App />);

    // Wait for bookmarks & spaces to load into DOM
    expect(await screen.findByText('Gmail')).toBeInTheDocument();
    expect(await screen.findByText('Sheets')).toBeInTheDocument();

    // 3. "Quick Access" must NOT be rendered as a regular folder node in the vertical tree
    const allQuickAccessElements = screen.queryAllByText('Quick Access');
    expect(allQuickAccessElements.length).toBe(0);

    // 4. The spaces switcher at the bottom should show both Home and Learning
    expect(await screen.findByTitle(/^Home Space/i)).toBeInTheDocument();
    expect(await screen.findByTitle(/^Learning Space/i)).toBeInTheDocument();
    expect(screen.getAllByText('Home').length).toBeGreaterThanOrEqual(2); // Header title + space dock button
  });

  it('switches space when clicking on another space in the switcher and updates Quick Access and bookmarks', async () => {
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
                      {
                        id: '11',
                        title: 'Quick Access',
                        children: [{ id: '111', title: 'Gmail', url: 'https://mail.google.com' }]
                      }
                    ]
                  },
                  {
                    id: '20',
                    title: 'Learning',
                    children: [
                      {
                        id: '21',
                        title: 'Quick Access',
                        children: [{ id: '211', title: 'Coursera', url: 'https://coursera.org' }]
                      },
                      {
                        id: '22',
                        title: 'React Docs',
                        url: 'https://react.dev'
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
    mockChrome.__setLocalStorage({});
    mockChrome.__setSyncStorage({});

    const { fireEvent } = await import('@testing-library/react');
    render(<App />);

    // Wait for initial load
    expect(await screen.findByText('Gmail')).toBeInTheDocument();
    expect(screen.queryByText('Coursera')).not.toBeInTheDocument();

    // Click on "Learning" space in switcher
    const learningSpaceBtn = await screen.findByTitle(/^Learning Space/i);
    await act(async () => {
      fireEvent.click(learningSpaceBtn);
    });

    // Now in Learning space: Coursera is in Quick Access, React Docs is in tree
    expect(await screen.findByText('Coursera')).toBeInTheDocument();
    expect(await screen.findByText('React Docs')).toBeInTheDocument();
    expect(screen.queryByText('Gmail')).not.toBeInTheDocument();

    // Quick Access should still NOT appear as a folder in the vertical tree
    expect(screen.queryAllByText('Quick Access').length).toBe(0);
  });

  it('automatically opens SettingsModal when openArcticSettings is triggered from Command Bar', async () => {
    mockChrome.__setLocalStorage({ openArcticSettings: Date.now() });
    mockChrome.__setSyncStorage({});

    render(<App />);

    expect(await screen.findByText('Settings & Appearance')).toBeInTheDocument();
    // Flag is cleared after opening
    expect(mockChrome.__getLocalStorage().openArcticSettings).toBeUndefined();
  });
});
