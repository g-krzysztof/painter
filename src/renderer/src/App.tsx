import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { THUMB_SCHEME, type FolderEntry, type FolderListing, type OpenedFile } from '../../shared/types'

const TILE_SIZE = 180
const THUMB_PIXELS = Math.round(TILE_SIZE * Math.min(window.devicePixelRatio || 1, 2))

function thumbUrl(entry: FolderEntry): string {
  const params = new URLSearchParams({ p: entry.path, s: String(THUMB_PIXELS), m: String(Math.round(entry.mtimeMs)) })
  return `${THUMB_SCHEME}://local/?${params}`
}

function fullUrl(entry: FolderEntry): string {
  const params = new URLSearchParams({ p: entry.path, full: '1', m: String(Math.round(entry.mtimeMs)) })
  return `${THUMB_SCHEME}://local/?${params}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toLocaleString('pl-PL', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`
}

// Formats the canvas can write back, so a crop keeps the file's own format and name.
const CROP_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}

function cropType(entry: FolderEntry): string | undefined {
  return CROP_TYPES[entry.name.split('.').pop()?.toLowerCase() ?? '']
}

// Edges in the image's own pixels, so the crop stays put while zooming.
interface CropRect {
  left: number
  top: number
  right: number
  bottom: number
}

// The preview <img> comes from another origin and would taint a canvas, so the
// bytes are fetched over IPC and decoded here instead.
async function cropImage(entry: FolderEntry, rect: CropRect, type: string): Promise<Uint8Array> {
  const bytes = await window.api.readImage(entry.path)
  const bitmap = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' })
  const width = rect.right - rect.left
  const height = rect.bottom - rect.top
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, rect.left, rect.top, width, height, 0, 0, width, height)
  bitmap.close()
  return encodeCanvas(canvas, type)
}

// A quarter turn, clockwise or not; the canvas swaps width and height.
async function rotateImage(entry: FolderEntry, clockwise: boolean, type: string): Promise<Uint8Array> {
  const bytes = await window.api.readImage(entry.path)
  const bitmap = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.height
  canvas.height = bitmap.width
  const context = canvas.getContext('2d')!
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(clockwise ? Math.PI / 2 : -Math.PI / 2)
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  bitmap.close()
  return encodeCanvas(canvas, type)
}

async function encodeCanvas(canvas: HTMLCanvasElement, type: string): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.95))
  if (!blob) throw new Error('Encoding failed')
  return new Uint8Array(await blob.arrayBuffer())
}

type Edges = Partial<Record<keyof CropRect, true>>

const CROP_HANDLES: [string, Edges][] = [
  ['n', { top: true }],
  ['s', { bottom: true }],
  ['w', { left: true }],
  ['e', { right: true }],
  ['nw', { top: true, left: true }],
  ['ne', { top: true, right: true }],
  ['sw', { bottom: true, left: true }],
  ['se', { bottom: true, right: true }]
]

type CropDrag = { kind: 'draw'; x: number; y: number } | { kind: 'edges'; edges: Edges }

function rectFrom(x1: number, y1: number, x2: number, y2: number): CropRect {
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) }
}

const ZOOM_STEP = 1.25
// Zoom is counted in whole steps from the fit-to-window size, so stepping back always lands exactly on it.
const MIN_ZOOM_STEP = -10
const MAX_ZOOM_STEP = 15

interface PreviewProps {
  entry: FolderEntry
  onClose: () => void
  onDuplicate: () => void
  onDelete: () => void
  onCrop: (rect: CropRect, type: string) => void
  onRotate: (clockwise: boolean, type: string) => Promise<void>
  // Undefined at either end of the folder.
  onPrev?: () => void
  onNext?: () => void
  // Off stretches the printed image over the whole page.
  printKeepRatio: boolean
  onPrintKeepRatioChange: (keep: boolean) => void
}

