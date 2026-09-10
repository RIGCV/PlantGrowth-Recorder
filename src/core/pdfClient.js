import { compactPhoto } from './files.js'
let worker,
  sequence = 0
const jobs = new Map()
export async function generatePdf(project, options = {}, onProgress) {
  const snapshot = JSON.parse(JSON.stringify(project))
  if (options.quality === 'compact') {
    // WebKit does not expose OffscreenCanvas in workers. Encode on the main
    // thread asynchronously; preserve original photos in the editable attachment.
    const photos = [snapshot.cover.image, ...snapshot.records.flatMap((r) => r.photos)].filter(
      Boolean,
    )
    const compactImages = new Map()
    for (const [i, photo] of photos.entries()) {
      onProgress?.({
        message: `压缩图片 ${i + 1}/${photos.length}`,
        percent: Math.round(((i + 1) / photos.length) * 5),
      })
      if (!compactImages.has(photo.data))
        compactImages.set(photo.data, await compactPhoto(photo.data))
    }
    options = { ...options, compactImages }
  }
  if (!worker) {
    worker = new Worker(new URL('./pdf.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      const job = jobs.get(data.id)
      if (!job) return
      if (data.progress) {
        job.progress?.(data.progress)
        return
      }
      jobs.delete(data.id)
      if (data.error) job.reject(new Error(data.error))
      else job.resolve(data.result)
    }
    worker.onerror = () => {
      for (const job of jobs.values()) job.reject(new Error('PDF 处理线程异常，请重试。'))
      jobs.clear()
      worker.terminate()
      worker = null
    }
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence
    jobs.set(id, { resolve, reject, progress: onProgress })
    worker.postMessage({ id, project: snapshot, options })
  })
}
