#!/usr/bin/env node
/**
 * Arctic Sidebar — Chrome Extension API Capability & Workaround Monitor
 *
 * How it works:
 * 1. Scans the repository for all `@chrome-workaround(<id>)` annotations so every
 *    Chrome-version workaround is indexed by exact file and line number.
 * 2. Parses `@types/chrome` declarations (either local `node_modules/@types/chrome`
 *    or latest upstream npm `@types/chrome` when `--remote` is passed) across the
 *    namespaces Arctic cares about (`sidePanel`, `tabs`, `windows`, `commands`, `runtime`).
 * 3. Compares the extracted functions, events, types, and option properties against
 *    `scripts/chrome-api-baseline.json`.
 * 4. Evaluates any newly added Chrome APIs against Arctic's Watch Rules so you get
 *    an actionable alert telling you WHICH `@chrome-workaround` can now be upgraded
 *    and WHICH files/lines to touch.
 *
 * Usage:
 *   node scripts/checkChromeApis.mjs                  # Compare local @types/chrome vs baseline + audit tags
 *   node scripts/checkChromeApis.mjs --remote         # Compare latest npm @types/chrome vs baseline
 *   node scripts/checkChromeApis.mjs --update         # Update scripts/chrome-api-baseline.json from local @types/chrome
 *   node scripts/checkChromeApis.mjs --remote --markdown-report report.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(path.dirname(__filename));

const BASELINE_PATH = path.join(__dirname, 'scripts', 'chrome-api-baseline.json');
const LOCAL_TYPES_PKG_PATH = path.join(
  __dirname,
  'node_modules',
  '@types',
  'chrome',
  'package.json'
);
const LOCAL_TYPES_DTS_PATH = path.join(
  __dirname,
  'node_modules',
  '@types',
  'chrome',
  'index.d.ts'
);

const WATCHED_NAMESPACES = ['sidePanel', 'tabs', 'windows', 'commands', 'runtime'];

const WATCHED_INTERFACES_BY_NAMESPACE = {
  sidePanel: ['GetPanelOptions', 'OpenOptions', 'PanelBehavior', 'PanelOptions', 'SidePanel'],
  tabs: ['Tab', 'CreateProperties', 'UpdateProperties', 'QueryInfo', 'HighlightInfo'],
  windows: ['Window', 'CreateData', 'UpdateInfo'],
  commands: ['Command'],
  runtime: ['ContextFilter', 'ExtensionContext', 'ManifestV3']
};

/**
 * Watch Rules mapping specific Chrome API symbol patterns to Arctic's @chrome-workaround IDs.
 */
