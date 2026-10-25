import { app, ipcMain, shell } from 'electron'
import { promises as fs } from 'fs'
import { basename, dirname, extname, join, parse, sep } from 'path'
import { IMAGE_EXTENSIONS, type Crumb, type FolderEntry, type FolderListing } from '../shared/types'

interface Settings {
  lastFolder?: string
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

async function readSettings(): Promise<Settings> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf-8')) as Settings
  } catch {
    return {}
  }
}

async function writeSettings(settings: Settings): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory()
  } catch {
    return false
  }
}

function crumbsFor(folderPath: string): Crumb[] {
  const { root } = parse(folderPath)
  const crumbs: Crumb[] = [{ name: root, path: root }]
  let current = root
  for (const part of folderPath.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    crumbs.push({ name: part, path: current })
  }
  return crumbs
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

async function listFolder(folderPath: string): Promise<FolderListing> {
  const dirents = await fs.readdir(folderPath, { withFileTypes: true })
  const entries: FolderEntry[] = []

  await Promise.all(
    dirents
      .filter((dirent) => !dirent.name.startsWith('.'))
      .map(async (dirent) => {
        const path = join(folderPath, dirent.name)
        const isImage = IMAGE_EXTENSIONS.has(extname(dirent.name).toLowerCase())
        // Symlinks report neither isFile nor isDirectory, so only they need a stat
        // to find out what they point at; everything else is skipped unless it
        // can turn out to be a folder or an image.
        if (!dirent.isDirectory() && !dirent.isSymbolicLink() && !(dirent.isFile() && isImage)) return
        try {
          const stats = await fs.stat(path)
          if (stats.isDirectory()) {
            entries.push({ name: dirent.name, path, kind: 'dir', mtimeMs: stats.mtimeMs, size: stats.size })
          } else if (stats.isFile() && isImage) {
            entries.push({ name: dirent.name, path, kind: 'image', mtimeMs: stats.mtimeMs, size: stats.size })
          }
        } catch {
          // Broken symlink or a file removed mid-listing — just leave it out.
        }
      })
  )

  entries.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'dir' ? -1 : 1))

  const parent = dirname(folderPath)
  return {
    path: folderPath,
    parent: parent === folderPath ? null : parent,
    crumbs: crumbsFor(folderPath),
    entries
  }
}

// "photo.jpg" → "photo-kopia.jpg", then "photo-kopia-2.jpg" and so on if that one is taken.
async function duplicateImage(filePath: string): Promise<FolderEntry> {
  const ext = extname(filePath)
  const stem = basename(filePath, ext)
  for (let n = 1; ; n++) {
    const name = `${stem}-kopia${n > 1 ? `-${n}` : ''}${ext}`
    const path = join(dirname(filePath), name)
    try {
      await fs.copyFile(filePath, path, fs.constants.COPYFILE_EXCL)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
    const stats = await fs.stat(path)
    return { name, path, kind: 'image', mtimeMs: stats.mtimeMs, size: stats.size }
  }
}

function assertImage(filePath: string): void {
  if (!IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) throw new Error(`Not an image: ${filePath}`)
}

export function registerFolderHandlers(): void {
  ipcMain.handle('folder:getStart', async (): Promise<string> => {
    const { lastFolder } = await readSettings()
    if (lastFolder && (await isDirectory(lastFolder))) return lastFolder
    return app.getPath('pictures')
  })

  ipcMain.handle('folder:getDesktop', (): string => app.getPath('desktop'))

  ipcMain.handle('folder:list', async (_event, folderPath: string): Promise<FolderListing | null> => {
    try {
      const listing = await listFolder(folderPath)
      await writeSettings({ ...(await readSettings()), lastFolder: folderPath })
      return listing
    } catch {
      return null
    }
  })

  ipcMain.handle('image:duplicate', async (_event, filePath: string): Promise<FolderEntry> => {
    assertImage(filePath)
    return duplicateImage(filePath)
  })

  // Trash rather than unlink, so a mistaken delete can be undone from Finder.
  ipcMain.handle('image:trash', async (_event, filePath: string): Promise<void> => {
    assertImage(filePath)
    await shell.trashItem(filePath)
  })

  ipcMain.handle('folder:reveal', async (_event, folderPath: string): Promise<void> => {
    await shell.openPath(folderPath)
  })
}
