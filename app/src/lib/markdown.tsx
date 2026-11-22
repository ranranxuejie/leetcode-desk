import { useEffect, useMemo, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'

marked.setOptions({ gfm: true, breaks: false })

const PURIFY = {
  ADD_ATTR: ['target', 'rel', 'class'],
  ADD_TAGS: ['details', 'summary'],
}

function decorate(root: HTMLElement) {
  root.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.copy-code')) return
    // 先把正文取下来：按钮 append 到 pre 里之后，pre.textContent 会连按钮自己的「复制」一起带上
    const source = pre.querySelector('code')?.textContent ?? pre.textContent ?? ''
    const btn = document.createElement('button')
    btn.className = 'copy-code'
    btn.type = 'button'
    btn.textContent = '复制'
    btn.setAttribute('aria-label', '复制这段代码')
    btn.addEventListener('click', () => {
      void navigator.clipboard.writeText(source).then(() => {
        btn.textContent = '已复制'
        // 只给样式用的状态标记：复制成功后按钮短暂转成成功色
        btn.dataset.state = 'copied'
        window.setTimeout(() => {
          btn.textContent = '复制'
          delete btn.dataset.state
        }, 1400)
      })
    })
    pre.appendChild(btn)
  })
  root.querySelectorAll('pre code').forEach((el) => {
    if (el.classList.contains('hljs')) return
    try {
      hljs.highlightElement(el as HTMLElement)
    } catch {
      // 忽略未知语言的着色失败
    }
  })
  root.querySelectorAll('a').forEach((a) => {
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noreferrer')
  })
}

export function Markdown({
  markdown,
  className = '',
}: {
  markdown: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => {
    const raw = marked.parse(markdown) as string
    return DOMPurify.sanitize(raw, PURIFY)
  }, [markdown])

  useEffect(() => {
    if (ref.current) decorate(ref.current)
  }, [html])

  return (
    <div
      ref={ref}
      className={`prose ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export function StatementHtml({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const clean = useMemo(() => DOMPurify.sanitize(html, PURIFY), [html])

  useEffect(() => {
    if (!ref.current) return
    decorate(ref.current)
    ref.current.querySelectorAll('img').forEach((img) => {
      img.setAttribute('loading', 'lazy')
    })
  }, [clean])

  return (
    <div
      ref={ref}
      className="prose prose--statement"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