export const WATCH_RULES = [
  {
    id: 'sidepanel-close-and-visibility',
    title: 'Programmatic Side Panel Close & Lifecycle Events (onOpened / onClosed)',
    namespaces: ['sidePanel'],
    symbolPatterns: [
      /^close$/i,
      /^CloseOptions$/i,
      /^onClosed$/i,
      /^onOpened$/i,
      /^onVisibilityChanged$/i,
      /^isOpen$/i
    ],
    upgradeRecommendation:
      'Use native `chrome.sidePanel.close()` and/or `onOpened`/`onClosed` events instead of `window.close()` and custom port/session guard timers.'
  },
  {
    id: 'sidepanel-dock-layout',
    title: 'Side Panel Left/Right Dock Layout Inspection & Control',
    namespaces: ['sidePanel'],
    symbolPatterns: [
      /^getLayout$/i,
      /^setLayout$/i,
      /^onLayoutChanged$/i,
      /^Layout$/i,
      /^PanelLayout$/i,
      /\bside\b/i
    ],
    upgradeRecommendation:
      'Remove the `getLayout` type cast in `syncSidePanelLayoutSide()`, and if `setLayout` is available, replace the `chrome://settings/appearance` redirect in `SettingsModal.tsx` with an in-app Left/Right toggle.'
  },
  {
    id: 'sidepanel-min-width-and-resize',
    title: 'Side Panel Width / Minimum Width / Collapsed Rail Sizing',
    namespaces: ['sidePanel'],
    symbolPatterns: [
      /width/i,
      /minWidth/i,
      /maxWidth/i,
      /size/i,
      /resize/i,
      /collapse/i,
      /rail/i
    ],
    upgradeRecommendation:
      'Evaluate collapsing or resizing the native Side Panel to 36px instead of injecting the Shadow DOM rail (`edgeTrigger.ts`) and 36px CSS page-push engine.'
  },
  {
    id: 'sidepanel-open-user-gesture',
    title: 'Side Panel Open on Hover / Programmatic Open Behavior',
    namespaces: ['sidePanel'],
    symbolPatterns: [/hover/i, /openPanelOn/i, /gesture/i],
    upgradeRecommendation:
      'Check if `chrome.sidePanel.open()` or `PanelBehavior` now supports hover-triggered expansion without requiring a click user gesture.'
  },
  {
    id: 'newtab-omnibox-focus',
    title: 'New Tab Page Focus Control & Extension URL Masking in Address Bar',
    namespaces: ['tabs', 'runtime'],
    symbolPatterns: [
      /focusPage/i,
      /autoFocus/i,
      /stealFocus/i,
      /omniboxFocus/i,
      /hideUrl/i,
      /displayUrl/i,
      /maskedUrl/i
    ],
    upgradeRecommendation:
      'Render `command.html` directly inside `newtab.html` without the `public/focus.js` redirect stub or `chrome-extension://` address bar URL.'
  },
  {
    id: 'tab-page-focus-and-media-keys',
    title: 'Transferring OS/WebContents Focus to Active Tab on Tab Switch',
    namespaces: ['tabs', 'sidePanel', 'windows'],
    symbolPatterns: [/focusPage/i, /focusWebContents/i, /focusContent/i, /relinquishFocus/i, /^blur$/i],
    upgradeRecommendation:
      'Use native tab/page focus transfer when switching tabs from the Side Panel instead of `chrome.scripting.executeScript` key forwarding in `tabPageFocus.ts`.'
  },
  {
    id: 'content-script-favicon-isolation',
    title: 'Native Favicon API for Extension & Content Script Contexts',
    namespaces: ['runtime', 'tabs'],
    symbolPatterns: [/favicon/i],
    upgradeRecommendation:
      'Evaluate whether content scripts can access favicons natively without base64 data URL caching in `faviconCache.ts`.'
  },
  {
    id: 'split-tabs-and-chrome-ui',
    title: 'Native Split Tabs (Split View) & Top Tab Strip / Address Bar Visibility',
    namespaces: ['tabs', 'windows', 'sidePanel'],
    symbolPatterns: [
      /split/i,
      /tile/i,
      /tabStrip/i,
      /hideTab/i,
      /addressBar/i,
      /toolbarVisible/i,
      /verticalTab/i
    ],
    upgradeRecommendation:
      'Roadmap opportunity: integrate native Chrome Split View tab controls or native horizontal tab strip hiding into Arctic Sidebar.'
  }
];

/**
 * Extracts functions, events/variables, types/interfaces, and watched interface properties
 * for each watched namespace from a `@types/chrome` declaration string.
 */
