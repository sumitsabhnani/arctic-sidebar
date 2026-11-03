if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.getCurrent) {
  chrome.tabs.getCurrent((currentTab) => {
    chrome.tabs.create(
      {
        url: chrome.runtime.getURL('command.html'),
        active: true,
        index: currentTab ? currentTab.index : undefined
      },
      () => {
        if (currentTab && typeof currentTab.id === 'number') {
          chrome.tabs.remove(currentTab.id);
        } else {
          window.close();
        }
      }
    );
  });
} else {
  window.location.replace('command.html');
}
