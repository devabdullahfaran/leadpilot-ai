import type {
  ExecutionStatus,
  LeadPriority,
  LeadStatus,
  QualificationStatus,
  WorkflowEngine,
  WorkspaceRole,
} from '@leadpilot/shared'
import { CircleDashed, Cloud, FlaskConical, Workflow } from 'lucide-react'
import { formatEnumLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  ENGINE_LABEL,
  EXECUTION_STATUS_SPEC,
  LEAD_STATUS_TONE,
  PRIORITY_SPEC,
  QUALIFICATION_STATUS_SPEC,
} from './badge-specs'
import { StatusBadge } from './status-badge'

export function PriorityBadge({ priority, className }: { priority: LeadPriority | null | undefined; className?: string }) {
  if (!priority) {
    return (
      <StatusBadge tone="neutral" icon={<CircleDashed />} className={className} title="Not scored yet">
        Unscored
      </StatusBadge>
    )
  }
  const spec = PRIORITY_SPEC[priority]
  return (
    <StatusBadge tone={spec.tone} icon={spec.icon} className={className} title={`${spec.label} priority`}>
      {spec.label}
    </StatusBadge>
  )
}

export function LeadStatusBadge({ status, className }: { status: LeadStatus; className?: string }) {
  return (
    <StatusBadge variant="dot" tone={LEAD_STATUS_TONE[status]} className={className}>
      {formatEnumLabel(status)}
    </StatusBadge>
  )
}

export function QualificationStatusBadge({ status, className }: { status: QualificationStatus; className?: string }) {
  const spec = QUALIFICATION_STATUS_SPEC[status]
  return (
    <StatusBadge tone={spec.tone} icon={spec.icon} className={className}>
      {spec.label}
    </StatusBadge>
  )
}

export function ExecutionStatusBadge({ status, className }: { status: ExecutionStatus; className?: string }) {
  const spec = EXECUTION_STATUS_SPEC[status]
  return (
    <StatusBadge tone={spec.tone} icon={spec.icon} className={className}>
      {spec.label}
    </StatusBadge>
  )
}

/** Where a workflow ran: the Cloudflare Worker pipeline or self-hosted n8n. */
export function EngineBadge({ engine, className }: { engine: WorkflowEngine; className?: string }) {
  return (
    <StatusBadge
      tone="neutral"
      icon={engine === 'worker' ? <Cloud /> : <Workflow />}
      className={cn('bg-background', className)}
      title={engine === 'worker' ? 'Ran in the Cloudflare Worker pipeline' : 'Ran in a self-hosted n8n instance'}
    >
      {ENGINE_LABEL[engine]}
    </StatusBadge>
  )
}

/** Marks synthetic records (`isSample`). Render it wherever a sample record is shown. */
export function SampleBadge({ className }: { className?: string }) {
  return (
    <span
      title="Synthetic sample record, not a real lead"
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-md border border-dashed border-muted-foreground/40 px-1.5 text-[11px] font-medium text-muted-foreground [&_svg]:size-3',
        className,
      )}
    >
      <FlaskConical aria-hidden="true" />
      Sample
    </span>
  )
}

export function RoleBadge({ role, className }: { role: WorkspaceRole; className?: string }) {
  return (
    <StatusBadge tone={role === 'owner' || role === 'admin' ? 'info' : 'neutral'} className={className}>
      {formatEnumLabel(role)}
    </StatusBadge>
  )
}