export function parseChromeTypesDts(dtsContent) {
  const result = {};

  for (const ns of WATCHED_NAMESPACES) {
    const block = extractNamespaceBlock(dtsContent, ns);
    if (!block) {
      result[ns] = {
        functions: [],
        eventsAndVars: [],
        typesAndInterfaces: [],
        interfaceProperties: {}
      };
      continue;
    }

    const functions = new Set();
    const eventsAndVars = new Set();
    const typesAndInterfaces = new Set();

    const fnRegex = /^\s*export\s+function\s+([A-Za-z0-9_]+)\s*[<(]/gm;
    let match;
    while ((match = fnRegex.exec(block)) !== null) {
      functions.add(match[1]);
    }

    const varRegex = /^\s*export\s+(?:const|var|let)\s+([A-Za-z0-9_]+)\s*:/gm;
    while ((match = varRegex.exec(block)) !== null) {
      eventsAndVars.add(match[1]);
    }

    const typeRegex = /^\s*export\s+(?:interface|type|enum)\s+([A-Za-z0-9_]+)\b/gm;
    while ((match = typeRegex.exec(block)) !== null) {
      typesAndInterfaces.add(match[1]);
    }

    const interfaceProperties = {};
    const watchedIfaces = WATCHED_INTERFACES_BY_NAMESPACE[ns] || [];
    for (const ifaceName of watchedIfaces) {
      const props = extractInterfaceOrTypeProperties(block, ifaceName);
      if (props.length > 0) {
        interfaceProperties[ifaceName] = props;
      }
    }

    result[ns] = {
      functions: Array.from(functions).sort(),
      eventsAndVars: Array.from(eventsAndVars).sort(),
      typesAndInterfaces: Array.from(typesAndInterfaces).sort(),
      interfaceProperties
    };
  }

  return result;
}

/**
 * Extracts the body of `export namespace <ns> { ... }` or `declare namespace chrome.<ns> { ... }`
 * using brace counting.
 */
function extractNamespaceBlock(dtsContent, namespaceName) {
  const patterns = [
    new RegExp(`^[ \\t]*export\\s+namespace\\s+${namespaceName}\\s*\\{`, 'm'),
    new RegExp(`^[ \\t]*declare\\s+namespace\\s+chrome\\.${namespaceName}\\s*\\{`, 'm')
  ];

  for (const regex of patterns) {
    const match = regex.exec(dtsContent);
    if (!match) continue;
    const startIdx = match.index + match[0].length;
    return sliceBalancedBraces(dtsContent, startIdx);
  }
  return null;
}

/**
 * Extracts property names from an `export interface <Name> { ... }` or `export type <Name> = ...` block.
 */
function extractInterfaceOrTypeProperties(nsBlock, typeName) {
  const props = new Set();
  const ifaceRegex = new RegExp(
    `^[ \\t]*export\\s+(?:interface|type)\\s+${typeName}\\b[^;{]*\\{`,
    'gm'
  );
  let match;
  while ((match = ifaceRegex.exec(nsBlock)) !== null) {
    const startIdx = match.index + match[0].length;
    const body = sliceBalancedBraces(nsBlock, startIdx);
    if (!body) continue;

    // Strip block comments and line comments before scanning property identifiers
    const cleaned = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    const propRegex = /^\s*readonly\s+([A-Za-z0-9_]+)\??\s*:|^\s*([A-Za-z0-9_]+)\??\s*:/gm;
    let pMatch;
    while ((pMatch = propRegex.exec(cleaned)) !== null) {
      const propName = pMatch[1] || pMatch[2];
      if (propName) props.add(propName);
    }
  }
  return Array.from(props).sort();
}

function sliceBalancedBraces(text, startAfterOpenBrace) {
  let depth = 1;
  let i = startAfterOpenBrace;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return depth === 0 ? text.slice(startAfterOpenBrace, i - 1) : null;
}

/**
 * Scans the codebase for `@chrome-workaround(<id>): <description>` comments.
 */
export function scanCodebaseWorkaroundTags(rootDir = __dirname) {
  const searchTargets = ['src', 'public', 'newtab.html'];
  const findings = [];

  const walk = (entryPath) => {
    if (!fs.existsSync(entryPath)) return;
    const stat = fs.statSync(entryPath);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(entryPath)) {
        walk(path.join(entryPath, child));
      }
      return;
    }
    if (!/\.(ts|tsx|js|html)$/.test(entryPath) || /\.test\.(ts|tsx)$/.test(entryPath)) {
      return;
    }

    const relPath = path.relative(rootDir, entryPath).replace(/\\/g, '/');
    const lines = fs.readFileSync(entryPath, 'utf8').split('\n');
    const tagRegex = /@chrome-workaround\(([a-z0-9-]+)\)(?::\s*(.*?))?(?:\s*-->|\s*\*\/)?$/i;

    lines.forEach((line, idx) => {
      const m = tagRegex.exec(line);
      if (m) {
        findings.push({
          id: m[1],
          description: (m[2] || '').trim(),
          file: relPath,
          line: idx + 1
        });
      }
    });
  };

  for (const target of searchTargets) {
    walk(path.join(rootDir, target));
  }

  return findings;
}

/**
 * Compares baseline snapshot against target snapshot and returns all added symbols.
 */
