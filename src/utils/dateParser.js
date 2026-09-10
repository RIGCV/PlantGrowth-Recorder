export function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return (
    y >= 1900 &&
    y <= 2199 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  )
}
export function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function parseImageDate(filename) {
  const name = filename.replace(/\.[^.]+$/, '')
  const match = name.match(/(?:^|\D)(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)(?:\D|$)/)
  let date = match ? `${match[1]}-${match[2]}-${match[3]}` : null
  if (!date && /^\d{6}$/.test(name))
    date = `20${name.slice(0, 2)}-${name.slice(2, 4)}-${name.slice(4, 6)}`
  return isValidDate(date) ? { code: name, date } : null
}
