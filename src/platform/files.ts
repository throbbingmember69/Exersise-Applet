// Getting exports (backups, CSVs) off the phone: the Android share sheet when it can take files
// (Drive, email, Files), else a plain download. Reading a chosen file back for restore.

export interface ExportFile {
  fileName: string
  mimeType: string
  text: string
}

export type SaveResult = 'shared' | 'downloaded' | 'cancelled' | 'failed'

/** Offer the file through the share sheet when supported, else download it. */
export async function saveOrShare(
  file: ExportFile,
  opts: { preferShare?: boolean } = {},
  nav: Navigator = navigator,
  doc: Document = document,
): Promise<SaveResult> {
  const blob = new Blob([file.text], { type: file.mimeType })
  if (
    opts.preferShare !== false &&
    typeof nav.canShare === 'function' &&
    typeof File !== 'undefined'
  ) {
    const shareable = new File([blob], file.fileName, { type: file.mimeType })
    if (nav.canShare({ files: [shareable] })) {
      try {
        await nav.share({ files: [shareable], title: file.fileName })
        return 'shared'
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
        // Fall through to a download.
      }
    }
  }
  return download(blob, file.fileName, doc)
}

export function download(blob: Blob, fileName: string, doc: Document = document): SaveResult {
  try {
    const url = URL.createObjectURL(blob)
    const a = doc.createElement('a')
    a.href = url
    a.download = fileName
    a.rel = 'noopener'
    doc.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return 'downloaded'
  } catch {
    return 'failed'
  }
}

/** Read a user-chosen file as text (for backup restore). */
export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}