export function diffChromeApiSnapshots(baselineNamespaces, currentNamespaces) {
  const diffByNamespace = {};
  let totalAddedCount = 0;

  for (const ns of WATCHED_NAMESPACES) {
    const baseNs = baselineNamespaces[ns] || {
      functions: [],
      eventsAndVars: [],
      typesAndInterfaces: [],
      interfaceProperties: {}
    };
    const currNs = currentNamespaces[ns] || {
      functions: [],
      eventsAndVars: [],
      typesAndInterfaces: [],
      interfaceProperties: {}
    };

    const addedFunctions = currNs.functions.filter((f) => !baseNs.functions.includes(f));
    const addedEventsAndVars = currNs.eventsAndVars.filter(
      (v) => !baseNs.eventsAndVars.includes(v)
    );
    const addedTypesAndInterfaces = currNs.typesAndInterfaces.filter(
      (t) => !baseNs.typesAndInterfaces.includes(t)
    );

    const addedInterfaceProperties = {};
    for (const [iface, props] of Object.entries(currNs.interfaceProperties || {})) {
      const baseProps = baseNs.interfaceProperties?.[iface] || [];
      const newProps = props.filter((p) => !baseProps.includes(p));
      if (newProps.length > 0) {
        addedInterfaceProperties[iface] = newProps;
      }
    }

    const nsCount =
      addedFunctions.length +
      addedEventsAndVars.length +
      addedTypesAndInterfaces.length +
      Object.values(addedInterfaceProperties).reduce((acc, arr) => acc + arr.length, 0);

    if (nsCount > 0) {
      totalAddedCount += nsCount;
      diffByNamespace[ns] = {
        addedFunctions,
        addedEventsAndVars,
        addedTypesAndInterfaces,
        addedInterfaceProperties
      };
    }
  }

  return { totalAddedCount, diffByNamespace };
}

/**
 * Matches newly added symbols against Arctic's Watch Rules.
 */
export function evaluateWatchRules(diffByNamespace, workaroundTags) {
  const matchedRules = [];

  for (const rule of WATCH_RULES) {
    const matchedSymbols = [];

    for (const ns of rule.namespaces) {
      const nsDiff = diffByNamespace[ns];
      if (!nsDiff) continue;

      const candidates = [
        ...nsDiff.addedFunctions.map((name) => ({ label: `chrome.${ns}.${name}()`, raw: name })),
        ...nsDiff.addedEventsAndVars.map((name) => ({ label: `chrome.${ns}.${name}`, raw: name })),
        ...nsDiff.addedTypesAndInterfaces.map((name) => ({
          label: `chrome.${ns}.${name}`,
          raw: name
        })),
        ...Object.entries(nsDiff.addedInterfaceProperties).flatMap(([iface, props]) =>
          props.map((prop) => ({
            label: `chrome.${ns}.${iface}.${prop}`,
            raw: prop
          }))
        )
      ];

      for (const c of candidates) {
        if (rule.symbolPatterns.some((re) => re.test(c.raw))) {
          matchedSymbols.push(c.label);
        }
      }
    }

    if (matchedSymbols.length > 0) {
      const locations = workaroundTags.filter((t) => t.id === rule.id);
      matchedRules.push({
        rule,
        matchedSymbols,
        locations
      });
    }
  }

  return matchedRules;
}

/**
 * Fetches the latest `@types/chrome` version and declaration content from npm/unpkg.
 * Resolves any `/// <reference path="..." />` sub-files if DefinitelyTyped splits `index.d.ts`.
 */
