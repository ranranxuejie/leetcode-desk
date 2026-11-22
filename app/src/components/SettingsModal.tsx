import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, RotateCcw, Upload, X } from 'lucide-react'
import { useData } from '../lib/data'
import { clearKey, fetchKeyStatus, saveKey, testKey, type KeyStatus } from '../lib/ai-key'
import { loadUiNumber, saveUiNumber } from '../lib/ui'
import { useFocusTrap } from '../lib/focus'
import { useProgress } from '../lib/progress'
import { setThemeMode, useThemeState, type ThemeMode } from '../lib/theme'
import { useToast } from '../lib/toast'
import { cn, todayKey } from '../lib/utils'
import type { MotionLevel } from '../lib/types'

const THEME_OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  {
    value: 'dark',
    label: '深色',
    hint: '石墨外壳 + 琥珀强调，长时间刷题不刺眼（默认）',
  },
  {
    value: 'light',
    label: '浅色',
    hint: '暖白纸面，适合白天 / 明亮环境；代码区会略压暗一档',
  },
  {
    value: 'auto',
    label: '跟随系统',
    hint: '系统切到深色或浅色时自动跟着变，不需要刷新',
  },
]

const MOTION_OPTIONS: { value: MotionLevel; label: string; hint: string }[] = [
  {
    value: 'full',
    label: '完整',
    hint: '指针聚光、倾斜卡片、磁吸按钮、自定义光标与拖尾',
  },
  {
    value: 'calm',
    label: '克制',
    hint: '只保留功能性动效：转场、滚动触发、数字滚动、指示条',
  },
  {
    value: 'off',
    label: '关闭',
    hint: '全部瞬时完成，等同于系统「减少动态效果」',
  },
]

