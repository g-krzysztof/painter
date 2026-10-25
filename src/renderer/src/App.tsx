import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { THUMB_SCHEME, type FolderEntry, type FolderListing } from '../../shared/types'

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

const ZOOM_STEP = 1.25
// Zoom is counted in whole steps from the fit-to-window size, so stepping back always lands exactly on it.
const MIN_ZOOM_STEP = -10
const MAX_ZOOM_STEP = 15

interface PreviewProps {
  entry: FolderEntry
  onClose: () => void
  onDuplicate: () => void
  onDelete: () => void
  // Undefined at either end of the folder.
  onPrev?: () => void
  onNext?: () => void
}

function Preview({ entry, onClose, onDuplicate, onDelete, onPrev, onNext }: PreviewProps): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  // 0 = as large as fits on screen; each step is ×1.25 or ÷1.25 from there.
  const [zoomStep, setZoomStep] = useState(0)
  const [fit, setFit] = useState(1)
  const prevScaleRef = useRef<number | null>(null)

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
      else if (event.key === '+' || event.key === '=') zoomIn()
      else if (event.key === '-') zoomOut()
      else if (event.key === 'ArrowLeft' && !event.metaKey && !event.altKey) onPrev?.()
      else if (event.key === 'ArrowRight' && !event.metaKey && !event.altKey) onNext?.()
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, zoomIn, zoomOut, onPrev, onNext])

  return (
    <div className="preview" role="dialog" aria-label={entry.name}>
      <div className="preview-stage" ref={stageRef}>
        <div className="preview-canvas">
          <img
            src={fullUrl(entry)}
            alt={entry.name}
            draggable={false}
            onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            style={natural ? { width: natural.width * scale, height: natural.height * scale } : { visibility: 'hidden' }}
          />
        </div>
      </div>
      <div className="preview-info">
        <div className="preview-name" title={entry.name}>
          {entry.name}
        </div>
        <div className="preview-meta">
          {formatSize(entry.size)}
          {natural && ` · ${natural.width} × ${natural.height} px`}
        </div>
      </div>
      <button className="key preview-nav preview-prev" onClick={onPrev} disabled={!onPrev} title="Poprzednie (←)" aria-label="Poprzednie">
        ‹
      </button>
      <button className="key preview-nav preview-next" onClick={onNext} disabled={!onNext} title="Następne (→)" aria-label="Następne">
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
        <button className="key" onClick={onDuplicate} title="Zrób kopię z dopiskiem „-kopia”">
          Duplikuj
        </button>
        <button className="key" onClick={onDelete} title="Przenieś do Kosza">
          Usuń
        </button>
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

function Tile({ entry, onOpen }: { entry: FolderEntry; onOpen: (entry: FolderEntry) => void }): JSX.Element {
  const [failed, setFailed] = useState(false)
  const isDir = entry.kind === 'dir'

  return (
    <button
      className={`tile ${isDir ? 'tile-dir' : 'tile-image'}`}
      title={entry.name}
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
  )
}

export default function App(): JSX.Element {
  const [listing, setListing] = useState<FolderListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewed, setPreviewed] = useState<FolderEntry | null>(null)
  const requestRef = useRef(0)
  const gridRef = useRef<HTMLElement>(null)

  // `refresh` reloads the same folder after a change in it, keeping the scroll position.
  const navigate = useCallback(async (folderPath: string, refresh = false) => {
    const request = ++requestRef.current
    const result = await window.api.listFolder(folderPath)
    // A slower listing must not overwrite a folder the user has already moved past.
    if (request !== requestRef.current) return
    if (!result) {
      setError(folderPath)
      return
    }
    setError(null)
    setListing(result)
    if (!refresh) gridRef.current?.scrollTo({ top: 0 })
  }, [])

  const goToDesktop = useCallback(async () => {
    navigate(await window.api.getDesktopFolder())
  }, [navigate])

  useEffect(() => {
    window.api.getStartFolder().then(navigate)
  }, [navigate])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.altKey) && event.key === 'ArrowUp' && listing?.parent) {
        event.preventDefault()
        navigate(listing.parent)
      } else if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        // Same shortcut as Finder's Go → Desktop.
        event.preventDefault()
        goToDesktop()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [listing, navigate, goToDesktop])

  const openEntry = useCallback(
    (entry: FolderEntry) => (entry.kind === 'dir' ? navigate(entry.path) : setPreviewed(entry)),
    [navigate]
  )
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
          onClick={() => listing?.parent && navigate(listing.parent)}
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
        <div className="grid" style={{ ['--tile' as string]: `${TILE_SIZE}px` }}>
          {listing?.entries.map((entry) => <Tile key={entry.path} entry={entry} onOpen={openEntry} />)}
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
          key={previewed.path}
          entry={previewed}
          onClose={closePreview}
          onDuplicate={duplicatePreviewed}
          onDelete={deletePreviewed}
          onPrev={prevImage && (() => setPreviewed(prevImage))}
          onNext={nextImage && (() => setPreviewed(nextImage))}
        />
      )}
    </div>
  )
}
