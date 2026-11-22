import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpen, Check } from 'lucide-react'
import { useData } from '../lib/data'
import { useProgress } from '../lib/progress'
import { Markdown } from '../lib/markdown'
import { LevelBadge } from '../components/ui'

function stripFirstHeading(markdown: string): string {
  // 结尾用 (\r?\n|$) 兼容「整篇只有一个标题」的文档，否则标题会在页内重复出现一次
  return markdown.replace(/^\s*#{1,2}\s+.*(?:\r?\n|$)/, '')
}

export function TutorialReader() {
  const { id } = useParams()
  const { tutorials, byDoc, byNo } = useData()
  const { data, toggleReadDoc } = useProgress()
  const location = useLocation()
  const doc = id ? byDoc.get(id) : undefined
  const [active, setActive] = useState(-1)
  const [progressPct, setProgressPct] = useState(0)
  const sectionRefs = useRef<Array<HTMLElement | null>>([])

  const index = doc ? tutorials.findIndex((d) => d.id === doc.id) : -1
  const prevDoc = index > 0 ? tutorials[index - 1] : undefined
  const nextDoc = index >= 0 && index < tutorials.length - 1 ? tutorials[index + 1] : undefined
  const read = doc ? data.readDocs.includes(doc.id) : false

  useEffect(() => {
    setActive(-1)
    setProgressPct(0)
  }, [doc?.id])

  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('.main')
    if (!scroller || !doc) return
    const onScroll = () => {
      const max = scroller.scrollHeight - scroller.clientHeight
      setProgressPct(max > 0 ? Math.min(100, (scroller.scrollTop / max) * 100) : 0)
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [doc])

  useEffect(() => {
    if (!doc) return
    const scroller = document.querySelector<HTMLElement>('.main')
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          const idx = Number((entry.target as HTMLElement).dataset.section)
          if (!Number.isNaN(idx)) setActive(idx)
        })
      },
      { root: scroller, rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    )
    sectionRefs.current.forEach((el) => el && observer.observe(el))
    return () => observer.disconnect()
  }, [doc])

  useEffect(() => {
    if (!doc || !location.hash) return
    const target = document.querySelector<HTMLElement>(location.hash)
    if (target) {
      window.setTimeout(() => target.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60)
    }
  }, [doc, location.hash])

  const toc = useMemo(() => {
    if (!doc) return []
    return [{ index: -1, title: '导读' }, ...doc.sections.map((s) => ({ index: s.index, title: s.title }))]
  }, [doc])

  if (!doc) {
    return (
      <div className="page">
        <div className="empty empty--roomy">
          <div className="empty__mark">书</div>
          <h2>找不到这篇教程</h2>
          <p>它可能被改名或移除了。</p>
          <Link className="btn empty__cta" to="/tutorials">
            回书架
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="reader">
      <aside className="reader__toc">
        <div className="reader__toc-label">本篇目录</div>
        {toc.map((item) => (
          <a
            key={item.index}
            className={`toc-item${active === item.index ? ' active' : ''}`}
            href={item.index === -1 ? '#intro' : `#sec-${item.index}`}
            onClick={(event) => {
              event.preventDefault()
              const target =
                item.index === -1
                  ? document.getElementById('intro')
                  : sectionRefs.current[item.index]
              target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
              setActive(item.index)
            }}
          >
            {item.title}
          </a>
        ))}
      </aside>

      <article className="reader__main">
        <div className="reader__progress">
          <span style={{ width: `${progressPct}%` }} />
        </div>

        <header className="reader__head">
          <Link to="/tutorials" className="detail__back">
            <ArrowLeft /> 教程书架
          </Link>
          <h1>{doc.title.replace(/^\d+-/, '')}</h1>
          <div className="reader__head-meta">
            <span>{doc.group}</span>
            <span>·</span>
            <span>{doc.sections.length} 节</span>
            <span>·</span>
            <span>{doc.problemCount} 道题</span>
            <button
              className="btn btn--sm"
              onClick={() => toggleReadDoc(doc.id)}
            >
              {read ? <Check /> : <BookOpen />}
              {read ? '已读' : '标记已读'}
            </button>
          </div>
        </header>

        <section id="intro" data-section="-1" className="reader__intro">
          <Markdown markdown={stripFirstHeading(doc.intro)} />
        </section>

        {doc.sections.map((section) => {
          const problem = section.problemNo ? byNo.get(section.problemNo) : undefined
          return (
            <section
              className="reader__section"
              id={`sec-${section.index}`}
              data-section={section.index}
              key={section.id}
              ref={(el) => {
                sectionRefs.current[section.index] = el
              }}
            >
              <div className="reader__section-head">
                <div>
                  <div className="reader__section-no">
                    {section.kind === 'review' ? 'REVIEW' : 'LESSON'} ·{' '}
                    {String(section.index + 1).padStart(2, '0')}
                  </div>
                  <h2>{section.title}</h2>
                </div>
                <div className="reader__section-actions">
                  {section.level ? <LevelBadge level={section.level} /> : null}
                  {problem ? (
                    <Link className="btn btn--sm" to={`/problems/${problem.no}`}>
                      去练习 <ArrowRight />
                    </Link>
                  ) : null}
                </div>
              </div>
              <Markdown markdown={stripFirstHeading(section.markdown)} />
            </section>
          )
        })}

        <nav className="reader__nav">
          {prevDoc ? (
            <Link to={`/tutorials/${prevDoc.id}`}>
              <span>上一篇</span>
              <strong>{prevDoc.title.replace(/^\d+-/, '')}</strong>
            </Link>
          ) : (
            <span />
          )}
          {nextDoc ? (
            <Link to={`/tutorials/${nextDoc.id}`} className="right">
              <span>下一篇</span>
              <strong>{nextDoc.title.replace(/^\d+-/, '')}</strong>
            </Link>
          ) : null}
        </nav>
      </article>
    </div>
  )
}
