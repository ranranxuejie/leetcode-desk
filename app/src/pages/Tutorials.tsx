import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Check, Search } from 'lucide-react'
import { useData } from '../lib/data'
import { useProgress } from '../lib/progress'
import type { TutorialDoc } from '../lib/types'

const GROUP_ORDER = [
  '基础',
  '第一册 · 华为核心 39 题',
  '第二册 · 专题全覆盖',
  '第三册 · 精讲补全',
  '附录',
]

export function Tutorials() {
  const { tutorials } = useData()
  const { data } = useProgress()
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? tutorials.filter(
          (doc) =>
            doc.title.toLowerCase().includes(q) ||
            doc.summary.toLowerCase().includes(q) ||
            doc.sections.some((s) => s.title.toLowerCase().includes(q)),
        )
      : tutorials
    const map = new Map<string, TutorialDoc[]>()
    filtered.forEach((doc) => {
      const list = map.get(doc.group) ?? []
      list.push(doc)
      map.set(doc.group, list)
    })
    return Array.from(map.entries()).sort(
      (a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]),
    )
  }, [query, tutorials])

  const readCount = tutorials.filter((doc) => data.readDocs.includes(doc.id)).length

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Textbook · 三册 {tutorials.length} 篇</div>
          <h1>教程书架</h1>
          <p>
            第一册华为核心 39 题、第二册 17 个题型专题、第三册把题库剩下的题补齐精讲——
            <strong>365 道题每道都有「精讲（零基础版）」</strong>
            。已读 {readCount} / {tutorials.length} 篇。
          </p>
        </div>
        <div className="field shelf-search">
          <Search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜篇名、章节、题解…"
            aria-label="搜索教程篇目"
          />
        </div>
      </div>

      {groups.map(([group, docs]) => (
        <section className="shelf-group" key={group}>
          <div className="shelf-group__head">
            <div className="shelf-group__title">{group}</div>
            <div className="shelf-group__meta">
              {docs.length} 篇 · {docs.reduce((sum, d) => sum + d.sections.length, 0)} 节
            </div>
          </div>
          <div className="shelf-grid">
            {docs.map((doc, index) => {
              const read = data.readDocs.includes(doc.id)
              const no = doc.id.split('-')[0]
              return (
                <Link
                  to={`/tutorials/${doc.id}`}
                  className="doc-card rise"
                  key={doc.id}
                  data-cursor="阅读"
                  style={{ animationDelay: `${Math.min(index * 0.03, 0.3)}s` }}
                >
                  <div className="doc-card__no">
                    {group === '第二册 · 专题全覆盖'
                      ? 'VOL.2'
                      : group === '第一册 · 华为核心 39 题'
                        ? 'VOL.1'
                        : group === '第三册 · 精讲补全'
                          ? 'VOL.3'
                          : 'BASE'}{' '}
                    · {no}
                  </div>
                  <h2>{doc.title.replace(/^\d+-/, '')}</h2>
                  <p>{doc.summary || '打开阅读这一篇。'}</p>
                  <div className="doc-card__foot">
                    <span>
                      {doc.sections.length} 节 · {doc.problemCount} 题
                    </span>
                    {read ? (
                      <span className="doc-card__read">
                        <Check /> 已读
                      </span>
                    ) : (
                      <span>未读</span>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      ))}

      {groups.length === 0 ? (
        <div className="empty empty--roomy">
          <div className="empty__mark">书</div>
          <h2>没有匹配的篇目</h2>
          <p>换个关键词，或者清空搜索。</p>
          {query.trim() ? (
            <button className="btn" onClick={() => setQuery('')}>
              清空搜索
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="page-foot">
        <BookOpen style={{ width: 14, height: 14 }} />
        建议顺序：先读 00–03 打底，再按第一册 A → B → C → D 刷 39 道核心题。
      </div>
    </div>
  )
}
