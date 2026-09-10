let worker,
  sequence = 0
const jobs = new Map()
export function generatePdf(project, options = {}, onProgress) {
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
    worker.postMessage({ id, project: JSON.parse(JSON.stringify(project)), options })
  })
}