async function fetchRemoteChromeTypes() {
  const metaRes = await fetch('https://registry.npmjs.org/@types/chrome/latest');
  if (!metaRes.ok) {
    throw new Error(`Failed to fetch @types/chrome metadata from npm: HTTP ${metaRes.status}`);
  }
  const meta = await metaRes.json();
  const version = meta.version;

  const baseUrl = `https://unpkg.com/@types/chrome@${version}/`;
  const indexRes = await fetch(`${baseUrl}index.d.ts`);
  if (!indexRes.ok) {
    throw new Error(`Failed to fetch index.d.ts from unpkg: HTTP ${indexRes.status}`);
  }
  let combinedDts = await indexRes.text();

  const refRegex = /^\/\/\/\s*<reference\s+path=["']([^"']+)["']\s*\/>/gm;
  const subPaths = [];
  let match;
  while ((match = refRegex.exec(combinedDts)) !== null) {
    const refPath = match[1];
    if (!refPath.includes('chrome-cast') && !refPath.includes('har-format')) {
      subPaths.push(refPath);
    }
  }

  if (subPaths.length > 0) {
    const subContents = await Promise.all(
      subPaths.map(async (rel) => {
        const cleanRel = rel.replace(/^\.\//, '');
        const r = await fetch(`${baseUrl}${cleanRel}`);
        return r.ok ? r.text() : '';
      })
    );
    combinedDts += '\n' + subContents.join('\n');
  }

  return { version, dtsContent: combinedDts };
}

function generateMarkdownReport({
  sourceLabel,
  baselineVersion,
  targetVersion,
  diffResult,
  matchedRules,
  workaroundTags
}) {
  const lines = [];
  lines.push(`# Chrome Extension API Watch Report`);
  lines.push('');
  lines.push(`- **Baseline \`@types/chrome\` Version**: \`${baselineVersion}\``);
  lines.push(`- **Checked \`@types/chrome\` Version (${sourceLabel})**: \`${targetVersion}\``);
  lines.push(`- **New Symbols in Watched Namespaces**: **${diffResult.totalAddedCount}**`);
  lines.push(`- **Matched Workaround Upgrade Rules**: **${matchedRules.length}**`);
  lines.push('');

  if (matchedRules.length > 0) {
    lines.push(`## Actionable Workaround Upgrades Unlocked`);
    lines.push('');
    for (const item of matchedRules) {
      lines.push(`### \`@chrome-workaround(${item.rule.id})\` — ${item.rule.title}`);
      lines.push(`- **New Chrome APIs Detected**: ${item.matchedSymbols.map((s) => `\`${s}\``).join(', ')}`);
      lines.push(`- **Recommended Upgrade**: ${item.rule.upgradeRecommendation}`);
      if (item.locations.length > 0) {
        lines.push(`- **Codebase Touchpoints to Update**:`);
        for (const loc of item.locations) {
          lines.push(`  - \`${loc.file}:${loc.line}\` — ${loc.description}`);
        }
      } else {
        lines.push(`- **Documentation Reference**: See \`docs/CHROME_CAPABILITIES.md\``);
      }
      lines.push('');
    }
  }

  if (diffResult.totalAddedCount > 0) {
    lines.push(`## All Newly Added Symbols in Watched Namespaces`);
    lines.push('');
    for (const [ns, diff] of Object.entries(diffResult.diffByNamespace)) {
      lines.push(`### \`chrome.${ns}\``);
      if (diff.addedFunctions.length > 0) {
        lines.push(`- **New Functions**: ${diff.addedFunctions.map((f) => `\`${f}()\``).join(', ')}`);
      }
      if (diff.addedEventsAndVars.length > 0) {
        lines.push(`- **New Events / Properties**: ${diff.addedEventsAndVars.map((v) => `\`${v}\``).join(', ')}`);
      }
      if (diff.addedTypesAndInterfaces.length > 0) {
        lines.push(`- **New Types / Interfaces**: ${diff.addedTypesAndInterfaces.map((t) => `\`${t}\``).join(', ')}`);
      }
      for (const [iface, props] of Object.entries(diff.addedInterfaceProperties)) {
        lines.push(`- **New Properties on \`${iface}\`**: ${props.map((p) => `\`${p}\``).join(', ')}`);
      }
      lines.push('');
    }
  } else {
    lines.push(`No new functions, events, or option properties detected in watched namespaces (\`sidePanel\`, \`tabs\`, \`windows\`, \`commands\`, \`runtime\`).`);
    lines.push('');
  }

  lines.push(`## Indexed \`@chrome-workaround\` Touchpoints (${workaroundTags.length})`);
  lines.push('');
  for (const tag of workaroundTags) {
    lines.push(`- \`@chrome-workaround(${tag.id})\` at \`${tag.file}:${tag.line}\``);
  }
  lines.push('');

  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const isUpdate = args.includes('--update');
  const isRemote = args.includes('--remote');
  const reportIdx = args.indexOf('--markdown-report');
  const markdownReportPath = reportIdx !== -1 ? args[reportIdx + 1] : null;
  const jsonSummaryIdx = args.indexOf('--json-summary');
  const jsonSummaryPath = jsonSummaryIdx !== -1 ? args[jsonSummaryIdx + 1] : null;

  const localPkg = JSON.parse(fs.readFileSync(LOCAL_TYPES_PKG_PATH, 'utf8'));
  const localVersion = localPkg.version;
  const localDts = fs.readFileSync(LOCAL_TYPES_DTS_PATH, 'utf8');

  if (isUpdate || !fs.existsSync(BASELINE_PATH)) {
    const namespaces = parseChromeTypesDts(localDts);
    const baselineObj = {
      schemaVersion: 1,
      typesChromeVersion: localVersion,
      updatedAt: new Date().toISOString().split('T')[0],
      watchedNamespaces: namespaces
    };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(baselineObj, null, 2) + '\n', 'utf8');
    console.log(
      `[check:chrome-apis] Saved baseline snapshot for @types/chrome@${localVersion} to scripts/chrome-api-baseline.json`
    );
    if (isUpdate) return;
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const workaroundTags = scanCodebaseWorkaroundTags(__dirname);

  let targetVersion = localVersion;
  let targetDts = localDts;
  let sourceLabel = 'local node_modules';

  if (isRemote) {
    sourceLabel = 'npm registry latest';
    console.log(`[check:chrome-apis] Fetching latest @types/chrome from npm/unpkg...`);
    const remote = await fetchRemoteChromeTypes();
    targetVersion = remote.version;
    targetDts = remote.dtsContent;
  }

  const currentNamespaces = parseChromeTypesDts(targetDts);
  const diffResult = diffChromeApiSnapshots(baseline.watchedNamespaces, currentNamespaces);
  const matchedRules = evaluateWatchRules(diffResult.diffByNamespace, workaroundTags);

  console.log(`\n=== Arctic Chrome API & Workaround Monitor ===`);
  console.log(`Baseline @types/chrome : v${baseline.typesChromeVersion}`);
  console.log(`Checked @types/chrome  : v${targetVersion} (${sourceLabel})`);
  console.log(`Tracked code tags      : ${workaroundTags.length} @chrome-workaround annotations across repo`);

  // Verify every tag in codebase maps to a known Watch Rule
  const knownRuleIds = new Set(WATCH_RULES.map((r) => r.id));
  const unknownTags = workaroundTags.filter((t) => !knownRuleIds.has(t.id));
  if (unknownTags.length > 0) {
    console.warn(`\n[!] Found @chrome-workaround tag(s) with no matching rule in checkChromeApis.mjs:`);
    for (const u of unknownTags) {
      console.warn(`    - @chrome-workaround(${u.id}) at ${u.file}:${u.line}`);
    }
  }

  if (diffResult.totalAddedCount === 0) {
    console.log(`\n✓ No new symbols detected in watched Chrome namespaces (sidePanel, tabs, windows, commands, runtime).`);
  } else {
    console.log(
      `\n🚀 Detected ${diffResult.totalAddedCount} new symbol(s) in watched Chrome namespaces!`
    );
    for (const [ns, diff] of Object.entries(diffResult.diffByNamespace)) {
      console.log(`\n  Namespace: chrome.${ns}`);
      if (diff.addedFunctions.length > 0) {
        console.log(`    + Functions : ${diff.addedFunctions.join(', ')}`);
      }
      if (diff.addedEventsAndVars.length > 0) {
        console.log(`    + Events    : ${diff.addedEventsAndVars.join(', ')}`);
      }
      if (diff.addedTypesAndInterfaces.length > 0) {
        console.log(`    + Types     : ${diff.addedTypesAndInterfaces.join(', ')}`);
      }
      for (const [iface, props] of Object.entries(diff.addedInterfaceProperties)) {
        console.log(`    + ${iface} props : ${props.join(', ')}`);
      }
    }
  }

  if (matchedRules.length > 0) {
    console.log(`\n🎯 ACTIONABLE WORKAROUND UPGRADES UNLOCKED (${matchedRules.length}):`);
    for (const m of matchedRules) {
      console.log(`\n  [${m.rule.id}] ${m.rule.title}`);
      console.log(`    New APIs : ${m.matchedSymbols.join(', ')}`);
      console.log(`    Action   : ${m.rule.upgradeRecommendation}`);
      for (const loc of m.locations) {
        console.log(`    File     : ${loc.file}:${loc.line}`);
      }
    }
  }

  if (markdownReportPath) {
    const md = generateMarkdownReport({
      sourceLabel,
      baselineVersion: baseline.typesChromeVersion,
      targetVersion,
      diffResult,
      matchedRules,
      workaroundTags
    });
    fs.writeFileSync(markdownReportPath, md, 'utf8');
    console.log(`\nWrote Markdown report to ${markdownReportPath}`);
  }

  if (jsonSummaryPath) {
    fs.writeFileSync(
      jsonSummaryPath,
      JSON.stringify(
        {
          hasNewApis: diffResult.totalAddedCount > 0,
          totalAddedCount: diffResult.totalAddedCount,
          matchedRulesCount: matchedRules.length,
          baselineVersion: baseline.typesChromeVersion,
          targetVersion
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectRun) {
  main().catch((err) => {
    console.error('[check:chrome-apis] Error:', err);
    process.exit(1);
  });
}
