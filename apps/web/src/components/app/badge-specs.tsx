import type { ReactNode } from 'react'
import type { ExecutionStatus, LeadPriority, LeadStatus, QualificationStatus, WorkflowEngine } from '@leadpilot/shared'
import {
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock,
  LoaderCircle,
  SignalHigh,
  SignalLow,
  SignalMedium,
  TriangleAlert,
} from 'lucide-react'
import type { Tone } from './status-badge'

// Tone, label and icon per enum value. Shared by badges, filters and chart legends so they stay consistent.

export interface ToneSpec {
  tone: Tone
  label: string
  icon?: ReactNode
}

// Priority: high = strongest fit. Green/amber/gray keeps red reserved for failures.
export const PRIORITY_SPEC: Record<LeadPriority, ToneSpec> = {
  high: { tone: 'success', label: 'High', icon: <SignalHigh /> },
  medium: { tone: 'warning', label: 'Medium', icon: <SignalMedium /> },
  low: { tone: 'neutral', label: 'Low', icon: <SignalLow /> },
}

export const LEAD_STATUS_TONE: Record<LeadStatus, Tone> = {
  new: 'info',
  contacted: 'neutral',
  qualified: 'info',
  proposal: 'warning',
  won: 'success',
  lost: 'neutral',
  disqualified: 'danger',
}

export const QUALIFICATION_STATUS_SPEC: Record<QualificationStatus, ToneSpec> = {
  pending: { tone: 'neutral', label: 'Pending', icon: <Clock /> },
  processing: { tone: 'info', label: 'Processing', icon: <LoaderCircle className="animate-spin" /> },
  completed: { tone: 'success', label: 'Completed', icon: <CircleCheck /> },
  needs_review: { tone: 'warning', label: 'Needs review', icon: <TriangleAlert /> },
  failed: { tone: 'danger', label: 'Failed', icon: <CircleX /> },
  skipped: { tone: 'neutral', label: 'Skipped', icon: <CircleMinus /> },
}

export const EXECUTION_STATUS_SPEC: Record<ExecutionStatus, ToneSpec> = {
  running: { tone: 'info', label: 'Running', icon: <LoaderCircle className="animate-spin" /> },
  succeeded: { tone: 'success', label: 'Succeeded', icon: <CircleCheck /> },
  partial: { tone: 'warning', label: 'Partial', icon: <TriangleAlert /> },
  failed: { tone: 'danger', label: 'Failed', icon: <CircleX /> },
}

export const ENGINE_LABEL: Record<WorkflowEngine, string> = {
  worker: 'Worker',
  n8n: 'n8n · self-hosted',
}
