import { contextBridge, ipcRenderer } from 'electron'
import type { FolderEntry, FolderListing } from '../shared/types'

const api = {
  getStartFolder: (): Promise<string> => ipcRenderer.invoke('folder:getStart'),
  getDesktopFolder: (): Promise<string> => ipcRenderer.invoke('folder:getDesktop'),
  listFolder: (folderPath: string): Promise<FolderListing | null> => ipcRenderer.invoke('folder:list', folderPath),
  duplicateImage: (filePath: string): Promise<FolderEntry> => ipcRenderer.invoke('image:duplicate', filePath),
  readImage: (filePath: string): Promise<Uint8Array<ArrayBuffer>> => ipcRenderer.invoke('image:read', filePath),
  replaceImage: (filePath: string, bytes: Uint8Array): Promise<FolderEntry> =>
    ipcRenderer.invoke('image:replace', filePath, bytes),
  printImage: (filePath: string, landscape: boolean): Promise<void> =>
    ipcRenderer.invoke('image:print', filePath, landscape),
  trashImage: (filePath: string): Promise<void> => ipcRenderer.invoke('image:trash', filePath),
  revealFolder: (folderPath: string): Promise<void> => ipcRenderer.invoke('folder:reveal', folderPath)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
