import { describe, expect, it } from 'vitest';
import { fileRoute, findRoutes, normaliseRoute } from '../src/checks/endpoints.js';
import { checkResult, errors, findings, runFixture, summary } from './helpers.js';

describe('normaliseRoute', () => {
  it.each([
    ['/users/:id', '/users/:'],
    ['/users/{id}', '/users/:'],
    ['/users/<int:id>', '/users/:'],
    ['/users/[id]', '/users/:'],
    ['/docs/[...slug]', '/docs/*'],
    ['/users/', '/users'],
    ['/search?q=x', '/search'],
    ['/', '/'],
  ])('normalises %s to %s', (input, output) => {
    expect(normaliseRoute(input)).toBe(output);
  });
});

describe('findRoutes', () => {
  const routes = (source: string) => findRoutes(source, 'f').routes.map((r) => `${r.method} ${r.path}`);

  it('recognises common frameworks', () => {
    expect(routes("app.get('/a', h)")).toEqual(['GET /a']);
    expect(routes('@app.post("/b")')).toEqual(['POST /b']);
    expect(routes('@app.route("/c", methods=["PUT", "DELETE"])')).toEqual(['PUT /c', 'DELETE /c']);
    expect(routes('@app.route("/d")')).toEqual(['GET /d']);
    expect(routes('@GetMapping("/e")')).toEqual(['GET /e']);
    expect(routes('mux.HandleFunc("POST /f", h)')).toEqual(['POST /f']);
    expect(routes('http.HandleFunc("/g", h)')).toEqual(['ANY /g']);
    expect(routes('app.MapDelete("/h", h)')).toEqual(['DELETE /h']);
    expect(routes("  get '/i', to: 'x#y'")).toEqual(['GET /i']);
    expect(routes('r.GET("/j", h)')).toEqual(['GET /j']);
  });

  it('collects mount prefixes', () => {
    expect(findRoutes("app.use('/api', router)", 'f').prefixes).toEqual(['/api']);
    expect(findRoutes('router = APIRouter(prefix="/v2")', 'f').prefixes).toEqual(['/v2']);
  });

  it('derives file-system routes', () => {
    const next = fileRoute('app/api/users/[id]/route.ts', 'export async function GET() {}\nexport const POST = h;');
    expect(next.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/users/[id]', 'POST /api/users/[id]']);
    expect(fileRoute('pages/api/hello.ts', '').map((r) => `${r.method} ${r.path}`)).toEqual(['ANY /api/hello']);
    expect(fileRoute('src/routes/(app)/items/+server.ts', 'export function GET() {}')[0]?.path).toBe('/items');
  });
});

describe('endpoints check', () => {
  it('matches documented routes, including prefixes, parameters and HEAD via GET', async () => {
    const result = await runFixture('endpoints/good', { only: ['endpoints'] });
    expect(findings(result)).toEqual([]);
    expect(checkResult(result, 'endpoints').checked).toBe(7);
  });

  it('reports missing routes and method mismatches', async () => {
    const result = await runFixture('endpoints/drifted', { only: ['endpoints'] });
    expect(summary(errors(result))).toEqual([
      'README.md:3 No route matching GET /api/orders was found in the source code',
      'README.md:4 PATCH /api/users/:id is documented, but the source only defines GET, PUT for that path',
    ]);
  });

  it('skips itself when the project defines no routes', async () => {
    const result = await runFixture('endpoints/no-routes', { only: ['endpoints'] });
    expect(checkResult(result, 'endpoints')).toMatchObject({ status: 'skipped' });
    expect(result.summary.passed).toBe(true);
  });
});
