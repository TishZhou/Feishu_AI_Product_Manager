import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  GitBranch, GitPullRequest, X, ExternalLink, Check,
  AlertTriangle, Loader2, Cloud,
} from 'lucide-react'
import { useGitStatus, useGitPublish } from '../hooks/useDevFlow'
import type { GitPublishResult } from '../types/api'

interface GitIntegrationModalProps {
  runId: string
  onClose: () => void
}

export function GitIntegrationModal({ runId, onClose }: GitIntegrationModalProps) {
  const { data: status, isLoading, error } = useGitStatus(runId, true)
  const publish = useGitPublish()
  // Three independent toggles — UI shows them as a checklist so the user can
  // see exactly what's about to happen. "Create branch" is conceptually a
  // toggle but always required (otherwise nothing to push), so it's rendered
  // disabled-checked rather than backed by state.
  const [doPush, setDoPush] = useState(true)
  const [doPr, setDoPr] = useState(true)
  const [branchPrefix, setBranchPrefix] = useState('devflow')
  const [title, setTitle] = useState('')

  // Adjust defaults once we know what's available:
  //   no remote          → push & PR off
  //   no PR cli for kind → PR off
  useEffect(() => {
    if (!status) return
    if (!status.remote_url) {
      setDoPush(false)
      setDoPr(false)
      return
    }
    if ((status.remote_kind === 'github' && !status.has_gh_cli)
        || (status.remote_kind === 'gitlab' && !status.has_glab_cli)) {
      setDoPr(false)
    }
  }, [status])

  // PR requires push; if push is turned off, PR auto-turns off too.
  useEffect(() => { if (!doPush) setDoPr(false) }, [doPush])

  // ESC closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !publish.isPending) onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, publish.isPending])

  const result = publish.data as GitPublishResult | undefined
  const RemoteIcon = Cloud

  // PR availability per remote kind
  const prAvailable =
    !!status?.remote_url &&
    ((status.remote_kind === 'github' && status.has_gh_cli)
     || (status.remote_kind === 'gitlab' && status.has_glab_cli))
  const prKindLabel = status?.remote_kind === 'gitlab' ? 'MR' : 'PR'

  const handleSubmit = () => {
    publish.mutate({
      runId,
      options: {
        do_push: doPush,
        do_pr: doPush && doPr,
        branch_prefix: branchPrefix.trim() || 'devflow',
        title: title.trim(),
      },
    })
  }

  // Summarise what will happen, for the submit button label.
  const submitLabel = (() => {
    if (publish.isPending) return '执行中…'
    const parts = ['新建分支', 'commit']
    if (doPush) parts.push('推送')
    if (doPush && doPr) parts.push(`创建 ${prKindLabel}`)
    return parts.join(' · ')
  })()

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
          background: 'rgba(15, 23, 42, 0.32)',
          backdropFilter: 'saturate(180%) blur(14px)',
          WebkitBackdropFilter: 'saturate(180%) blur(14px)',
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ type: 'spring', damping: 26, stiffness: 260 }}
          style={{
            width: '100%', maxWidth: 560,
            background: 'white', borderRadius: 18,
            boxShadow: '0 24px 60px rgba(15,23,42,0.18)',
            border: '1px solid var(--c-line-2)',
            overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            padding: '20px 24px 16px',
            borderBottom: '1px solid var(--c-line)',
            background: 'rgba(252,253,254,0.85)',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{
                width: 38, height: 38, flexShrink: 0,
                background: 'rgba(59,130,246,0.10)',
                border: '1px solid rgba(59,130,246,0.22)',
                borderRadius: 11,
                display: 'grid', placeItems: 'center',
              }}>
                <GitBranch size={17} color="#1D4ED8" strokeWidth={1.9} />
              </div>
              <div>
                <h2 className="display" style={{
                  margin: 0, fontSize: 16, fontWeight: 700,
                  color: 'var(--c-ink-900)', letterSpacing: '-0.01em', lineHeight: 1.3,
                }}>
                  Git 集成
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--c-ink-500)', lineHeight: 1.5 }}>
                  把交付补丁打成分支，可选择推送到远端并创建 PR / MR
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={publish.isPending}
              style={{
                width: 28, height: 28, flexShrink: 0,
                background: 'transparent', border: '1px solid transparent',
                borderRadius: 7, cursor: publish.isPending ? 'not-allowed' : 'pointer',
                color: 'var(--c-ink-500)', fontFamily: 'inherit',
                display: 'grid', placeItems: 'center',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (publish.isPending) return
                e.currentTarget.style.background = 'var(--c-ink-50)'
                e.currentTarget.style.borderColor = 'var(--c-line-2)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.borderColor = 'transparent'
              }}
            >
              <X size={14} strokeWidth={1.9} />
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {isLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--c-ink-500)', fontSize: 13 }}>
                <Loader2 size={14} className="animate-spin" />
                正在检查仓库状态…
              </div>
            )}

            {error && (
              <Banner tone="warn">
                无法获取 git 状态：{(error as Error).message}
              </Banner>
            )}

            {status && !status.is_git && (
              <Banner tone="warn">
                选中的目录不是一个 git 仓库（{status.repo_path}）。请先在该目录运行 <code>git init</code> 并配置 origin 后重试。
              </Banner>
            )}

            {status && status.is_git && (
              <>
                {/* Repo summary */}
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 8,
                  padding: '12px 14px', borderRadius: 10,
                  background: 'var(--c-ink-50)', border: '1px solid var(--c-line-2)',
                }}>
                  <Row label="仓库">
                    <span className="mono" style={{ fontSize: 12, color: 'var(--c-ink-700)', wordBreak: 'break-all' }}>
                      {status.repo_path}
                    </span>
                  </Row>
                  <Row label="当前分支">
                    <span className="mono" style={{ fontSize: 12, color: 'var(--c-ink-700)' }}>
                      {status.current_branch || '—'}
                    </span>
                  </Row>
                  {status.remote_url && (
                    <Row label="远端">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <RemoteIcon size={11} style={{ color: 'var(--c-ink-500)' }} />
                        <span style={{
                          fontSize: 9.5, fontWeight: 600,
                          textTransform: 'uppercase', letterSpacing: '0.06em',
                          color: status.remote_kind === 'github' ? '#0F172A' : status.remote_kind === 'gitlab' ? '#FC6D26' : 'var(--c-ink-500)',
                        }}>
                          {status.remote_kind || 'remote'}
                        </span>
                        <span className="mono" style={{ fontSize: 12, color: 'var(--c-ink-700)', wordBreak: 'break-all' }}>
                          {status.remote_url}
                        </span>
                      </span>
                    </Row>
                  )}
                  <Row label="工作区">
                    <WorkingTreeStatus status={status} />
                  </Row>
                </div>

                {/* Action checklist — explicit toggles */}
                {!result && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-ink-600)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      要做的操作
                    </label>
                    <div style={{
                      display: 'flex', flexDirection: 'column', gap: 4,
                      padding: '8px 4px', borderRadius: 10,
                      background: 'white', border: '1px solid var(--c-line-2)',
                    }}>
                      <ToggleRow
                        checked
                        disabled
                        onToggle={() => { /* always required */ }}
                        title="新建分支并提交"
                        hint="一定执行 — 否则不会留下任何 git 痕迹"
                        icon={<GitBranch size={13} strokeWidth={2} />}
                      />
                      <ToggleRow
                        checked={doPush}
                        disabled={!status.remote_url}
                        onToggle={() => setDoPush(v => !v)}
                        title="推送到远端 origin"
                        hint={status.remote_url ? `→ ${status.remote_url}` : '没有 origin 远端，跳过'}
                        icon={<Cloud size={13} strokeWidth={2} />}
                      />
                      <ToggleRow
                        checked={doPr && doPush}
                        disabled={!doPush || !prAvailable}
                        onToggle={() => setDoPr(v => !v)}
                        title={`创建 ${prKindLabel}（草稿）`}
                        hint={
                          !doPush ? '需要先勾选"推送"' :
                          !status.remote_url ? '需要远端' :
                          status.remote_kind === 'github' && !status.has_gh_cli ? '需要 gh CLI（macOS：brew install gh）' :
                          status.remote_kind === 'gitlab' && !status.has_glab_cli ? '需要 glab CLI' :
                          status.remote_kind === 'gitlab' ? '通过 glab mr create --draft' : '通过 gh pr create --draft'
                        }
                        icon={<GitPullRequest size={13} strokeWidth={2} />}
                      />
                    </div>
                  </div>
                )}

                {/* Branch / title */}
                {!result && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12 }}>
                    <Field label="分支前缀">
                      <input
                        type="text" value={branchPrefix}
                        onChange={e => setBranchPrefix(e.target.value)}
                        placeholder="devflow"
                      />
                    </Field>
                    <Field label="提交标题（可选）">
                      <input
                        type="text" value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="留空则用 pipeline 描述"
                      />
                    </Field>
                  </div>
                )}

                {/* Result */}
                {result && (
                  <ResultPanel result={result} />
                )}

                {/* Errors from publish */}
                {publish.isError && !result && (
                  <Banner tone="warn">
                    操作失败：{(publish.error as Error)?.message || '请查看后端日志'}
                  </Banner>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: '14px 24px',
            borderTop: '1px solid var(--c-line)',
            background: 'var(--c-ink-50)',
            display: 'flex', justifyContent: 'flex-end', gap: 10,
          }}>
            <button
              onClick={onClose}
              disabled={publish.isPending}
              style={{
                padding: '9px 18px',
                background: 'white', border: '1px solid var(--c-line-2)',
                borderRadius: 9,
                fontSize: 12.5, fontWeight: 500, fontFamily: 'inherit',
                color: 'var(--c-ink-700)',
                cursor: publish.isPending ? 'not-allowed' : 'pointer',
              }}
            >
              {result ? '关闭' : '稍后再说'}
            </button>
            {!result && status?.is_git && (
              <button
                onClick={handleSubmit}
                disabled={publish.isPending || !status.safe_to_publish}
                style={{
                  padding: '9px 20px',
                  background: publish.isPending || !status.safe_to_publish
                    ? 'var(--c-ink-100)'
                    : 'linear-gradient(135deg, #2563EB, #1D4ED8)',
                  color: publish.isPending || !status.safe_to_publish ? 'var(--c-ink-400)' : 'white',
                  border: 'none', borderRadius: 9,
                  fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
                  cursor: publish.isPending || !status.safe_to_publish ? 'not-allowed' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  boxShadow: publish.isPending || !status.safe_to_publish ? 'none' : '0 4px 12px rgba(29,78,216,0.28)',
                  transition: 'all 0.18s ease',
                }}
              >
                {publish.isPending && <Loader2 size={13} className="animate-spin" />}
                {submitLabel}
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ─── helper components ────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--c-ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 56 }}>
        {label}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-ink-600)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </span>
      <div style={{ display: 'flex' }} className="git-field">
        {children}
      </div>
      <style>{`.git-field input {
        flex: 1; padding: 9px 12px;
        background: white; border: 1px solid var(--c-line-2);
        border-radius: 9px; font-size: 12.5;
        color: var(--c-ink-900); outline: none; font-family: inherit;
        box-sizing: border-box; transition: border-color 0.15s ease;
      }
      .git-field input:focus { border-color: #3B82F6; box-shadow: 0 0 0 3px rgba(59,130,246,0.10); }`}</style>
    </label>
  )
}

