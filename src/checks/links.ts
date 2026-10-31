import { isAbsolute, join } from 'node:path';
import type { DocFile, DocLink } from '../docs/model.js';
import type { Finding } from '../types.js';
import { makeTextMatcher } from '../util/glob.js';
import { resolveClaimedPath } from '../util/paths.js';
import { closest, hasScheme, splitTarget } from '../util/text.js';
import { checkUrls, isSkippedHost } from './external.js';
import type { Check } from './types.js';

const MARKDOWN_RE = /\.(md|markdown|mdx)$/i;
/** Fragments browsers and GitHub treat specially. */
const BUILTIN_FRAGMENTS = new Set(['', 'top']);

function hasAnchor(doc: DocFile, fragment: string): boolean {
  if (BUILTIN_FRAGMENTS.has(fragment) || doc.anchors.has(fragment)) return true;
  const lower = fragment.toLowerCase();
  for (const anchor of doc.anchors) if (anchor.toLowerCase() === lower) return true;
  return false;
}

export const linksCheck: Check = {
  id: 'links',
  title: 'Links',
  description: 'Heading anchors in relative links resolve; external URLs respond when --external is set.',
  async run({ project, config, docs, options }) {
    const ignore = makeTextMatcher(config.links.ignore);
    const findings: Finding[] = [];
    let checked = 0;
    const external = new Map<string, { doc: DocFile; link: DocLink }[]>();

    for (const doc of docs) {
      for (const link of doc.links) {
        const url = link.url.trim();
        if (!url || ignore(url)) continue;

        if (/^https?:\/\//i.test(url)) {
          if (isSkippedHost(url, config.links.skipHosts)) continue;
          const uses = external.get(url) ?? [];
          uses.push({ doc, link });
          external.set(url, uses);
          continue;
        }
        if (hasScheme(url)) continue;

        const { path, fragment } = splitTarget(url);
        if (fragment === null) continue;

        let target: DocFile | null = doc;
        let targetLabel = doc.path;
        if (path) {
          if (!MARKDOWN_RE.test(path)) continue;
          const rel = resolveClaimedPath(doc.dir, path);
          // A missing target file is reported by the paths check.
          if (!project.exists(rel).exists || project.isDirectory(rel)) continue;
          target = project.getDoc(rel);
          targetLabel = rel;
        }
        if (!target) continue;

        checked++;
        if (hasAnchor(target, fragment)) continue;
        const suggestion = closest(fragment, target.anchors);
        findings.push({
          check: 'links',
          severity: 'error',
          file: doc.path,
          line: link.line,
          column: link.column,
          claim: url,
          message: `Anchor "#${fragment}" not found in ${targetLabel}`,
          ...(suggestion ? { hint: `Did you mean "#${suggestion}"?` } : {}),
        });
      }
    }

    if ((options.external || config.links.external) && external.size > 0) {
      const cacheFile = config.links.cacheFile
        ? isAbsolute(config.links.cacheFile)
          ? config.links.cacheFile
          : join(project.root, config.links.cacheFile)
        : null;
      const results = await checkUrls([...external.keys()], config.links, cacheFile);
      for (const [url, uses] of external) {
        const result = results.get(url);
        for (const { doc, link } of uses) {
          checked++;
          if (!result || result.outcome === 'ok') continue;
          findings.push({
            check: 'links',
            severity: result.outcome === 'broken' ? 'error' : 'warning',
            file: doc.path,
            line: link.line,
            column: link.column,
            claim: url,
            message:
              result.outcome === 'broken'
                ? `External link is broken (${result.detail}): ${url}`
                : `External link could not be confirmed (${result.detail}): ${url}`,
          });
        }
      }
    }

    return { checked, findings };
  },
};
