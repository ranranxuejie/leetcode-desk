import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useFocusTrap } from '../lib/focus'

/**
 * 快捷键总览：按 `?` 打开（App 层接线），Esc / 点遮罩 / 关闭按钮都能关。
 *
 * 这里只做「展示」：条目必须和代码里真实绑定的一致（App.tsx 的全局键、Problems 的
 * 搜索与 j/k/Enter、CodeLab 的运行与聚焦终端、Terminal 的清空）。改键位时两边一起改，
 * 别再让快捷键散在四个文件里没人知道。
 */

interface ShortcutItem {
  label: string
  /** `'mod'` 是占位符，渲染时按平台换成 ⌘ / Ctrl */
  keys: string[]
  /** keys 是「任选其一」而不是组合键：j / k 这种用 / 隔开，避免误读成同时按 */
  either?: boolean
}

interface ShortcutGroup {
  title: string
  items: ShortcutItem[]
}

const GROUPS: ShortcutGroup[] = [
  {
    title: '全局',
    items: [
      { label: '打开命令面板', keys: ['mod', 'K'] },
      { label: '收起 / 展开侧边栏', keys: ['mod', 'B'] },
      { label: '打开 / 关闭本表', keys: ['?'] },
      { label: '关闭弹层', keys: ['Esc'] },
    ],
  },
  {
    title: '题库',
    items: [
      { label: '聚焦搜索框', keys: ['/'] },
      { label: '上下移动选中行', keys: ['j', 'k'], either: true },
      { label: '打开选中题', keys: ['Enter'] },
    ],
  },
  {
    title: '代码台',
    items: [
      { label: '运行', keys: ['mod', 'Enter'] },
      { label: '聚焦终端', keys: ['mod', '`'] },
      { label: '清空终端', keys: ['Ctrl', 'L'] },
    ],
  },
]

/** mac 上 ⌘，其他平台 Ctrl。优先用 userAgentData.platform（navigator.platform 已废弃）。 */
function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent
  return /mac|iphone|ipad|ipod/i.test(platform)
}

const MOD_KEY = detectMac() ? '⌘' : 'Ctrl'

function keyLabel(key: string): string {
  return key === 'mod' ? MOD_KEY : key
}

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // 焦点陷阱：打开后焦点落在弹层容器（tabIndex=-1，读屏先报标题），Tab 在弹层内循环，
  // Esc 走 hook，关闭后焦点回到按 `?` 之前的位置。
  const dialogRef = useFocusTrap(open, onClose)

  if (!open) return null

  return createPortal(
    <div className="shortcuts-backdrop" onMouseDown={onClose}>
      <div
        className="shortcuts"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="shortcuts__head">
          <h2 id="shortcuts-title">快捷键总览</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭快捷键总览">
            <X />
          </button>
        </div>

        <div className="shortcuts__body">
          <div className="shortcuts__grid">
            {GROUPS.map((group) => (
              <section className="shortcuts__group" key={group.title}>
                <h3 className="shortcuts__group-title">{group.title}</h3>
                <dl className="shortcuts__list">
                  {group.items.map((item) => (
                    <div className="shortcuts__row" key={item.label}>
                      <dt className="shortcuts__label">{item.label}</dt>
                      <dd className="shortcuts__keys">
                        {item.keys.map((key, index) => (
                          <span className="shortcuts__key" key={key}>
                            {index > 0 && item.either ? (
                              <span className="shortcuts__or" aria-hidden="true">
                                /
                              </span>
                            ) : null}
                            <kbd className="kbd">{keyLabel(key)}</kbd>
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>

          <p className="shortcuts__hint">
            按 <kbd className="kbd">Esc</kbd> 或点击遮罩关闭本表。
          </p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