export function SettingsModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { data, setDailyGoal, setMotion, exportAll, importAll, resetAll } = useProgress()
  const [lastExport, setLastExport] = useState(() => loadUiNumber('lastExport', 0))
  // AI Key：只存服务端，前端只拿到「有没有配 / 尾号」
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyMessage, setKeyMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const { meta } = useData()
  const { toast } = useToast()
  const theme = useThemeState()
  const fileRef = useRef<HTMLInputElement>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  // 每次报错换个 key，让「抖两下」的动画重新播
  const [shake, setShake] = useState(0)

  // 焦点陷阱：打开时焦点进弹窗、Tab 在弹窗内循环、Esc 关闭、关闭后焦点回触发按钮。
  // Esc 交给 hook（它挂在 document 捕获阶段），所以这里不再自己监听 window 的 keydown。
  const dialogRef = useFocusTrap(open, onClose)

  useEffect(() => {
    if (!open) {
      setConfirmReset(false)
      setImportError(null)
    }
  }, [open])

  // 每次打开都重新问一次 Key 状态（可能在别处改过）
  useEffect(() => {
    if (!open) return
    setKeyMessage(null)
    setKeyInput('')
    void fetchKeyStatus().then(setKeyStatus)
  }, [open])

  if (!open) return null

  const handleSaveKey = async () => {
    const value = keyInput.trim()
    if (!value) return
    setKeyBusy(true)
    setKeyMessage(null)
    const result = await saveKey(value)
    setKeyBusy(false)
    if (result.ok && result.status) {
      setKeyStatus(result.status)
      setKeyInput('')
      setKeyMessage({ tone: 'ok', text: '已保存并验证通过' })
      toast('AI Key 已保存', 'success')
    } else {
      setKeyMessage({ tone: 'error', text: result.message || '保存失败' })
    }
  }

  const handleTestKey = async () => {
    setKeyBusy(true)
    setKeyMessage(null)
    const result = await testKey()
    setKeyBusy(false)
    setKeyMessage({ tone: result.ok ? 'ok' : 'error', text: result.message })
  }

  const handleClearKey = async () => {
    setKeyBusy(true)
    const result = await clearKey()
    setKeyBusy(false)
    if (result.ok && result.status) {
      setKeyStatus(result.status)
      setKeyMessage({ tone: 'ok', text: '已清除设置里的 Key' })
    } else {
      setKeyMessage({ tone: 'error', text: result.message || '清除失败' })
    }
  }

  const handleExport = () => {
    const blob = new Blob([exportAll()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leetcode-progress-${todayKey()}.json`
    a.click()
    URL.revokeObjectURL(url)
    // 记下备份时间：今日页据此判断「多久没备份了」
    saveUiNumber('lastExport', Date.now())
    setLastExport(Date.now())
    toast('进度已导出', 'success')
  }

  const handleImport = async (file: File | undefined) => {
    if (!file) return
    try {
      importAll(await file.text())
      setImportError(null)
      toast('进度已导入', 'success')
      onClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入失败'
      setImportError(message)
      setShake((value) => value + 1)
      toast(message, 'error')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const solved = Object.values(data.problems).filter((p) => p.status === 'done').length
  const motionHint =
    MOTION_OPTIONS.find((option) => option.value === data.settings.motion)?.hint ?? ''
  const themeHint = THEME_OPTIONS.find((option) => option.value === theme.mode)?.hint ?? ''

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        key={shake}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        // 根节点可聚焦（-1）：打开时焦点先落在这里，读屏会先报弹层标题，再 Tab 进控件
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2 id="settings-title">设置与数据</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X />
          </button>
        </div>
        <div className="modal__body">
          <div className="modal__row">
            <div>
              <div className="modal__label">每日目标</div>
              <div className="modal__hint">用于今日页的进度提示，不强制。</div>
            </div>
            <input
              className="input input--num"
              type="number"
              min={1}
              max={20}
              value={data.settings.dailyGoal}
              onChange={(e) => setDailyGoal(Number(e.target.value))}
            />
          </div>

          <div>
            <div className="modal__label">颜色模式</div>
            <div className="modal__hint" style={{ marginBottom: 'var(--sp-2)' }}>
              {themeHint}
            </div>
            <div className="filter-group">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={cn('chip', theme.mode === option.value && 'active')}
                  aria-pressed={theme.mode === option.value}
                  onClick={() => setThemeMode(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="modal__label">动效强度</div>
            <div className="modal__hint" style={{ marginBottom: 'var(--sp-2)' }}>
              {motionHint}
            </div>
            <div className="filter-group">
              {MOTION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={cn('chip', data.settings.motion === option.value && 'active')}
                  onClick={() => setMotion(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="modal__label">AI 解析（DeepSeek）</div>
            <div className="modal__hint" style={{ marginBottom: 'var(--sp-2)' }}>
              「解析」里的 AI 现场读题、AI 判题要用到 Key。它只保存在这台电脑上，不会上传。
              没有 Key 也能刷题，只是这些功能不可用。
            </div>

            {keyStatus?.managedByDevServer ? (
              <div className="modal__hint">
                当前是开发模式：Key 从 <code>app/.env.local</code> 读取，改完重启 dev server 生效。
              </div>
            ) : keyStatus?.configured ? (
              <>
                <div className="modal__row">
                  <div className="modal__hint">
                    已配置 <strong>{keyStatus.hint}</strong>
                    {keyStatus.source === 'settings'
                      ? '（来自设置）'
                      : keyStatus.source === 'env'
                        ? '（来自环境变量）'
                        : '（来自 app/.env.local）'}
                  </div>
                  <div className="modal__actions" style={{ marginTop: 0 }}>
                    <button className="btn btn--sm" disabled={keyBusy} onClick={() => void handleTestKey()}>
                      测试连接
                    </button>
                    {keyStatus.source === 'settings' ? (
                      <button className="btn btn--sm" disabled={keyBusy} onClick={() => void handleClearKey()}>
                        清除
                      </button>
                    ) : null}
                  </div>
                </div>
                {keyStatus.source === 'settings' ? null : (
                  <div className="modal__hint" style={{ marginTop: 'var(--sp-1)' }}>
                    想改用别的 Key：在下面填一个并保存，会覆盖上面的来源。
                  </div>
                )}
              </>
            ) : null}

            {keyStatus?.managedByDevServer ? null : (
              <div className="modal__row" style={{ marginTop: 'var(--sp-2)' }}>
                <input
                  className="input"
                  type="password"
                  placeholder="sk-...（在 platform.deepseek.com 申请）"
                  value={keyInput}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSaveKey()
                  }}
                  aria-label="DeepSeek API Key"
                />
                <button
                  className="btn btn--sm btn--primary"
                  disabled={keyBusy || !keyInput.trim()}
                  onClick={() => void handleSaveKey()}
                >
                  {keyBusy ? '验证中…' : '保存并验证'}
                </button>
              </div>
            )}

            {keyMessage ? (
              <div
                className="modal__hint"
                role="status"
                style={{ color: keyMessage.tone === 'ok' ? 'var(--success-text)' : 'var(--danger-text)' }}
              >
                {keyMessage.text}
              </div>
            ) : null}

            <div className="modal__hint" style={{ marginTop: 'var(--sp-1)' }}>
              保存位置：<code>%LOCALAPPDATA%\LeetCode训练台\deepseek.key</code>，删掉文件或点「清除」即可撤销。
            </div>
          </div>

          <div>
            <div className="modal__row">
              <div>
                <div className="modal__label">本地数据</div>
                <div className="modal__hint">
                  已掌握 {solved} 题 · 记录 {Object.keys(data.problems).length} 题 · 全部存在本机浏览器。
                </div>
                {/* 题库版本：数据重建后这里的时间会变，用来确认「看到的是不是最新题库」 */}
                <div className="modal__hint">
                  题库 {meta.problemCount} 题
                  {meta.teachingCount ? ` · ${meta.teachingCount} 篇 AI 精讲` : ''} · 生成于{' '}
                  {new Date(meta.generatedAt).toLocaleString('zh-CN')}
                </div>
                {/* 进度只在本机：给一个「多久没备份」的可见提示 */}
                <div className="modal__hint">
                  {lastExport
                    ? `上次备份：${new Date(lastExport).toLocaleDateString('zh-CN')}（${Math.max(
                        0,
                        Math.floor((Date.now() - lastExport) / 86400000),
                      )} 天前）`
                    : '还没有备份过 —— 清缓存 / 换端口 / 换浏览器都会丢进度'}
                </div>
              </div>
            </div>
            <div className="modal__actions">
              <button className="btn btn--sm" onClick={handleExport}>
                <Download /> 导出 JSON
              </button>
              <button className="btn btn--sm" onClick={() => fileRef.current?.click()}>
                <Upload /> 导入 JSON
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => void handleImport(e.target.files?.[0])}
              />
            </div>
            {importError ? (
              <div className="fx-error-text" role="alert">
                {importError}
              </div>
            ) : null}
          </div>

          <div>
            <div className="modal__label">危险操作</div>
            <div className="modal__hint" style={{ marginBottom: 'var(--sp-2)' }}>
              清空所有进度、笔记、代码与阅读记录，无法撤销。
            </div>
            <button
              className={cn('btn', 'btn--sm', confirmReset && 'fx-shake')}
              style={{ color: 'var(--danger)' }}
              onClick={() => {
                if (!confirmReset) {
                  setConfirmReset(true)
                  return
                }
                resetAll()
                setConfirmReset(false)
                toast('已清空本地数据')
                onClose()
              }}
            >
              <RotateCcw /> {confirmReset ? '再点一次确认清空' : '清空所有数据'}
            </button>
          </div>
        </div>
        <div className="modal__foot">
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
