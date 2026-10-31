import type { DocFile } from '../docs/model.js';
import type { Finding } from '../types.js';
import { makeTextMatcher } from '../util/glob.js';
import { LineIndex } from '../util/text.js';
import { CODE_EXTENSIONS } from './env.js';
import { SkipCheck, type Check } from './types.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
type Method = (typeof METHODS)[number] | 'ANY';

export interface Route {
  method: Method;
  path: string;
  file: string;
  line: number;
}

export interface EndpointMention {
  method: Method;
  path: string;
  line: number;
  column?: number;
}

const DOC_ENDPOINT_RE = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[^\s`'"<>)\]]*)/g;

/**
 * Normalises a route or documented path so different parameter styles compare
 * equal: :id, {id}, <id>, <int:id>, [id] and [...slug] all become ":".
 */
export function normaliseRoute(path: string): string {
  let p = path.split(/[?#]/)[0] ?? '';
  p = p.replace(/[.,;:]+$/, '');
  const segments = p
    .split('/')
    .filter(Boolean)
    .map((s) => {
      if (/^:\w+\??$/.test(s) || /^\{[^}]+\}$/.test(s) || /^<[^>]+>$/.test(s) || /^\[{1,2}(\.\.\.)?[^\]]+\]{1,2}$/.test(s)) {
        return s.startsWith('[...') || s.startsWith('[[...') ? '*' : ':';
      }
      return s;
    });
  return `/${segments.join('/')}`;
}

function segmentsMatch(route: string[], documented: string[]): boolean {
  for (let i = 0; i < route.length; i++) {
    const r = route[i];
    if (r === '*') return documented.length >= i;
    const d = documented[i];
    if (d === undefined) return false;
    if (r === ':' || r === d) continue;
    return false;
  }
  return route.length === documented.length;
}

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** Finds endpoint claims such as "GET /api/users/:id" in a document. */
export function findEndpointMentions(doc: DocFile): EndpointMention[] {
  const out: EndpointMention[] = [];
  const scan = (text: string, line: number, column?: number) => {
    text.split('\n').forEach((value, i) => {
      for (const match of value.matchAll(DOC_ENDPOINT_RE)) {
        const method = match[1] as Method;
        const path = match[2] ?? '/';
        out.push({ method, path, line: line + i, ...(column !== undefined && i === 0 ? { column } : {}) });
      }
    });
  };
  for (const code of doc.inlineCode) scan(code.value, code.line, code.column);
  for (const text of doc.text) scan(text.value, text.line);
  for (const block of doc.codeBlocks) scan(block.value, block.contentLine);
  return out;
}

interface RoutePattern {
  re: RegExp;
  method: (m: RegExpMatchArray) => Method[];
  path: (m: RegExpMatchArray) => string | undefined;
}

const upper = (s: string | undefined): Method => {
  const m = (s ?? '').toUpperCase();
  return (METHODS as readonly string[]).includes(m) ? (m as Method) : 'ANY';
};

const ROUTE_PATTERNS: RoutePattern[] = [
  // Express, Koa, Fastify, Hono, Elysia, Gin, Echo, Flask 2, FastAPI: app.get('/x'), @router.post("/x"), r.GET("/x")
  {
    re: /\.(get|post|put|patch|delete|head|options|all)\(\s*['"`](\/[^'"`]*)['"`]/gi,
    method: (m) => [upper(m[1])],
    path: (m) => m[2],
  },
  // Flask: @app.route("/x", methods=["GET", "POST"])
  {
    re: /@\w+\.route\(\s*['"](\/[^'"]*)['"]([^)]*)\)/g,
    method: (m) => {
      const list = /methods\s*=\s*\[([^\]]*)\]/.exec(m[2] ?? '')?.[1];
      if (!list) return ['GET'];
      return [...list.matchAll(/['"](\w+)['"]/g)].map((x) => upper(x[1]));
    },
    path: (m) => m[1],
  },
  // Express: router.route('/x').get(...)
  { re: /\.route\(\s*['"`](\/[^'"`]*)['"`]\s*\)/g, method: () => ['ANY'], path: (m) => m[1] },
  // Spring: @GetMapping("/x"), @PostMapping(path = "/x")
  {
    re: /@(Get|Post|Put|Patch|Delete)Mapping\(\s*(?:(?:value|path)\s*=\s*)?\{?\s*["'](\/[^"']*)["']/g,
    method: (m) => [upper(m[1])],
    path: (m) => m[2],
  },
  {
    re: /@RequestMapping\(\s*(?:(?:value|path)\s*=\s*)?\{?\s*["'](\/[^"']*)["']/g,
    method: () => ['ANY'],
    path: (m) => m[1],
  },
  // Go net/http, including Go 1.22 method patterns: mux.HandleFunc("GET /x", h)
  {
    re: /\.Handle(?:Func)?\(\s*"(?:(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+)?(\/[^"]*)"/g,
    method: (m) => [m[1] ? upper(m[1]) : 'ANY'],
    path: (m) => m[2],
  },
  // ASP.NET minimal APIs: app.MapGet("/x")
  { re: /\.Map(Get|Post|Put|Patch|Delete)\(\s*"(\/[^"]*)"/g, method: (m) => [upper(m[1])], path: (m) => m[2] },
  // Rails and Sinatra: get '/x' => ..., post "/x" do
  {
    re: /^\s*(get|post|put|patch|delete)\s+['"](\/[^'"]*)['"]/gim,
    method: (m) => [upper(m[1])],
    path: (m) => m[2],
  },
  // Route tables written as "GET /x" string literals.
  {
    re: /['"`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[^'"`\s]*)['"`]/g,
    method: (m) => [upper(m[1])],
    path: (m) => m[2],
  },
];

const MOUNT_PATTERNS: RegExp[] = [
  /\.use\(\s*['"`](\/[^'"`]*)['"`]/g, // Express app.use('/api', router)
  /\.route\(\s*['"`](\/[^'"`]*)['"`]\s*,/g, // Hono app.route('/api', sub)
  /\bprefix\s*[=:]\s*['"`](\/[^'"`]*)['"`]/g, // FastAPI, Fastify register, Flask blueprints
  /\burl_prefix\s*=\s*['"](\/[^'"]*)['"]/g,
  /\.group\(\s*['"`](\/[^'"`]*)['"`]/gi, // Gin, Echo route groups
  /\.Group\(\s*"(\/[^"]*)"/g,
  /@RequestMapping\(\s*(?:(?:value|path)\s*=\s*)?\{?\s*["'](\/[^"']*)["']/g, // Spring class-level mappings
];

/** Extracts route definitions from a source file. */
export function findRoutes(source: string, file: string): { routes: Route[]; prefixes: string[] } {
  const index = new LineIndex(source);
  const routes: Route[] = [];
  const prefixes: string[] = [];
  for (const pattern of ROUTE_PATTERNS) {
    for (const m of source.matchAll(pattern.re)) {
      const path = pattern.path(m);
      if (!path || m.index === undefined) continue;
      for (const method of pattern.method(m)) routes.push({ method, path, file, line: index.lineAt(m.index) });
    }
  }
  for (const re of MOUNT_PATTERNS) {
    for (const m of source.matchAll(re)) if (m[1] && m[1] !== '/') prefixes.push(m[1]);
  }
  return { routes, prefixes };
}

/** File-system routes: Next.js app and pages routers, and SvelteKit server routes. */
export function fileRoute(file: string, source: string): Route[] {
  const next = /(?:^|\/)app\/(.*?)\/?route\.(?:ts|js|tsx|jsx|mjs)$/.exec(file);
  const pagesApi = /(?:^|\/)pages\/(api\/.*?)(?:\/index)?\.(?:ts|js|tsx|jsx|mjs)$/.exec(file);
  const svelte = /(?:^|\/)src\/routes\/(.*?)\/?\+server\.(?:ts|js)$/.exec(file);
  const raw = next?.[1] ?? pagesApi?.[1] ?? svelte?.[1];
  if (raw === undefined) return [];
  // Route groups such as (marketing) do not appear in the URL.
  const path = `/${raw.split('/').filter((s) => s && !/^\(.*\)$/.test(s)).join('/')}`;
  if (pagesApi) return [{ method: 'ANY', path, file, line: 1 }];
  const index = new LineIndex(source);
  const routes: Route[] = [];
  for (const m of source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) {
    routes.push({ method: m[1] as Method, path, file, line: index.lineAt(m.index ?? 0) });
  }
  return routes;
}

export const endpointsCheck: Check = {
  id: 'endpoints',
  title: 'Endpoints',
  description: 'HTTP routes documented as "GET /path" are defined in the source code.',
  async run({ project, config, docs }) {
    const ignore = makeTextMatcher(config.endpoints.ignore);
    const mentions: { doc: DocFile; mention: EndpointMention }[] = [];
    for (const doc of docs) for (const mention of findEndpointMentions(doc)) mentions.push({ doc, mention });
    if (mentions.length === 0) return { checked: 0, findings: [] };

    const routes: Route[] = [];
    const prefixes = new Set<string>(['', ...config.endpoints.prefixes.map((p) => normaliseRoute(p))]);
    for (const file of project.sourceFiles(CODE_EXTENSIONS)) {
      const source = project.readText(file);
      if (!source) continue;
      const found = findRoutes(source, file);
      routes.push(...found.routes, ...fileRoute(file, source));
      for (const p of found.prefixes) prefixes.add(normaliseRoute(p));
    }
    if (routes.length === 0) {
      throw new SkipCheck('no route definitions were found in the source code');
    }

    const compiled = routes.map((r) => ({ ...r, segments: split(normaliseRoute(r.path)) }));
    const prefixList = [...prefixes].map((p) => split(p === '/' ? '' : p));
    const findings: Finding[] = [];
    let checked = 0;

    for (const { doc, mention } of mentions) {
      const display = `${mention.method} ${mention.path}`;
      if (ignore(display) || ignore(mention.path)) continue;
      checked++;
      const documented = split(normaliseRoute(mention.path));
      const matching = compiled.filter((r) =>
        prefixList.some((prefix) => segmentsMatch([...prefix, ...r.segments], documented)),
      );
      const base = {
        check: 'endpoints' as const,
        file: doc.path,
        line: mention.line,
        ...(mention.column ? { column: mention.column } : {}),
        claim: display,
      };
      if (matching.length === 0) {
        findings.push({ ...base, severity: 'error', message: `No route matching ${display} was found in the source code` });
        continue;
      }
      const methods = new Set(matching.map((r) => r.method));
      const methodOk =
        methods.has('ANY') || methods.has(mention.method) || (mention.method === 'HEAD' && methods.has('GET'));
      if (!methodOk) {
        const where = matching[0];
        findings.push({
          ...base,
          severity: 'error',
          message: `${display} is documented, but the source only defines ${[...methods].sort().join(', ')} for that path`,
          ...(where ? { hint: `See ${where.file}:${where.line}` } : {}),
        });
      }
    }
    return { checked, findings };
  },
};
