let opening
function database() {
  if (!opening)
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open('plantgrowth-recorder', 1)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('projects', { keyPath: 'id' })
        db.createObjectStore('templates', { keyPath: 'id' })
        db.createObjectStore('settings')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        opening = null
        reject(request.error)
      }
      request.onblocked = () => {
        opening = null
        reject(new Error('请关闭其他旧版本标签页，再重新打开。'))
      }
    })
  return opening
}
async function transact(store, mode, action) {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode)
    const request = action(transaction.objectStore(store))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onerror = () => reject(transaction.error || request.error)
    transaction.onabort = () => reject(transaction.error || new Error('保存被中断。'))
  })
}
export const listProjects = () => transact('projects', 'readonly', (s) => s.getAll())
export const saveProject = (p) =>
  transact('projects', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(p))))
export const listTemplates = () => transact('templates', 'readonly', (s) => s.getAll())
export const saveTemplate = (t) =>
  transact('templates', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(t))))
export const deleteTemplate = (id) => transact('templates', 'readwrite', (s) => s.delete(id))
export const getSetting = (key) => transact('settings', 'readonly', (s) => s.get(key))
export const setSetting = (key, value) =>
  transact('settings', 'readwrite', (s) => s.put(value, key))
export async function storageInfo() {
  const estimate = (await navigator.storage?.estimate?.()) || {}
  return { ...estimate, persisted: (await navigator.storage?.persisted?.()) || false }
}
export const requestPersistence = () => navigator.storage?.persist?.() || Promise.resolve(false)
