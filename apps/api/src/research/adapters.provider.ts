import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.schema';
import { HttpGet, safeGet } from './http';
import {
  GitHubAdapter,
  HackerNewsAdapter,
  ResearchSourceAdapter,
  RssAdapter,
  StackExchangeAdapter,
  YouTubeCompetitionClient,
} from './sources';

/** Injection token for the HTTP client (replaced by a fixture-backed client in tests). */
export const RESEARCH_HTTP = Symbol('RESEARCH_HTTP');
export const RESEARCH_ADAPTERS = Symbol('RESEARCH_ADAPTERS');

export interface ResearchAdapters {
  discovery: ResearchSourceAdapter[];
  youtube: YouTubeCompetitionClient;
  /** Secrets to scrub from any error text before it is stored or logged. */
  secrets: string[];
}

export const researchHttpProvider = { provide: RESEARCH_HTTP, useValue: safeGet };

export const researchAdaptersProvider = {
  provide: RESEARCH_ADAPTERS,
  inject: [ConfigService, RESEARCH_HTTP],
  useFactory: (config: ConfigService<AppEnv, true>, http: HttpGet): ResearchAdapters => {
    const deps = { http, timeoutMs: config.get('RESEARCH_HTTP_TIMEOUT_MS', { infer: true }) };
    const ytKey = config.get('YOUTUBE_API_KEY', { infer: true }) || undefined;
    const ghToken = config.get('GITHUB_RESEARCH_TOKEN', { infer: true }) || undefined;
    const feeds = config
      .get('RESEARCH_RSS_FEEDS', { infer: true })
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.startsWith('https://'));
    return {
      discovery: [
        new HackerNewsAdapter(deps),
        new StackExchangeAdapter(deps),
        new GitHubAdapter(deps, ghToken),
        new RssAdapter(deps, feeds),
      ],
      youtube: new YouTubeCompetitionClient(deps, ytKey),
      secrets: [ytKey, ghToken].filter((s): s is string => Boolean(s)),
    };
  },
};

/** Removes secrets and truncates; source error messages are stored and shown in the UI. */
export function scrub(message: string, secrets: string[]): string {
  let out = message;
  for (const s of secrets) out = out.split(s).join('[REDACTED]');
  return out.replace(/key=[^&\s]+/gi, 'key=[REDACTED]').slice(0, 200);
}
