import { buildDocument } from './pdf.js'
let queue = Promise.resolve()
self.onmessage = ({ data }) => {
  queue = queue
    .catch(() => {})
    .then(async () => {
      try {
        const result = await buildDocument(data.project, {
          ...data.options,
          progress: (message, percent) =>
            self.postMessage({ id: data.id, progress: { message, percent } }),
        })
        self.postMessage({ id: data.id, result }, [result.bytes.buffer])
      } catch (error) {
        self.postMessage({ id: data.id, error: error.message || 'PDF 生成失败。' })
      }
    })
}
