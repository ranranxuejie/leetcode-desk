import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { BookOpen, CornerDownLeft, Search } from 'lucide-react'
import { useData } from '../lib/data'
import { useFocusTrap } from '../lib/focus'
import { LEVEL_LABEL } from '../lib/utils'

interface Item {
  key: string
  kind: 'problem' | 'section'
  title: string
  sub: string
  no?: string
  docId?: string
  sectionIndex?: number
  level?: string
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { problems, tutorials } = useData()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 焦点陷阱：输入框作为初始焦点；Esc 走 hook（挂在 document 捕获阶段），
  // 所以下面那个 keydown 监听里不再处理 Esc，避免一次按键触发两次 onClose。
  const dialogRef = useFocusTrap(open, onClose, { initialFocus: inputRef })

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
  }, [open])

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      const p0 = problems
        .filter((p) => p.tier === 'P0')
        .slice(0, 6)
        .map((p) => ({
          key: `p-${p.no}`,
          kind: 'problem' as const,
          title: p.title,
          sub: `No.${p.no} · ${LEVEL_LABEL[p.level]} · ${p.tier}`,
          no: p.no,
        }))
      const docs = tutorials.slice(0, 4).map((d) => ({
        key: `d-${d.id}`,
        kind: 'section' as const,
        title: d.title,
        sub: `${d.sections.length} 节 · ${d.group}`,
        docId: d.id,
      }))
      return [...p0, ...docs]
    }

    const matchedProblems = problems
      .filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.no.includes(q) ||
          p.tags.some((tag) => tag.toLowerCase().includes(q)),
      )
      .slice(0, 9)
      .map((p) => ({
        key: `p-${p.no}`,
        kind: 'problem' as const,
        title: p.title,
        sub: `No.${p.no} · ${LEVEL_LABEL[p.level]} · ${p.tier} · ${p.category}`,
        no: p.no,
      }))

    const matchedSections: Item[] = []
    for (const doc of tutorials) {
      for (const section of doc.sections) {
        if (
          section.title.toLowerCase().includes(q) ||
          doc.title.toLowerCase().includes(q)
        ) {
          matchedSections.push({
            key: `s-${doc.id}-${section.index}`,
            kind: 'section',
            title: section.title,
            sub: doc.title,
            docId: doc.id,
            sectionIndex: section.index,
          })
        }
        if (matchedSections.length >= 7) break
      }
      if (matchedSections.length >= 7) break
    }

    return [...matchedProblems, ...matchedSections]
  }, [problems, tutorials, query])

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActive((i) => Math.min(items.length - 1, i + 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((i) => Math.max(0, i - 1))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const item = items[active]
        if (!item) return
        if (item.kind === 'problem' && item.no) {
          navigate(`/problems/${item.no}`)
        } else if (item.docId) {
          navigate(
            `/tutorials/${item.docId}${
              item.sectionIndex !== undefined ? `#sec-${item.sectionIndex}` : ''
            }`,
          )
        }
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, items, navigate, onClose, open])

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    node?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  return createPortal(
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="palette-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* 弹层标题：视觉上是输入框，读屏需要一个能念出来的名字 */}
        <h2 id="palette-title" className="sr-only">
          全局搜索
        </h2>
        <div className="palette__input">
          <Search />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索题号、题目、标签、教程章节…"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="palette__results" ref={listRef}>
          {items.length === 0 ? (
            <div className="palette__empty">没有匹配结果，换个关键词试试。</div>
          ) : (
            items.map((item, index) => (
              <div key={item.key}>
                {index === 0 || items[index - 1].kind !== item.kind ? (
                  <div className="palette__group">
                    {item.kind === 'problem' ? '题目' : '教程章节'}
                  </div>
                ) : null}
                <button
                  className={`palette__item${index === active ? ' active' : ''}`}
                  data-active={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => {
                    if (item.kind === 'problem' && item.no) {
                      navigate(`/problems/${item.no}`)
                    } else if (item.docId) {
                      navigate(
                        `/tutorials/${item.docId}${
                          item.sectionIndex !== undefined
                            ? `#sec-${item.sectionIndex}`
                            : ''
                        }`,
                      )
                    }
                    onClose()
                  }}
                >
                  {item.kind === 'problem' ? (
                    <span className="no">{item.no}</span>
                  ) : (
                    <BookOpen />
                  )}
                  <span className="title">{item.title}</span>
                  <span className="palette__sub">{item.sub}</span>
                  {index === active ? <CornerDownLeft className="palette__enter" /> : null}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
