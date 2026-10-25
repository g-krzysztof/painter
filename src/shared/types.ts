export const THUMB_SCHEME = 'thumb'

export const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
  '.svg'
])

export interface FolderEntry {
  name: string
  path: string
  kind: 'dir' | 'image'
  // Part of the thumbnail URL, so an edited file gets a fresh thumbnail
  // instead of the one Chromium cached for the old contents.
  mtimeMs: number
  // Bytes; shown in the preview.
  size: number
}

export interface Crumb {
  name: string
  path: string
}

export interface FolderListing {
  path: string
  parent: string | null
  crumbs: Crumb[]
  entries: FolderEntry[]
}

// An image opened from Finder, with the folder to show it in.
export interface OpenedFile {
  folder: string
  path: string
}