function ToggleRow({
  checked, disabled, onToggle, icon, title, hint,
}: {
  checked: boolean
  disabled?: boolean
  onToggle: () => void
  icon: React.ReactNode
  title: string
  hint: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 12px',
        background: 'transparent', border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
        opacity: disabled ? 0.55 : 1,
        textAlign: 'left', borderRadius: 8,
        transition: 'background 0.12s ease',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--c-ink-50)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Checkbox */}
      <span style={{
        flexShrink: 0, width: 16, height: 16,
        borderRadius: 4,
        background: checked && !disabled ? '#2563EB' : 'white',
        border: `1.5px solid ${checked && !disabled ? '#2563EB' : 'var(--c-ink-300)'}`,
        display: 'grid', placeItems: 'center',
        transition: 'all 0.12s ease',
      }}>
        {checked && (
          <Check size={11} color="white" strokeWidth={3} />
        )}
      </span>
      {/* Icon */}
      <span style={{
        flexShrink: 0,
        color: disabled ? 'var(--c-ink-400)' : checked ? '#1D4ED8' : 'var(--c-ink-500)',
      }}>
        {icon}
      </span>
      {/* Text */}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{
          fontSize: 13, fontWeight: 500,
          color: disabled ? 'var(--c-ink-500)' : 'var(--c-ink-900)',
        }}>
          {title}
        </span>
        <span style={{
          fontSize: 11, color: disabled ? 'var(--c-ink-400)' : 'var(--c-ink-500)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {hint}
        </span>
      </span>
    </button>
  )
}

