import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { CodeCheckStatus, CodeLanguage } from '@vsf/contracts';
import type { AppEnv } from '../config/env.schema';

export interface SandboxResult {
  status: Extract<CodeCheckStatus, 'passed' | 'failed' | 'not_executable' | 'unavailable'>;
  stdout: string;
  stderr: string;
  durationMs: number | null;
}

const OUTPUT_CAP = 8 * 1024;
const EXECUTABLE: Partial<Record<CodeLanguage, string>> = { javascript: '/tmp/s.mjs', typescript: '/tmp/s.mts' };

/** Docker arguments for a locked-down, single-use container (SECURITY_DESIGN T7). */
export function sandboxArgs(name: string, image: string, file: string): string[] {
  return [
    'run', '-i', '--rm', '--pull=never', '--name', name,
    '--network', 'none',
    '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m',
    '--memory', '256m', '--memory-swap', '256m', '--pids-limit', '64', '--cpus', '0.5',
    '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    image,
    'sh', '-c', `cat > ${file} && exec node ${file}`,
  ];
}

/**
 * Runs untrusted, LLM-written JavaScript/TypeScript snippets in a throw-away container: no network, read-only
 * root, tiny tmpfs, CPU/memory/pid limits, non-root, no capabilities, hard timeout. Other languages are reported
 * `not_executable`. If Docker is unavailable the result is `unavailable` (approval then needs an override).
 *
 * Note: this runs the docker CLI from the worker host. Containerized workers must not mount docker.sock; a
 * dedicated sandbox-runner service is tracked as follow-up F-11 for production.
 */
@Injectable()
export class SandboxService {
  private readonly logger = new Logger(SandboxService.name);
  private readonly mode: 'docker' | 'disabled';
  private readonly image: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<AppEnv, true>) {
    this.mode = config.get('CODE_SANDBOX', { infer: true });
    this.image = config.get('CODE_SANDBOX_IMAGE', { infer: true });
    this.timeoutMs = config.get('CODE_SANDBOX_TIMEOUT_MS', { infer: true });
  }

  async run(language: CodeLanguage, source: string): Promise<SandboxResult> {
    const file = EXECUTABLE[language];
    if (!file) return { status: 'not_executable', stdout: '', stderr: `${language} snippets are not executed`, durationMs: null };
    if (this.mode === 'disabled') return { status: 'unavailable', stdout: '', stderr: 'Code sandbox disabled', durationMs: null };

    const name = `vsf-sbx-${randomUUID()}`;
    const started = Date.now();
    return new Promise<SandboxResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (r: SandboxResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      const child = spawn('docker', sandboxArgs(name, this.image, file), { stdio: ['pipe', 'pipe', 'pipe'] });
      const cap = (acc: string, chunk: Buffer) => (acc.length >= OUTPUT_CAP ? acc : (acc + chunk.toString('utf8')).slice(0, OUTPUT_CAP));
      child.stdout.on('data', (c: Buffer) => (stdout = cap(stdout, c)));
      child.stderr.on('data', (c: Buffer) => (stderr = cap(stderr, c)));
      child.on('error', (err) => {
        this.logger.warn({ err: err.message }, 'Sandbox unavailable');
        finish({ status: 'unavailable', stdout: '', stderr: 'Docker is not available to the worker', durationMs: null });
      });
      child.on('close', (code) => {
        const durationMs = Date.now() - started;
        // 125 = docker itself failed (daemon down, image not pre-pulled with --pull=never): not the snippet's fault.
        if (code === 125 || /Cannot connect to the Docker daemon|No such image|Unable to find image/i.test(stderr)) {
          finish({ status: 'unavailable', stdout: '', stderr: stderr.slice(0, 500), durationMs });
        } else {
          finish({ status: code === 0 ? 'passed' : 'failed', stdout, stderr, durationMs });
        }
      });
      const timer = setTimeout(() => {
        // Killing the CLI does not stop the container: kill it by name.
        spawn('docker', ['kill', name], { stdio: 'ignore' }).on('error', () => undefined);
        child.kill('SIGKILL');
        finish({ status: 'failed', stdout, stderr: `${stderr}\nTimed out after ${this.timeoutMs} ms`.trim(), durationMs: Date.now() - started });
      }, this.timeoutMs);
      child.stdin.on('error', () => undefined);
      child.stdin.end(source);
    });
  }
}