function Preview({
  entry,
  onClose,
  onDuplicate,
  onDelete,
  onCrop,
  onRotate,
  onPrev,
  onNext,
  printKeepRatio,
  onPrintKeepRatioChange
}: PreviewProps): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  // 0 = as large as fits on screen; each step is ×1.25 or ÷1.25 from there.
  const [zoomStep, setZoomStep] = useState(0)
  const [fit, setFit] = useState(1)
  const prevScaleRef = useRef<number | null>(null)
  // 'quick' crops as soon as the drag ends; 'precise' waits for Zatwierdź.
  const [cropMode, setCropMode] = useState<'quick' | 'precise' | null>(null)
  const [crop, setCrop] = useState<CropRect | null>(null)
  const dragRef = useRef<CropDrag | null>(null)
  // Blocks a second turn while the first is still being written over the file.
  const [rotating, setRotating] = useState(false)
  const type = cropType(entry)

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !natural) return
    const measure = (): void => {
      setFit(Math.min(stage.clientWidth / natural.width, stage.clientHeight / natural.height))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [natural])

  const scale = fit * ZOOM_STEP ** zoomStep

  // Keep the point in the middle of the view in place while zooming.
  useLayoutEffect(() => {
    const stage = stageRef.current
    const prev = prevScaleRef.current
    prevScaleRef.current = scale
    if (!stage || prev === null || prev === scale) return
    const ratio = scale / prev
    const cx = stage.scrollLeft + stage.clientWidth / 2
    const cy = stage.scrollTop + stage.clientHeight / 2
    stage.scrollLeft = cx * ratio - stage.clientWidth / 2
    stage.scrollTop = cy * ratio - stage.clientHeight / 2
  }, [scale])

  const zoomIn = useCallback(() => setZoomStep((step) => Math.min(step + 1, MAX_ZOOM_STEP)), [])
  const zoomOut = useCallback(() => setZoomStep((step) => Math.max(step - 1, MIN_ZOOM_STEP)), [])

  const startCrop = (mode: 'quick' | 'precise'): void => {
    setCropMode(mode)
    // Precise starts from the whole image, so each side can be pulled in straight away.
    setCrop(mode === 'precise' && natural ? { left: 0, top: 0, right: natural.width, bottom: natural.height } : null)
  }
  const cancelCrop = useCallback(() => {
    setCropMode(null)
    setCrop(null)
  }, [])
  const cropUsable = crop !== null && crop.right - crop.left >= 1 && crop.bottom - crop.top >= 1
  const confirmCrop = useCallback(() => {
    if (crop && cropUsable && type) onCrop(crop, type)
  }, [crop, cropUsable, type, onCrop])

  const imagePoint = (event: React.PointerEvent): { x: number; y: number } => {
    const box = frameRef.current!.getBoundingClientRect()
    const clamp = (value: number, max: number): number => Math.min(Math.max(Math.round(value / scale), 0), max)
    return { x: clamp(event.clientX - box.left, natural!.width), y: clamp(event.clientY - box.top, natural!.height) }
  }

  const onCropPointerDown = (event: React.PointerEvent): void => {
    if (!cropMode || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    // A handle has already claimed this drag on its way down.
    if (dragRef.current) return
    const { x, y } = imagePoint(event)
    dragRef.current = { kind: 'draw', x, y }
    setCrop(rectFrom(x, y, x, y))
  }

  const onCropPointerMove = (event: React.PointerEvent): void => {
    const drag = dragRef.current
    if (!drag) return
    const { x, y } = imagePoint(event)
    if (drag.kind === 'draw') {
      setCrop(rectFrom(drag.x, drag.y, x, y))
      return
    }
    const { edges } = drag
    setCrop((rect) =>
      rect && {
        left: edges.left ? Math.min(x, rect.right - 1) : rect.left,
        top: edges.top ? Math.min(y, rect.bottom - 1) : rect.top,
        right: edges.right ? Math.max(x, rect.left + 1) : rect.right,
        bottom: edges.bottom ? Math.max(y, rect.top + 1) : rect.bottom
      }
    )
  }

  const onCropPointerUp = (event: React.PointerEvent): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (cropMode !== 'quick' || drag?.kind !== 'draw' || !type) return
    const { x, y } = imagePoint(event)
    const rect = rectFrom(drag.x, drag.y, x, y)
    // A plain click is not a crop.
    if (rect.right - rect.left < 2 || rect.bottom - rect.top < 2) setCrop(null)
    else onCrop(rect, type)
  }

  const rotate = async (clockwise: boolean): Promise<void> => {
    if (!type || rotating) return
    setRotating(true)
    await onRotate(clockwise, type)
    setRotating(false)
  }

  // Wide images go on a landscape page so they print as large as they can.
  const print = (): void => {
    if (natural) window.api.printImage(entry.path, natural.width > natural.height)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') (cropMode ? cancelCrop : onClose)()
      else if (event.key === 'Enter' && cropMode === 'precise') confirmCrop()
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        if (!cropMode && natural) print()
      }
      else if (event.key === '+' || event.key === '=') zoomIn()
      else if (event.key === '-') zoomOut()
      // Leaving the image mid-crop would throw the crop away.
      else if (event.key === 'ArrowLeft' && !event.metaKey && !event.altKey && !cropMode) onPrev?.()
      else if (event.key === 'ArrowRight' && !event.metaKey && !event.altKey && !cropMode) onNext?.()
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, zoomIn, zoomOut, onPrev, onNext, cropMode, cancelCrop, confirmCrop, natural, entry.path])

  return (
    <div className={`preview${printKeepRatio ? '' : ' print-stretch'}`} role="dialog" aria-label={entry.name}>
      <div className="preview-stage" ref={stageRef}>
        <div className="preview-canvas">
          <div
            className={`preview-frame${cropMode ? ' cropping' : ''}`}
            ref={frameRef}
            onPointerDown={onCropPointerDown}
            onPointerMove={onCropPointerMove}
            onPointerUp={onCropPointerUp}
          >
            <img
              src={fullUrl(entry)}
              alt={entry.name}
              draggable={false}
              onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              style={natural ? { width: natural.width * scale, height: natural.height * scale } : { visibility: 'hidden' }}
            />
            {cropMode && crop && (
              <div
                className="crop-box"
                style={{
                  left: crop.left * scale,
                  top: crop.top * scale,
                  width: (crop.right - crop.left) * scale,
                  height: (crop.bottom - crop.top) * scale
                }}
              >
                {cropMode === 'precise' &&
                  CROP_HANDLES.map(([name, edges]) => (
                    <span
                      key={name}
                      className={`crop-handle crop-${name}`}
                      onPointerDown={() => (dragRef.current = { kind: 'edges', edges })}
                    />
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="preview-side">
        <div className="preview-info">
          <div className="preview-name" title={entry.name}>
            {entry.name}
          </div>
          <div className="preview-meta">
            {formatSize(entry.size)}
            {natural && ` · ${natural.width} × ${natural.height} px`}
            {cropMode && crop && ` · kadr ${crop.right - crop.left} × ${crop.bottom - crop.top} px`}
          </div>
        </div>
        {!cropMode && (
          <button className="key" onClick={onDelete} title="Przenieś do Kosza">
            Usuń
          </button>
        )}
      </div>
      <button className="key preview-nav preview-prev" onClick={onPrev} disabled={!onPrev || !!cropMode} title="Poprzednie (←)" aria-label="Poprzednie">
        ‹
      </button>
      <button className="key preview-nav preview-next" onClick={onNext} disabled={!onNext || !!cropMode} title="Następne (→)" aria-label="Następne">
        ›
      </button>
      <div className="preview-controls">
        <button className="key" onClick={zoomOut} disabled={zoomStep <= MIN_ZOOM_STEP} title="Oddal (−)" aria-label="Oddal">
          −
        </button>
        <span className="preview-zoom">{Math.round(scale * 100)}%</span>
        <button className="key" onClick={zoomIn} disabled={zoomStep >= MAX_ZOOM_STEP} title="Przybliż (+)" aria-label="Przybliż">
          +
        </button>
      </div>
      <div className="preview-actions">
        {cropMode ? (
          <>
            {cropMode === 'precise' && (
              <button className="key" onClick={confirmCrop} disabled={!cropUsable} title="Obetnij i zapisz (Enter)">
                Zatwierdź
              </button>
            )}
            <button className="key" onClick={cancelCrop} title="Anuluj kadrowanie (Esc)">
              Anuluj
            </button>
          </>
        ) : (
          <>
            <button
              className="key"
              onClick={() => startCrop('quick')}
              disabled={!type || !natural}
              title={type ? 'Przeciągnij po zdjęciu — kadr zapisze się od razu' : 'Kadrowanie działa dla JPG, PNG i WebP'}
            >
              Kadruj szybko
            </button>
            <button
              className="key"
              onClick={() => startCrop('precise')}
              disabled={!type || !natural}
              title={type ? 'Ustaw każdy bok kadru i zatwierdź' : 'Kadrowanie działa dla JPG, PNG i WebP'}
            >
              Kadruj dokładnie
            </button>
            <button
              className="key"
              onClick={() => rotate(false)}
              disabled={!type || !natural || rotating}
              title={type ? 'Obróć w lewo i zapisz' : 'Obracanie działa dla JPG, PNG i WebP'}
              aria-label="Obróć w lewo"
            >
              ↺
            </button>
            <button
              className="key"
              onClick={() => rotate(true)}
              disabled={!type || !natural || rotating}
              title={type ? 'Obróć w prawo i zapisz' : 'Obracanie działa dla JPG, PNG i WebP'}
              aria-label="Obróć w prawo"
            >
              ↻
            </button>
            <button className="key" onClick={onDuplicate} title="Zrób kopię z dopiskiem „-kopia”">
              Duplikuj
            </button>
            <div className="print-group">
              <button className="key" onClick={print} disabled={!natural} title="Drukuj (⌘P)">
                Drukuj
              </button>
              <button
                className="key print-ratio"
                role="switch"
                aria-checked={printKeepRatio}
                onClick={() => onPrintKeepRatioChange(!printKeepRatio)}
                title={printKeepRatio ? 'Drukuje z zachowaniem proporcji' : 'Rozciąga obraz na całą kartkę'}
              >
                <span className="switch" aria-hidden="true" />
                Proporcje
              </button>
            </div>
          </>
        )}
        <button className="key preview-close" onClick={onClose} title="Zamknij (Esc)" aria-label="Zamknij">
          ×
        </button>
      </div>
    </div>
  )
}

function FolderGlyph(): JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 48 40" aria-hidden="true">
      <path d="M2 6a4 4 0 0 1 4-4h12l5 5h19a4 4 0 0 1 4 4v23a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" />
    </svg>
  )
}

interface TileProps {
  entry: FolderEntry
  selected: boolean
  onOpen: (entry: FolderEntry) => void
  onDuplicate: (entry: FolderEntry) => void
  onDelete: (entry: FolderEntry) => void
}

function Tile({ entry, selected, onOpen, onDuplicate, onDelete }: TileProps): JSX.Element {
  const [failed, setFailed] = useState(false)
  const isDir = entry.kind === 'dir'

  // The actions sit beside the tile button, not in it: buttons can't nest.
  return (
    <div className={`tile-wrap${selected ? ' selected' : ''}`}>
      <button
        className={`tile ${isDir ? 'tile-dir' : 'tile-image'}${selected ? ' selected' : ''}`}
        title={entry.name}
        data-path={entry.path}
        onClick={() => onOpen(entry)}
      >
        <span className="thumb">
          {isDir ? (
            <FolderGlyph />
          ) : failed ? (
            <span className="thumb-missing">{entry.name.split('.').pop()?.toUpperCase()}</span>
          ) : (
            <img src={thumbUrl(entry)} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
          )}
        </span>
        <span className="name">{entry.name}</span>
      </button>
      {!isDir && (
        <div className="tile-actions">
          <button onClick={() => onDuplicate(entry)} title="Zrób kopię z dopiskiem „-kopia”" aria-label="Duplikuj">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
              <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
            </svg>
          </button>
          <button onClick={() => onDelete(entry)} title="Przenieś do Kosza" aria-label="Usuń">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.5 4.5h11M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6M6.8 7v4.5M9.2 7v4.5" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

export default function App(): JSX.Element {
  const [listing, setListing] = useState<FolderListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewed, setPreviewed] = useState<FolderEntry | null>(null)
  // The last image looked at, or the entry picked with the arrow keys.
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [printKeepRatio, setPrintKeepRatio] = useState(true)
  const requestRef = useRef(0)
  const gridRef = useRef<HTMLElement>(null)
  const tilesRef = useRef<HTMLDivElement>(null)

  // `refresh` reloads the same folder after a change in it, keeping the scroll position.
  // Resolves to null when the folder can't be read or another navigation took over.
  const navigate = useCallback(async (folderPath: string, refresh = false): Promise<FolderListing | null> => {
    const request = ++requestRef.current
    const result = await window.api.listFolder(folderPath)
    // A slower listing must not overwrite a folder the user has already moved past.
    if (request !== requestRef.current) return null
    if (!result) {
      setError(folderPath)
      return null
    }
    setError(null)
    setListing(result)
    if (!refresh) {
      setSelectedPath(null)
      gridRef.current?.scrollTo({ top: 0 })
    }
    return result
  }, [])

  // An image opened from Finder: show its folder, mark it and open the preview.
  const openFile = useCallback(
    async (file: OpenedFile) => {
      const result = await navigate(file.folder)
      const entry = result?.entries.find((candidate) => candidate.path === file.path)
      if (entry?.kind === 'image') setPreviewed(entry)
    },
    [navigate]
  )

  // Marks the folder just left, so the arrows carry on from there.
  const goUp = useCallback(async () => {
    if (!listing?.parent) return
    const from = listing.path
    if (await navigate(listing.parent)) setSelectedPath(from)
  }, [listing, navigate])

  const goToDesktop = useCallback(async () => {
    navigate(await window.api.getDesktopFolder())
  }, [navigate])

  useEffect(() => {
    const unsubscribe = window.api.onFileOpened(openFile)
    window.api.takeOpenedFile().then(async (file) => {
      if (file) openFile(file)
      else navigate(await window.api.getStartFolder())
    })
    return unsubscribe
  }, [navigate, openFile])

  useEffect(() => {
    if (previewed) setSelectedPath(previewed.path)
  }, [previewed])

  useEffect(() => {
    if (!selectedPath) return
    gridRef.current
      ?.querySelector(`[data-path="${CSS.escape(selectedPath)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [listing, selectedPath])

  const openEntry = useCallback(
    (entry: FolderEntry) => (entry.kind === 'dir' ? navigate(entry.path) : setPreviewed(entry)),
    [navigate]
  )

  // Moves the mark by `step` tiles; with nothing marked yet it lands on the first one.
  const moveSelection = useCallback(
    (step: number) => {
      const entries = listing?.entries ?? []
      if (entries.length === 0) return
      const index = entries.findIndex((entry) => entry.path === selectedPath)
      const next = index < 0 ? 0 : Math.min(Math.max(index + step, 0), entries.length - 1)
      setSelectedPath(entries[next].path)
    },
    [listing, selectedPath]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // The preview handles its own keys.
      if (previewed) return
      const selected = listing?.entries.find((entry) => entry.path === selectedPath)
      const plain = !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
      if ((event.metaKey || event.altKey || event.shiftKey) && event.key === 'ArrowUp') goUp()
      else if (event.shiftKey && event.key === 'ArrowDown') {
        if (selected?.kind === 'dir') navigate(selected.path)
      } else if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        // Same shortcut as Finder's Go → Desktop.
        goToDesktop()
      } else if (plain && event.key === 'Enter') {
        if (selected) openEntry(selected)
      } else if (plain && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        moveSelection(event.key === 'ArrowLeft' ? -1 : 1)
      } else if (plain && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        const tiles = tilesRef.current
        const columns = tiles ? getComputedStyle(tiles).gridTemplateColumns.split(' ').length : 1
        moveSelection(event.key === 'ArrowUp' ? -columns : columns)
      } else return
      // Keeps the grid from scrolling and a focused tile from clicking itself.
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [previewed, listing, selectedPath, navigate, goUp, goToDesktop, openEntry, moveSelection])
  const closePreview = useCallback(() => setPreviewed(null), [])

  const duplicatePreviewed = useCallback(async () => {
    if (!previewed) return
    try {
      const copy = await window.api.duplicateImage(previewed.path)
      setPreviewed(copy)
      if (listing) navigate(listing.path, true)
    } catch {
      window.alert(`Nie udało się zduplikować: ${previewed.name}`)
    }
  }, [previewed, listing, navigate])

  const deletePreviewed = useCallback(async () => {
    if (!previewed) return
    try {
      await window.api.trashImage(previewed.path)
      setPreviewed(null)
      if (listing) navigate(listing.path, true)
    } catch {
      window.alert(`Nie udało się usunąć: ${previewed.name}`)
    }
  }, [previewed, listing, navigate])

  // From a tile's corner: the copy gets the mark, so it is easy to spot in the grid.
  const duplicateEntry = useCallback(
    async (entry: FolderEntry) => {
      try {
        const copy = await window.api.duplicateImage(entry.path)
        if (listing && (await navigate(listing.path, true))) setSelectedPath(copy.path)
      } catch {
        window.alert(`Nie udało się zduplikować: ${entry.name}`)
      }
    },
    [listing, navigate]
  )

  const deleteEntry = useCallback(
    async (entry: FolderEntry) => {
      try {
        await window.api.trashImage(entry.path)
        if (listing) navigate(listing.path, true)
      } catch {
        window.alert(`Nie udało się usunąć: ${entry.name}`)
      }
    },
    [listing, navigate]
  )

  // The original goes to the Trash, so a bad crop can be taken back from Finder.
  const cropPreviewed = useCallback(
    async (rect: CropRect, type: string) => {
      if (!previewed) return
      try {
        const cropped = await window.api.replaceImage(previewed.path, await cropImage(previewed, rect, type))
        setPreviewed(cropped)
        if (listing) navigate(listing.path, true)
      } catch {
        window.alert(`Nie udało się wykadrować: ${previewed.name}`)
      }
    },
    [previewed, listing, navigate]
  )

  // Saved the same way as a crop: the original goes to the Trash.
  const rotatePreviewed = useCallback(
    async (clockwise: boolean, type: string) => {
      if (!previewed) return
      try {
        const rotated = await window.api.replaceImage(previewed.path, await rotateImage(previewed, clockwise, type))
        setPreviewed(rotated)
        if (listing) navigate(listing.path, true)
      } catch {
        window.alert(`Nie udało się obrócić: ${previewed.name}`)
      }
    },
    [previewed, listing, navigate]
  )

  const images = listing?.entries.filter((entry) => entry.kind === 'image') ?? []
  const imageCount = images.length
  const previewedIndex = previewed ? images.findIndex((entry) => entry.path === previewed.path) : -1
  const prevImage = previewedIndex > 0 ? images[previewedIndex - 1] : undefined
  const nextImage = previewedIndex >= 0 ? images[previewedIndex + 1] : undefined

  return (
    <div className="app">
      <header className="bar">
        <button
          className="key"
          onClick={goUp}
          disabled={!listing?.parent}
          title="Folder wyżej (⌘↑)"
          aria-label="Folder wyżej"
        >
          ↑
        </button>
        <button className="key key-desktop" onClick={goToDesktop} title="Pulpit (⌘⇧D)">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
            <path d="M5.5 14h5M8 11.5V14" />
          </svg>
          Pulpit
        </button>
        <nav className="crumbs">
          {listing?.crumbs.map((crumb, index) => (
            <span key={crumb.path} className="crumb">
              {index > 1 && <span className="crumb-sep">/</span>}
              <button
                onClick={() => navigate(crumb.path)}
                aria-current={index === listing.crumbs.length - 1 ? 'page' : undefined}
              >
                {index === 0 ? '⌂' : crumb.name}
              </button>
            </span>
          ))}
        </nav>
        <button
          className="key"
          onClick={() => listing && window.api.revealFolder(listing.path)}
          disabled={!listing}
          title="Otwórz bieżący folder w Finderze"
        >
          Otwórz folder
        </button>
      </header>

      <main className="grid-scroll" ref={gridRef}>
        {error && <p className="notice">Nie można otworzyć folderu: {error}</p>}
        {listing && listing.entries.length === 0 && !error && <p className="notice">Brak zdjęć i folderów</p>}
        <div className="grid" ref={tilesRef} style={{ ['--tile' as string]: `${TILE_SIZE}px` }}>
          {listing?.entries.map((entry) => (
            <Tile
              key={entry.path}
              entry={entry}
              selected={entry.path === selectedPath}
              onOpen={openEntry}
              onDuplicate={duplicateEntry}
              onDelete={deleteEntry}
            />
          ))}
        </div>
      </main>

      <footer className="status">
        {listing && (
          <>
            <span>{listing.path}</span>
            <span>{imageCount} zdjęć</span>
          </>
        )}
      </footer>

      {previewed && (
        <Preview
          // mtime in the key, so a cropped file reopens fresh: fitted zoom, no crop mode.
          key={`${previewed.path}:${previewed.mtimeMs}`}
          entry={previewed}
          onClose={closePreview}
          onDuplicate={duplicatePreviewed}
          onDelete={deletePreviewed}
          onCrop={cropPreviewed}
          onRotate={rotatePreviewed}
          onPrev={prevImage && (() => setPreviewed(prevImage))}
          onNext={nextImage && (() => setPreviewed(nextImage))}
          printKeepRatio={printKeepRatio}
          onPrintKeepRatioChange={setPrintKeepRatio}
        />
      )}
    </div>
  )
}
