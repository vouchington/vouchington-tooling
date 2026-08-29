import { symlink } from 'node:fs/promises'

type DirectoryLink = (source: string, path: string, type: 'dir' | 'junction') => Promise<void>

/** Creates a directory link, retrying as a junction when Windows blocks symbolic links. */
export async function createDirectoryLink(
  source: string,
  path: string,
  link: DirectoryLink = symlink,
  platform = process.platform,
): Promise<void> {
  try {
    await link(source, path, 'dir')
  } catch (error) {
    if (
      platform !== 'win32' ||
      !['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')
    )
      throw error
    await link(source, path, 'junction')
  }
}
