/**
 * 画面の真ん中に確認を出す。「やめる」か Esc か外側のクリックで false。
 */
export function confirmDialog(message: string, okLabel: string, detail?: string): Promise<boolean> {
  const dialog = document.createElement('dialog')
  dialog.className = 'confirm'
  const title = document.createElement('p')
  title.className = 'confirm-title'
  title.textContent = message
  dialog.append(title)
  if (detail) {
    const d = document.createElement('p')
    d.className = 'confirm-detail'
    d.textContent = detail
    dialog.append(d)
  }
  const actions = document.createElement('div')
  actions.className = 'confirm-actions'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = 'やめる'
  const ok = document.createElement('button')
  ok.type = 'button'
  ok.className = 'danger-fill'
  ok.textContent = okLabel
  actions.append(cancel, ok)
  dialog.append(actions)
  document.body.append(dialog)

  return new Promise((resolve) => {
    const close = (result: boolean) => {
      dialog.close()
      dialog.remove()
      resolve(result)
    }
    cancel.addEventListener('click', () => close(false))
    ok.addEventListener('click', () => close(true))
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault()
      close(false)
    })
    // 外側（暗くなった部分）を押したら取り消し
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) close(false)
    })
    dialog.showModal()
    // うっかり Enter で消さないよう、最初は「やめる」を選んでおく
    cancel.focus()
  })
}