function WorkingTreeStatus({ status }: { status: import('../types/api').GitStatus }) {
  // Three states:
  //   clean — green
  //   dirty but matches this run's patch — green ("含 delivery 写入的本次改动")
  //   dirty with unrelated files — amber, lists offending paths
  if (status.working_tree_clean) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 11.5, fontWeight: 500, color: '#047857',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981' }} />
        干净
      </span>
    )
  }
  if (status.dirty_matches_patch) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 11.5, fontWeight: 500, color: '#047857',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981' }} />
        含本次 delivery 写入的改动 ({status.dirty_paths.length} 个文件)，可以直接打成 commit
      </span>
    )
  }
  // dirty_unrelated
  const extras = status.dirty_paths.filter(p => !status.patch_paths.includes(p))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 11.5, fontWeight: 500, color: '#B45309',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B' }} />
        有不相关的本地改动，请先手动 commit 或 stash
      </span>
      {extras.length > 0 && (
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--c-ink-500)', paddingLeft: 12 }}>
          {extras.slice(0, 3).map(p => <div key={p}>· {p}</div>)}
          {extras.length > 3 && <div>· …还有 {extras.length - 3} 个</div>}
        </div>
      )}
    </div>
  )
}

function Banner({ tone, children }: { tone: 'ok' | 'warn' | 'info'; children: React.ReactNode }) {
  const palette = tone === 'ok' ? { bg: '#ECFDF5', border: '#A7F3D0', fg: '#065F46' }
    : tone === 'warn' ? { bg: '#FEF2F2', border: '#FECACA', fg: '#991B1B' }
    : { bg: '#EFF6FF', border: '#BFDBFE', fg: '#1E40AF' }
  return (
    <div style={{
      padding: '10px 13px', borderRadius: 10,
      background: palette.bg, border: `1px solid ${palette.border}`, color: palette.fg,
      fontSize: 12.5, lineHeight: 1.55,
      display: 'flex', alignItems: 'flex-start', gap: 8,
    }}>
      <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
      <span style={{ flex: 1 }}>{children}</span>
    </div>
  )
}

