import { uid } from './model.js'
export function download(data, name, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
export function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('文件读取失败，请重新选择。'))
    reader.readAsDataURL(file)
  })
}
export function dataBytes(data) {
  const raw = atob(data.slice(data.indexOf(',') + 1))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}
async function bitmap(source) {
  try {
    return await createImageBitmap(
      source instanceof Blob ? source : await (await fetch(source)).blob(),
    )
  } catch {
    throw new Error('图片无法解码，请选择有效的 JPG、PNG 或 WebP 图片。')
  }
}
export async function importPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error(`${file.name}：仅支持 JPG、PNG、WebP。`)
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name}：单张图片不能超过 20 MB。`)
  const image = await bitmap(file)
  try {
    if (image.width * image.height > 50e6) throw new Error('图片超过 5000 万像素，请缩小后重试。')
    const scale = Math.min(1, 2400 / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return {
      id: uid(),
      name: file.name,
      caption: '',
      width: canvas.width,
      height: canvas.height,
      data: canvas.toDataURL('image/jpeg', 0.9),
    }
  } finally {
    image.close()
  }
}
export async function transformPhoto(photo, rotation = 0, crop = null) {
  const img = await bitmap(photo.data)
  try {
    const c = crop || { x: 0, y: 0, width: 100, height: 100 }
    const x = (img.width * c.x) / 100,
      y = (img.height * c.y) / 100
    const width = Math.max(1, (img.width * c.width) / 100),
      height = Math.max(1, (img.height * c.height) / 100)
    const canvas = document.createElement('canvas')
    const turn = Math.abs(rotation) % 180 === 90
    canvas.width = Math.round(turn ? height : width)
    canvas.height = Math.round(turn ? width : height)
    const ctx = canvas.getContext('2d')
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.drawImage(img, x, y, width, height, -width / 2, -height / 2, width, height)
    return {
      ...photo,
      data: canvas.toDataURL('image/jpeg', 0.93),
      width: canvas.width,
      height: canvas.height,
    }
  } finally {
    img.close()
  }
}
export function formatBytes(bytes = 0) {
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
