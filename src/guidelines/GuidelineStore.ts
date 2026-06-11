import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NotFoundError } from '../errors.js';

/**
 * Loads agent-facing guideline documents (*.md) from a configured directory.
 * These are exposed to agents via MCP prompts (DESIGN.md §6): `list()` powers
 * `prompts/list`, `get(name)` powers `prompts/get`.
 */
export class GuidelineStore {
  constructor(private readonly dir: string) {}

  /**
   * List all `*.md` files in the directory.
   * - `name`: filename without the `.md` extension.
   * - `description`: first non-empty line, with any leading `#` (and following
   *   whitespace) stripped. Empty string when the file has no usable line.
   * Returns `[]` when the directory does not exist.
   */
  async list(): Promise<{ name: string; description: string }[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }

    const mdFiles = entries.filter((f) => f.toLowerCase().endsWith('.md'));
    const results: { name: string; description: string }[] = [];

    for (const file of mdFiles) {
      const name = file.slice(0, file.length - '.md'.length);
      let content: string;
      try {
        content = await readFile(join(this.dir, file), 'utf8');
      } catch (err) {
        if (isErrnoException(err) && (err.code === 'ENOENT' || err.code === 'EISDIR')) {
          continue;
        }
        throw err;
      }
      results.push({ name, description: firstDescription(content) });
    }

    return results;
  }

  /**
   * Read the raw content of the guideline `<name>.md`.
   * Throws `NotFoundError` when the file is missing. Rejects names containing
   * path separators or `..` to prevent path traversal.
   */
  async get(name: string): Promise<string> {
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      throw new NotFoundError(`Invalid guideline name: ${name}`);
    }

    const path = join(this.dir, `${name}.md`);
    try {
      return await readFile(path, 'utf8');
    } catch (err) {
      if (isErrnoException(err) && (err.code === 'ENOENT' || err.code === 'EISDIR')) {
        throw new NotFoundError(`Guideline not found: ${name}`);
      }
      throw err;
    }
  }
}

function firstDescription(content: string): string {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    return trimmed.replace(/^#+\s*/, '').trim();
  }
  return '';
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && typeof (err as NodeJS.ErrnoException).code === 'string';
}
