# 🧊 Arctic: Sidebar & Commands

<p align="center">
  <strong>Arc-inspired vertical tabs, spaces, audio controls, and lightning-fast command bar for Google Chrome.</strong>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/arctic-sidebar/jopfeopcjimbpofmnchbohkelodgfocd">
    <img src="https://img.shields.io/badge/Chrome_Web_Store-Available_Now-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Web Store" />
  </a>
  <a href="https://buymeacoffee.com/sumitsabhnani">
    <img src="https://img.shields.io/badge/Buy_Me_A_Coffee-Support_Project-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Buy Me A Coffee" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.8.2-blue.svg" alt="Version 1.8.2" />
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License MIT" />
  <img src="https://img.shields.io/badge/manifest-v3-orange.svg" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/tests-255%20passed-brightgreen.svg" alt="Tests" />
  <img src="https://img.shields.io/badge/privacy-100%25_local_%26_tracker--free-teal.svg" alt="Privacy" />
</p>

---

## 🚀 Quick Install

Install Arctic directly from the official **Chrome Web Store**:

👉 **[Add to Chrome (Free)](https://chromewebstore.google.com/detail/arctic-sidebar/jopfeopcjimbpofmnchbohkelodgfocd)**

---

## ✨ Features

### 📁 Spaces & Tab Organization
* **Dedicated Spaces:** Group tabs by project, context, or persona (e.g., *Work*, *Personal*, *Research*).
* **Instant Switching:** Cycle spaces seamlessly with a click or keyboard shortcut.
* **Pinned Favorites:** Keep daily essentials (Email, Calendar, Slack, Notion) in a compact Quick Access grid pinned at the top.

### ⚡ Arctic Command: Fast Keyboard-First Launcher & Actions
* **Clean New Tab (`Cmd+T`):** Minimalist, distraction-free floating command palette.
* **Auto-Focused on Open:** Press `Cmd+T` and start typing immediately without clicking into the page.
* **Action Commands (`>`):** Type `>` to reveal all built-in actions, or type keywords like `dark`, `theme`, `sleep`, `space`, `history`:
  * `> Switch to Light/Dark Mode`
  * `> Palette: Glacier Blue / Midnight Amethyst / Forest Sage / Warm Terracotta / Slate Grey`
  * `> Sleep Inactive Background Tabs` (Memory Saver)
  * `> Close Duplicate Tabs`
  * `> Reopen Last Closed Tab`
  * `> Switch Space: [Space Name]`
  * `> Open Chrome Bookmarks / History / Extensions / Downloads`
* **Instant Navigation & Google Suggestions:** Jump directly to URLs (e.g., `github.com` or `localhost:3000`), search your tabs and browsing history, see live Google suggestions with `Tab ⇥` to refine, or fall back to Google Search with Enter.

### ⏰ Tab Reminders & Alerts
* **Set Tab Reminders:** Never lose track of an article, pull request, or invoice. Schedule reminders on any tab with 1-click presets (*In 15m*, *In 1h*, *In 3h*, *Tomorrow 9 AM*) or a custom date & time picker.
* **Native Desktop Notifications:** Receive system notifications with one-click **Open Tab** and **Dismiss** actions when reminders are due.
* **Top Overdue Banner:** Overdue reminders automatically surface at the top of the sidebar with multi-line notes, hover tooltips, and click-to-alert dialogs.
* **Background Service Worker:** Powered by `chrome.alarms` with automatic startup reconciliation so you never miss a reminder even if Chrome was closed or asleep.

### 📝 Cross-Device Shared Scratchpad
* **Instant Quick Notes:** Fast, minimalist scratchpad drawer accessible directly from the bottom dock button (Sticky Note icon).
* **Cross-Device Sync:** Automatically chunks and syncs up to 28,000 characters across all your Chrome browsers using `chrome.storage.sync` with local offline fallback.
* **Live Sync Indicator:** Subtle visual indicator keeps you informed of live saving and cross-device sync status.

### 🔇 Audio Controls & Indicators
* **Visual Speaker Badges:** Instantly identify which tab is playing sound or background video.
* **1-Click Mute:** Mute noisy tabs immediately from the sidebar without opening or switching to them.

### 💤 Memory Saver & Tab Sleeping
* **Hibernate Inactive Tabs:** Put heavy background tabs to sleep to free up RAM and CPU cycles.
* **Sleeping Indicator:** Clear visual badges indicate hibernated tabs; click any sleeping tab to wake it up instantly.

### 🎨 Beautiful Handcrafted Themes
* **Light & Dark Mode:** Matches your operating system appearance or allows manual override.
* **Multiple Color Accents:** Choose from *Glacier Blue*, *Midnight Amethyst*, *Forest Sage*, *Warm Terracotta*, and *Pure Monochrome*.

### 🎯 Arc-Style Ergonomics & Hidden Gems
* **Favicon Click to Reset:** Deep in a website on a pinned tab? Clicking its favicon instantly resets the tab back to your original saved root URL (just like Arc!). Double-clicking reloads.
* **Double-Click to Rename:** Clean up 100-character cluttered web titles. Double-click any tab, folder, or space title to give it a clean, custom name.
* **Move Across Spaces:** Right-click any tab or folder and choose **Move to [Space]** to instantly send items between Work, Personal, and Project contexts.
* **Instant URL Replace:** Click any pinned favorite to bring its active tab into focus or navigate cleanly in place without opening endless duplicate tabs.

### 🔒 100% Private & Open Source
* **Zero Tracking:** No analytics, no telemetry, no remote servers, no cookies.
* **Zero Remote Code:** Fully compliant with Chrome Web Store Manifest V3 security requirements. All data stays strictly in local browser storage.

---

## 💡 Pro-Tips for the Best Experience

### 🍎 True Full-Height Sidebar on macOS
Chrome does not permit extensions to completely remove the top horizontal tab bar in standard windowed mode. However, you can achieve a 100% distraction-free vertical workspace like Arc with this simple shortcut:

1. In Chrome's top menu bar, go to **View** > deselect **Always Show Toolbar in Full Screen** (`Shift + Cmd + F`).
2. Press `Fn + F` (or `Control + Cmd + F`) to enter macOS Full Screen.
3. The top horizontal bar slides away completely, leaving an authentic, full-height vertical sidebar!

### ↔️ Left vs. Right Placement
Chrome allows you to position the native Side Panel on either side of your screen:
* Go to **Chrome Settings** > **Appearance** > **Side panel** > Choose **Show on the left** or **Show on the right**.

---

## 🛠️ Development & Building from Source

Arctic Sidebar is built with React 19, TypeScript, Tailwind CSS, and Vite.

### Prerequisites
* [Node.js](https://nodejs.org/) (v18.0 or higher)
* `npm`

### Setup

```bash
# Clone the repository
git clone https://github.com/sumitsabhnani/arctic-sidebar.git
cd arctic-sidebar

# Install dependencies
npm install

# Run automated test suite (239 tests)
npm test

# Build for production
npm run build

# Package extension zip for Chrome Web Store
npm run zip
```

### Loading in Chrome (Unpacked Developer Mode)

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** toggle in the top-right corner.
3. Click **Load unpacked**.
4. Select the `dist/` directory inside your cloned repository.
5. Click the Chrome Side Panel icon in your toolbar and select **Arctic Sidebar**!

---

## ☕ Support the Project

Arctic Sidebar is an independent, free, and open-source project. If it has made your daily browsing more productive or organized, consider supporting ongoing maintenance and new features:

* ☕ **[Buy Me a Coffee](https://buymeacoffee.com/sumitsabhnani)**
* ❤️ **[GitHub Sponsors](https://github.com/sponsors/sumitsabhnani)**

---

## 📜 Privacy & Security

Your privacy is paramount. Arctic Sidebar:
* Never transmits browsing data, URLs, or bookmarks over the internet.
* Operates strictly on local browser storage (`chrome.storage.local`).
* Does not load any third-party scripts or remote CDNs at runtime.

Read our full [Privacy Policy](PRIVACY_POLICY.md).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) with trademark protection for the Arctic Sidebar name and branding.
