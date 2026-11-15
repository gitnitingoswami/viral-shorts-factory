import { spawn } from 'node:child_process';

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly stderr: string,
    readonly reason: 'exit' | 'timeout' | 'aborted' | 'spawn',
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}

export interface RunOptions {
  signal?: AbortSignal;
  timeoutMs: number;
  stdin?: string | Buffer;
  /** Called with each stdout chunk (e.g. FFmpeg `-progress pipe:1`). */
  onStdout?: (chunk: string) => void;
  /** Keep stdout as a Buffer (binary output such as WAV). */
  binaryStdout?: boolean;
}

export interface RunResult {
  stdout: Buffer;
  stderr: string;
}

const MAX_STDERR = 64 * 1024;

/**
 * Runs a binary with an argument array (never a shell string, so no injection), a hard timeout and cancellation.
 * The child is SIGKILLed on timeout/abort so a stuck FFmpeg never outlives its job.
 */
export function run(bin: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new ProcessError(`${bin} aborted before start`, null, '', 'aborted'));
      return;
    }
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LANG: 'C.UTF-8' } });
    const out: Buffer[] = [];
    let stderr = '';
    let settled = false;
    let reason: ProcessError['reason'] = 'exit';

    const kill = (why: ProcessError['reason']) => {
      reason = why;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => kill('timeout'), opts.timeoutMs);
    const onAbort = () => kill('aborted');
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve({ stdout: Buffer.concat(out), stderr });
    };

    child.stdout.on('data', (c: Buffer) => {
      if (opts.onStdout) opts.onStdout(c.toString('utf8'));
      if (opts.binaryStdout || !opts.onStdout) out.push(c);
    });
    child.stderr.on('data', (c: Buffer) => {
      if (stderr.length < MAX_STDERR) stderr += c.toString('utf8');
    });
    child.on('error', (e) => finish(new ProcessError(`${bin} could not start: ${e.message}`, null, stderr, 'spawn')));
    child.on('close', (code) => {
      if (reason === 'timeout') finish(new ProcessError(`${bin} timed out after ${opts.timeoutMs} ms`, code, stderr, 'timeout'));
      else if (reason === 'aborted') finish(new ProcessError(`${bin} was cancelled`, code, stderr, 'aborted'));
      else if (code !== 0) finish(new ProcessError(`${bin} exited with code ${code}: ${lastLines(stderr)}`, code, stderr, 'exit'));
      else finish(null);
    });
    child.stdin.on('error', () => undefined); // EPIPE when the child exits early; surfaced via close.
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}

export function lastLines(text: string, n = 3): string {
  return text.trim().split('\n').slice(-n).join(' | ').slice(0, 400);
}

/** First line of `<bin> -version`/`--version`, or null when the binary is missing. */
export async function probeVersion(bin: string, flag: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await run(bin, [flag], { timeoutMs: 5000 });
    const text = stdout.toString('utf8') || stderr;
    return text.split('\n')[0].trim().slice(0, 120) || null;
  } catch {
    return null;
  }
}
