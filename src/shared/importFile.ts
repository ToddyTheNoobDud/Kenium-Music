export const IMPORT_FILE_MAX_BYTES = 1024 * 1024
export const IMPORT_FILE_TIMEOUT_MS = 10_000

export class ImportFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportFileError'
  }
}

export function validateImportFileSize(
  size: number | undefined,
  maxBytes = IMPORT_FILE_MAX_BYTES
): void {
  if (size !== undefined && Number.isFinite(size) && size > maxBytes) {
    throw new ImportFileError(
      `The file is too large. Maximum size is ${formatBytes(maxBytes)}.`
    )
  }
}

export function decodeImportFileBytes(
  chunks: readonly Uint8Array[],
  maxBytes = IMPORT_FILE_MAX_BYTES
): string {
  const totalBytes = chunks.reduce(
    (total, chunk) => total + chunk.byteLength,
    0
  )
  validateImportFileSize(totalBytes, maxBytes)

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export async function fetchImportFile(
  attachment: { url: string; size?: number },
  maxBytes = IMPORT_FILE_MAX_BYTES
): Promise<string> {
  validateImportFileSize(attachment.size, maxBytes)

  let response: Response
  try {
    response = await fetch(attachment.url, {
      signal: AbortSignal.timeout(IMPORT_FILE_TIMEOUT_MS)
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new ImportFileError(
        'The file download timed out. Please try again.'
      )
    }
    throw new ImportFileError('The file could not be downloaded.')
  }

  if (!response.ok) {
    throw new ImportFileError(
      `The file download failed (HTTP ${response.status}).`
    )
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const declaredSize = Number(contentLength)
    if (Number.isFinite(declaredSize) && declaredSize >= 0) {
      validateImportFileSize(declaredSize, maxBytes)
    }
  }

  if (!response.body) {
    throw new ImportFileError('The file response did not contain a body.')
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      totalBytes += value.byteLength
      try {
        validateImportFileSize(totalBytes, maxBytes)
      } catch (error) {
        await reader.cancel()
        throw error
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof ImportFileError) {
      throw error
    }
    throw new ImportFileError('The file download was interrupted.')
  } finally {
    reader.releaseLock()
  }

  return decodeImportFileBytes(chunks, maxBytes)
}

function formatBytes(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) {
    return `${bytes / (1024 * 1024)} MiB`
  }
  return `${bytes} bytes`
}
