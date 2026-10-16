import type { WordbookEntry } from '../../../preload/api'

/** 表示中のフォルダ。ALL はすべて、NONE は未分類 */
const ALL = Symbol('all')
const NONE = Symbol('none')
type Filter = typeof ALL | typeof NONE | string

/**
 * 単語帳タブ。フォルダで分けて見る・選んでまとめて移す/消す。
 * 言葉はドラッグしてフォルダに落としても移せる。
 */
export class WordbookView {
  private folders: string[] = []
  private entries: WordbookEntry[] = []
  private filter: Filter = ALL
  private selecting = false
  private selected = new Set<string>()
  private readonly foldersEl: HTMLElement
  private readonly toolsEl: HTMLElement
  private readonly listEl: HTMLOListElement
  private readonly barEl: HTMLElement
  private readonly errorEl: HTMLElement

  constructor(root: HTMLElement) {
    this.foldersEl = el('div', 'wb-folders')
    this.toolsEl = el('div', 'wb-tools')
    this.errorEl = el('p', 'wb-error')
    this.listEl = el('ol', 'wb-list') as HTMLOListElement
    this.listEl.dataset.empty = 'キープした言葉が、意味と一緒にここに残ります'
    this.barEl = el('div', 'wb-bar')
    root.append(this.foldersEl, this.toolsEl, this.errorEl, this.listEl, this.barEl)
  }

  async render(): Promise<void> {
    const data = await window.wordbook.list()
    this.folders = data.folders
    this.entries = data.entries
    if (typeof this.filter === 'string' && !this.folders.includes(this.filter)) this.filter = ALL
    // 消えた言葉は選択から外す
    const words = new Set(this.entries.map((e) => e.word))
    for (const w of this.selected) if (!words.has(w)) this.selected.delete(w)
    this.draw()
  }

  private visible(): WordbookEntry[] {
    if (this.filter === ALL) return this.entries
    if (this.filter === NONE) return this.entries.filter((e) => !e.folder)
    return this.entries.filter((e) => e.folder === this.filter)
  }

  private draw(): void {
    this.drawFolders()
    this.drawTools()
    this.drawList()
    this.drawBar()
  }

  private drawFolders(): void {
    const count = (f: Filter) =>
      f === ALL ? this.entries.length : this.entries.filter((e) => (f === NONE ? !e.folder : e.folder === f)).length
    const tab = (f: Filter, label: string) => {
      const b = el('button', `wb-folder ${this.filter === f ? 'active' : ''}`) as HTMLButtonElement
      b.append(label, el('span', 'n', String(count(f))))
      b.addEventListener('click', () => {
        this.filter = f
        this.draw()
      })
      // 言葉をドラッグして落とすと、そのフォルダに移す
      if (f !== ALL) {
        b.addEventListener('dragover', (e) => {
          e.preventDefault()
          b.classList.add('drop')
        })
        b.addEventListener('dragleave', () => b.classList.remove('drop'))
        b.addEventListener('drop', (e) => {
          e.preventDefault()
          b.classList.remove('drop')
          const word = e.dataTransfer?.getData('text/plain')
          if (!word) return
          const words = this.selected.has(word) ? [...this.selected] : [word]
          void this.run(() => window.wordbook.move(words, f === NONE ? null : f))
        })
      }
      return b
    }
    const add = el('button', 'wb-folder add', '＋ フォルダ') as HTMLButtonElement
    add.addEventListener('click', () =>
      add.replaceWith(
        nameInput(
          '新しいフォルダの名前',
          '',
          (name) => this.run(() => window.wordbook.createFolder(name)),
          () => this.draw()
        )
      )
    )
    this.foldersEl.replaceChildren(tab(ALL, 'すべて'), tab(NONE, '未分類'), ...this.folders.map((f) => tab(f, f)), add)
  }

  private drawTools(): void {
    const left = el('span', 'note', `${this.visible().length}語`)
    const items: HTMLElement[] = [left, el('span', 'spacer')]
    const folder = this.filter
    if (typeof folder === 'string') {
      const rename = button('名前を変える', () =>
        rename.replaceWith(
          nameInput(
            'フォルダの名前',
            folder,
            async (name) => {
              await this.run(() => window.wordbook.renameFolder(folder, name))
              this.filter = name
              this.draw()
            },
            () => this.draw()
          )
        )
      )
      const remove = confirmButton('フォルダを消す', '中の言葉は未分類に戻ります。消す？', () =>
        this.run(() => window.wordbook.deleteFolder(folder))
      )
      items.push(rename, remove)
    }
    const select = button(this.selecting ? '選ぶのをやめる' : '選ぶ', () => {
      this.selecting = !this.selecting
      this.selected.clear()
      this.draw()
    })
    select.classList.toggle('active', this.selecting)
    items.push(select)
    this.toolsEl.replaceChildren(...items)
  }

  private drawList(): void {
    this.listEl.classList.toggle('selecting', this.selecting)
    this.listEl.replaceChildren(...this.visible().map((e) => this.item(e)))
  }

