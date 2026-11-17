// @chrome-workaround(newtab-omnibox-focus): Chrome's chrome_url_overrides.newtab forces focus into the address bar; spawn command.html to focus the page search input directly.
if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.getCurrent) {
  chrome.tabs.getCurrent((currentTab) => {
    if (currentTab && currentTab.active === false) {
      if (typeof currentTab.id === 'number') {
        chrome.tabs.remove(currentTab.id, () => {
          void chrome.runtime.lastError;
        });
      } else {
        window.close();
      }
      return;
    }

    chrome.tabs.create(
      {
        url: chrome.runtime.getURL('command.html'),
        active: true,
        index: currentTab ? currentTab.index : undefined
      },
      () => {
        if (currentTab && typeof currentTab.id === 'number') {
          chrome.tabs.remove(currentTab.id, () => {
            void chrome.runtime.lastError;
          });
        } else {
          window.close();
        }
      }
    );
  });
} else {
  window.location.replace('command.html');
}
