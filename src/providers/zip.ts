import matter from 'gray-matter';
import { mkdir, rm, readdir, readFile, writeFile, stat } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { tmpdir } from 'os';
import type { HostProvider, ProviderMatch, RemoteSkill } from './types.ts';
import { fetchWithAuth } from './auth.ts';

/**
 * Represents a skill with all its files fetched from a ZIP archive.
 */
export interface ZipSkill extends RemoteSkill {
  /** All files in the skill, keyed by relative path */
  files: Map<string, string>;
}

/**
 * Extract a ZIP file to a directory.
 */
async function extractZip(zipPath: string, extractDir: string): Promise<void> {
  // Use unzipper for proper ZIP extraction
  const unzipper = await import('unzipper');

  await mkdir(extractDir, { recursive: true });

  const directory = await unzipper.Open.file(zipPath);

  for (const file of directory.files) {
    // Skip directories entries and __MACOSX files
    if (file.type === 'Directory' || file.path.includes('__MACOSX')) {
      continue;
    }

    // Normalize path and ensure it doesn't escape the extract directory
    const normalizedPath = file.path.replace(/\\/g, '/');
    if (normalizedPath.includes('..')) {
      continue; // Skip path traversal attempts
    }

    const filePath = join(extractDir, normalizedPath);
    const fileDir = dirname(filePath);

    // Create directory structure
    await mkdir(fileDir, { recursive: true });

    // Extract file
    const content = await file.buffer();
    await writeFile(filePath, content);
  }
}

/**
 * Find the skill root directory within an extracted ZIP.
 * The skill might be at the root or in a subdirectory.
 */
async function findSkillRoot(extractDir: string): Promise<string | null> {
  // Check if SKILL.md exists at root
  const rootSkillMd = join(extractDir, 'SKILL.md');
  try {
    await stat(rootSkillMd);
    return extractDir;
  } catch {
    // Not at root, search subdirectories
  }

  // Check first-level subdirectories (common for GitHub ZIP downloads)
  const entries = await readdir(extractDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subdir = join(extractDir, entry.name);
      const skillMdPath = join(subdir, 'SKILL.md');
      try {
        await stat(skillMdPath);
        return subdir;
      } catch {
        // Not in this subdirectory
      }
    }
  }

  return null;
}

/**
 * Read all files from a skill directory into a Map.
 */
async function readSkillFiles(skillDir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  async function readDir(dir: string, prefix: string = ''): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      // Skip hidden files and common non-skill files
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }

      if (entry.isDirectory()) {
        await readDir(fullPath, relativePath);
      } else {
        // Only read text files (skip binary files)
        try {
          const content = await readFile(fullPath, 'utf-8');
          files.set(relativePath, content);
        } catch {
          // Skip files that can't be read as text
        }
      }
    }
  }

  await readDir(skillDir);
  return files;
}

/**
 * ZIP file skills provider.
 *
 * Downloads and extracts ZIP files containing skills.
 * Supports OAuth authentication for protected endpoints.
 *
 * URL formats supported:
 * - https://example.com/skill.zip
 * - https://example.com/path/to/skill.zip
 * - Any URL ending with .zip
 *
 * The source identifier is "zip/{hostname}".
 */
export class ZipProvider implements HostProvider {
  readonly id = 'zip';
  readonly displayName = 'ZIP Archive';

  /**
   * Check if a URL is a ZIP file URL.
   */
  match(url: string): ProviderMatch {
    // Must be a valid HTTP(S) URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { matches: false };
    }

    // Must end with .zip (case insensitive)
    if (!url.toLowerCase().endsWith('.zip')) {
      return { matches: false };
    }

    try {
      const parsed = new URL(url);
      return {
        matches: true,
        sourceIdentifier: `zip/${parsed.hostname}`,
      };
    } catch {
      return { matches: false };
    }
  }

  /**
   * Fetch and extract a skill from a ZIP file.
   */
  async fetchSkill(url: string): Promise<ZipSkill | null> {
    let tempDir: string | null = null;
    let zipPath: string | null = null;

    try {
      // Create temp directory for extraction
      tempDir = join(tmpdir(), `skills-zip-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(tempDir, { recursive: true });

      zipPath = join(tempDir, 'skill.zip');

      // Download ZIP file with auth support
      const response = await fetchWithAuth(url);

      if (!response.ok) {
        if (response.status === 401) {
          console.error('Authentication required but OAuth flow failed or was not available');
        }
        return null;
      }

      // Save ZIP to temp file
      const arrayBuffer = await response.arrayBuffer();
      await writeFile(zipPath, Buffer.from(arrayBuffer));

      // Extract ZIP
      const extractDir = join(tempDir, 'extracted');
      await extractZip(zipPath, extractDir);

      // Find skill root
      const skillRoot = await findSkillRoot(extractDir);
      if (!skillRoot) {
        return null;
      }

      // Read SKILL.md
      const skillMdPath = join(skillRoot, 'SKILL.md');
      const content = await readFile(skillMdPath, 'utf-8');

      // Parse frontmatter
      const { data } = matter(content);

      // Validate required frontmatter
      if (!data.name || !data.description) {
        return null;
      }

      // Read all skill files
      const files = await readSkillFiles(skillRoot);

      // Determine install name from frontmatter or ZIP filename
      const installName =
        data.metadata?.['install-name'] ||
        data.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');

      return {
        name: data.name,
        description: data.description,
        content,
        installName,
        sourceUrl: url,
        metadata: data.metadata,
        files,
      };
    } catch (error) {
      console.error('Error fetching ZIP skill:', error);
      return null;
    } finally {
      // Cleanup temp files
      if (tempDir) {
        try {
          await rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Convert URL to raw URL (for ZIP files, it's the same URL).
   */
  toRawUrl(url: string): string {
    return url;
  }

  /**
   * Get the source identifier for telemetry/storage.
   */
  getSourceIdentifier(url: string): string {
    try {
      const parsed = new URL(url);
      // Extract filename without extension for more specific identifier
      const pathname = parsed.pathname;
      const filename = basename(pathname, '.zip');
      return `zip/${parsed.hostname}/${filename}`;
    } catch {
      return 'zip/unknown';
    }
  }
}

export const zipProvider = new ZipProvider();
