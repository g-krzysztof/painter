import { nativeImage, net, protocol, type NativeImage } from 'electron'
import { extname } from 'path'
import { pathToFileURL } from 'url'
import { IMAGE_EXTENSIONS, THUMB_SCHEME } from '../shared/types'

// Must run before app 'ready' — Chromium only accepts scheme privileges then.
export function registerThumbnailScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: THUMB_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

async function makeThumbnail(filePath: string, size: number): Promise<NativeImage> {
  // Quick Look / Windows Shell decode at the target size, which is far cheaper
  // than loading a full-resolution photo, and they also cover HEIC and SVG.
  if (process.platform === 'darwin' || process.platform === 'win32') {
    try {
      const image = await nativeImage.createThumbnailFromPath(filePath, { width: size, height: size })
      if (!image.isEmpty()) return image
    } catch {
      // Fall through to a full decode.
    }
  }
  const image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) return image
  const { width, height } = image.getSize()
  return width >= height ? image.resize({ width: Math.min(size, width) }) : image.resize({ height: Math.min(size, height) })
}

// Formats Chromium decodes itself, so the preview can get the original file untouched.
const BROWSER_FORMATS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'])

async function serveFullImage(filePath: string): Promise<Response> {
  if (BROWSER_FORMATS.has(extname(filePath).toLowerCase())) {
    return net.fetch(pathToFileURL(filePath).toString())
  }
  // HEIC/TIFF: decode to PNG at full resolution.
  let image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) image = await makeThumbnail(filePath, 4096)
  if (image.isEmpty()) return new Response(null, { status: 404 })
  return new Response(new Uint8Array(image.toPNG()), { headers: { 'content-type': 'image/png' } })
}

// thumb://local/?p=<absolute path>&s=<pixel size>
// thumb://local/?p=<absolute path>&full=1  — original resolution, for the preview
export function registerThumbnailProtocol(): void {
  protocol.handle(THUMB_SCHEME, async (request) => {
    const url = new URL(request.url)
    const filePath = url.searchParams.get('p')
    const size = Math.min(Math.max(Number(url.searchParams.get('s')) || 320, 32), 1024)

    // Only ever serve images — the renderer must not be able to read arbitrary files.
    if (!filePath || !IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) {
      return new Response(null, { status: 400 })
    }

    if (url.searchParams.has('full')) return serveFullImage(filePath)

    const image = await makeThumbnail(filePath, size)
    if (image.isEmpty()) return new Response(null, { status: 404 })

    return new Response(new Uint8Array(image.toPNG()), {
      headers: { 'content-type': 'image/png', 'cache-control': 'max-age=31536000, immutable' }
    })
  })
}