  private item(e: WordbookEntry): HTMLLIElement {
    const li = el('li') as HTMLLIElement
    li.draggable = true
    li.addEventListener('dragstart', (ev) => ev.dataTransfer?.setData('text/plain', e.word))
    li.classList.toggle('checked', this.selected.has(e.word))
    if (this.selecting) {
      const box = el('input') as HTMLInputElement
      box.type = 'checkbox'
      box.checked = this.selected.has(e.word)
      box.tabIndex = -1
      li.append(box)
      li.addEventListener('click', () => {
        if (this.selected.has(e.word)) this.selected.delete(e.word)
        else this.selected.add(e.word)
        this.drawList()
        this.drawBar()
      })
    }
    const body = el('div', 'body')
    const head = el('div', 'head')
    head.append(el('strong', '', e.word))
    if (e.reading) head.append(el('span', 'reading', e.reading))
    if (this.filter === ALL && e.folder) head.append(el('span', 'tag', e.folder))
    const meaning = el('div', 'meaning', e.meaning ?? '（意味はまだありません）')
    // 保存した会話のうち、その言葉が出てくる発言を見せる
    const lines = e.context.split('\n')
    const line = lines.find((l) => l.includes(e.word)) ?? lines[lines.length - 1] ?? ''
    const ctx = el('span', 'ctx', `${new Date(e.savedAt).toLocaleString('ja-JP')} ・ ${line}`)
    body.append(head, meaning, ctx)
    li.append(body)
    if (!this.selecting) {
      const remove = el('button', 'remove', '×') as HTMLButtonElement
      remove.title = '単語帳から削除'
      remove.addEventListener('click', () => void this.run(() => window.wordbook.remove([e.word])))
      li.append(remove)
    }
    return li
  }

  /** 選んでいるときの下の帯: まとめて移す・消す */
  private drawBar(): void {
    this.barEl.hidden = !this.selecting
    if (!this.selecting) return
    const words = [...this.selected]
    const shown = this.visible().map((e) => e.word)
    const allShown = shown.length > 0 && shown.every((w) => this.selected.has(w))
    const toggleAll = button(allShown ? 'すべて外す' : 'すべて選ぶ', () => {
      for (const w of shown)
        if (allShown) this.selected.delete(w)
        else this.selected.add(w)
      this.drawList()
      this.drawBar()
    })
    const move = el('select') as HTMLSelectElement
    move.disabled = words.length === 0
    move.append(new Option('移動…', ''), new Option('未分類', '\u0000none'))
    for (const f of this.folders) move.append(new Option(f, f))
    move.append(new Option('＋ 新しいフォルダ…', '\u0000new'))
    move.addEventListener('change', () => {
      const v = move.value
      if (v === '\u0000new') {
        move.replaceWith(
          nameInput(
            '新しいフォルダの名前',
            '',
            (name) => this.run(() => window.wordbook.move(words, name)),
            () => this.drawBar()
          )
        )
      } else if (v) {
        void this.run(() => window.wordbook.move(words, v === '\u0000none' ? null : v))
      }
    })
    const remove = confirmButton('削除', `${words.length}語を消す？`, () =>
      this.run(() => window.wordbook.remove(words))
    )
    remove.classList.add('danger')
    remove.disabled = words.length === 0
    this.barEl.replaceChildren(
      el('span', 'note', `${words.length}語を選択中`),
      el('span', 'spacer'),
      toggleAll,
      move,
      remove
    )
  }

  /** 変更してから描き直す。失敗したら理由を出す */
  private async run(action: () => Promise<void>): Promise<void> {
    this.errorEl.textContent = ''
    try {
      await action()
    } catch (err) {
      this.errorEl.textContent = (err instanceof Error ? err.message : String(err)).replace(/^.*Error: /, '')
    }
    await this.render()
  }
}

function el(tag: string, className = '', text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (className.trim()) e.className = className.trim().replace(/\s+/g, ' ')
  if (text !== undefined) e.textContent = text
  return e
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', '', label) as HTMLButtonElement
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

/** 1回目で確認の文に変わり、もう一度押すと実行する（3秒で元に戻る） */
function confirmButton(label: string, ask: string, onConfirm: () => void): HTMLButtonElement {
  let armed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const b = button(label, () => {
    if (armed) {
      clearTimeout(timer)
      onConfirm()
      return
    }
    armed = true
    b.textContent = ask
    b.classList.add('armed')
    timer = setTimeout(() => {
      armed = false
      b.textContent = label
      b.classList.remove('armed')
    }, 3000)
  })
  return b
}

/** その場で名前を入れる欄。Enter で決定、Esc か欄の外で取り消し */
function nameInput(placeholder: string, value: string, onSubmit: (name: string) => void, onCancel: () => void) {
  const input = el('input', 'wb-name') as HTMLInputElement
  input.placeholder = placeholder
  input.value = value
  let done = false
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return
    if (e.key === 'Enter' && input.value.trim()) {
      done = true
      onSubmit(input.value.trim())
    } else if (e.key === 'Escape') {
      done = true
      onCancel()
    }
  })
  input.addEventListener('blur', () => {
    if (!done) onCancel()
  })
  queueMicrotask(() => {
    input.focus()
    input.select()
  })
  return input
}
