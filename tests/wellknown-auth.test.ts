import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/providers/auth.ts', () => ({
  fetchWithAuth: vi.fn(),
}));

const { fetchWithAuth } = await import('../src/providers/auth.ts');
const { WellKnownProvider } = await import('../src/providers/wellknown.ts');

const mockedFetch = vi.mocked(fetchWithAuth);

const SKILL_MD = `---
name: deploy
description: Deploy the app
---
Steps`;

const INDEX = {
  skills: [{ name: 'deploy', description: 'Deploy the app', files: ['SKILL.md', 'run.sh'] }],
};

function respond(routes: Record<string, Response | (() => Response)>) {
  mockedFetch.mockImplementation(async (input) => {
    const route = routes[String(input)];
    if (!route) return new Response('not found', { status: 404 });
    return typeof route === 'function' ? route() : route;
  });
}

describe('WellKnownProvider with authenticated endpoints', () => {
  const provider = new WellKnownProvider();

  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it('forwards the query string to index.json', async () => {
    respond({
      'https://acme.example.com/skills/.well-known/skills/index.json?source=repo%3Aacme%2Ftools':
        () => Response.json(INDEX),
    });

    const result = await provider.fetchIndex(
      'https://acme.example.com/skills?source=repo%3Aacme%2Ftools'
    );

    expect(result?.index.skills.map((s) => s.name)).toEqual(['deploy']);
    expect(result?.resolvedBaseUrl).toBe('https://acme.example.com/skills');
  });

  it('does not fall back to the root index after a 401', async () => {
    respond({
      'https://acme.example.com/skills/.well-known/skills/index.json': () =>
        new Response('unauthorized', { status: 401 }),
      'https://acme.example.com/.well-known/skills/index.json': () => Response.json(INDEX),
    });

    expect(await provider.fetchIndex('https://acme.example.com/skills')).toBeNull();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('fetches the index and every skill file through fetchWithAuth', async () => {
    respond({
      'https://acme.example.com/skills/.well-known/skills/index.json': () => Response.json(INDEX),
      'https://acme.example.com/skills/.well-known/skills/deploy/SKILL.md': () =>
        new Response(SKILL_MD),
      'https://acme.example.com/skills/.well-known/skills/deploy/run.sh': () =>
        new Response('echo hi'),
    });

    const skills = await provider.fetchAllSkills('https://acme.example.com/skills');

    expect(skills).toHaveLength(1);
    expect(skills[0]!.files.get('run.sh')).toBe('echo hi');
    expect(mockedFetch.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      'https://acme.example.com/skills/.well-known/skills/deploy/SKILL.md',
      'https://acme.example.com/skills/.well-known/skills/deploy/run.sh',
      'https://acme.example.com/skills/.well-known/skills/index.json',
    ]);
  });

  it('keeps the query string in the raw index URL', () => {
    expect(provider.toRawUrl('https://acme.example.com/skills?group=eng')).toBe(
      'https://acme.example.com/skills/.well-known/skills/index.json?group=eng'
    );
  });
});