function ResultPanel({ result }: { result: GitPublishResult }) {
  const ok = ['committed', 'pushed', 'review_created'].includes(result.status)
  const palette = ok
    ? { bg: '#ECFDF5', border: '#A7F3D0', fg: '#065F46' }
    : { bg: '#FEF2F2', border: '#FECACA', fg: '#991B1B' }
  const Icon = ok ? Check : AlertTriangle
  const statusLabel: Record<string, string> = {
    committed: '已本地提交',
    pushed: '已推送到远端',
    review_created: '已创建 PR / MR',
    failed: '操作失败',
    blocked: '操作被阻止',
    skipped: '已跳过',
    pending: '处理中',
  }

  return (
    <div style={{
      padding: 14, borderRadius: 11,
      background: palette.bg, border: `1px solid ${palette.border}`,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: palette.fg }}>
        <Icon size={15} strokeWidth={2.2} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{statusLabel[result.status] || result.status}</span>
      </div>
      {result.branch && (
        <Row label="分支">
          <span className="mono" style={{ fontSize: 12, color: palette.fg, wordBreak: 'break-all' }}>
            {result.branch}
          </span>
        </Row>
      )}
      {result.commit && (
        <Row label="commit">
          <span className="mono" style={{ fontSize: 11.5, color: palette.fg }}>
            {result.commit.slice(0, 12)}
          </span>
        </Row>
      )}
      {result.review_url && (
        <Row label={result.review_kind || 'PR'}>
          <a
            href={result.review_url}
            target="_blank" rel="noopener noreferrer"
            style={{
              fontSize: 12, color: palette.fg, fontWeight: 500,
              display: 'inline-flex', alignItems: 'center', gap: 4,
              wordBreak: 'break-all', textDecoration: 'underline',
            }}
          >
            {result.review_url}
            <ExternalLink size={11} />
          </a>
        </Row>
      )}
      {result.changed_files.length > 0 && (
        <Row label={`${result.changed_files.length} 个文件`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {result.changed_files.slice(0, 4).map(f => (
              <span key={f} className="mono" style={{ fontSize: 11, color: palette.fg, wordBreak: 'break-all' }}>{f}</span>
            ))}
            {result.changed_files.length > 4 && (
              <span style={{ fontSize: 10.5, color: palette.fg, opacity: 0.7 }}>
                …还有 {result.changed_files.length - 4} 个
              </span>
            )}
          </div>
        </Row>
      )}
      {result.error && (
        <div style={{
          padding: '8px 11px', borderRadius: 8,
          background: 'rgba(255,255,255,0.6)',
          fontSize: 11.5, color: palette.fg,
          fontFamily: "'JetBrains Mono', monospace",
          wordBreak: 'break-word', whiteSpace: 'pre-wrap',
        }}>
          {result.error}
        </div>
      )}
    </div>
  )
}
