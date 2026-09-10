import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
export async function loadPdf(bytes) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false })
  try {
    return await task.promise
  } catch (error) {
    await task.destroy()
    throw error
  }
}
export { pdfjs }
