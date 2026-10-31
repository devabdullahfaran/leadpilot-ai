import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type {
  Lead,
  LeadActivity,
  LeadCreateInput,
  LeadQualification,
  Paginated,
  QualificationOverride,
  QualifyResult,
} from '@leadpilot/shared'
import { queryKeys } from './keys'
import { invalidateAll, useScopedMutation } from './mutation'
import { scopedRequest, useApiScope, type ApiScope } from './scope'
import type { DuplicateCheckParams, DuplicateMatch, LeadListParams, LeadUpdateInput } from './types'

const leadPath = (id: string) => `/leads/${encodeURIComponent(id)}`

/** Keys affected by any change to a lead's data or AI result. */
function leadChangeKeys(scope: ApiScope, id: string) {
  return [
    queryKeys.leads.detail(scope, id),
    queryKeys.leads.lists(scope),
    queryKeys.dashboard(scope),
    queryKeys.analyticsAll(scope),
  ]
}

/** `GET /leads` — paginated, filtered list. Previous page stays visible while the next loads. */
export function useLeads(params: LeadListParams = {}) {
  const scope = useApiScope()
  return useQuery({
    queryKey: queryKeys.leads.list(scope, params),
    enabled: scope.ready,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => scopedRequest<Paginated<Lead>>(scope, '/leads', { query: params, signal }),
  })
}

/** `GET /leads/:id` */
export function useLead(id: string | undefined) {
  const scope = useApiScope()
  return useQuery({
    queryKey: queryKeys.leads.detail(scope, id ?? ''),
    enabled: scope.ready && Boolean(id),
    queryFn: ({ signal }) => scopedRequest<Lead>(scope, leadPath(id!), { signal }),
  })
}

/** `GET /leads/:id/activities` → newest first (≤ 100). */
export function useLeadActivities(id: string | undefined) {
  const scope = useApiScope()
  return useQuery({
    queryKey: queryKeys.leads.activities(scope, id ?? ''),
    enabled: scope.ready && Boolean(id),
    queryFn: async ({ signal }) =>
      (await scopedRequest<{ data: LeadActivity[] }>(scope, `${leadPath(id!)}/activities`, { signal })).data,
  })
}

/** `GET /leads/:id/qualifications` → newest first. */
export function useLeadQualifications(id: string | undefined) {
  const scope = useApiScope()
  return useQuery({
    queryKey: queryKeys.leads.qualifications(scope, id ?? ''),
    enabled: scope.ready && Boolean(id),
    queryFn: async ({ signal }) =>
      (await scopedRequest<{ data: LeadQualification[] }>(scope, `${leadPath(id!)}/qualifications`, { signal })).data,
  })
}

/** `GET /leads/duplicates` (≤ 5 matches). Debounce `params` in the caller; runs only with email, phone or company. */
export function useDuplicateCheck(params: DuplicateCheckParams, enabled = true) {
  const scope = useApiScope()
  const hasInput = Boolean(params.email?.trim() || params.phone?.trim() || params.company?.trim())
  return useQuery({
    queryKey: queryKeys.leads.duplicates(scope, params),
    enabled: scope.ready && enabled && hasInput,
    staleTime: 10_000,
    queryFn: async ({ signal }) =>
      (await scopedRequest<{ matches: DuplicateMatch[] }>(scope, '/leads/duplicates', { query: params, signal })).matches,
  })
}

/** `POST /leads` → the created lead. `409 duplicate_lead` carries `details.existingLeadId`. */
export function useCreateLead() {
  return useScopedMutation(
    async (body: LeadCreateInput, scope) =>
      (await scopedRequest<{ lead: Lead }>(scope, '/leads', { method: 'POST', body })).lead,
    {
      onSuccess: ({ queryClient, scope, data }) => {
        queryClient.setQueryData(queryKeys.leads.detail(scope, data.id), data)
        return invalidateAll(queryClient, [
          queryKeys.leads.lists(scope),
          queryKeys.dashboard(scope),
          queryKeys.analyticsAll(scope),
        ])
      },
    }
  )
}

/** `PATCH /leads/:id` */
export function useUpdateLead() {
  return useScopedMutation(
    ({ id, data }: { id: string; data: LeadUpdateInput }, scope) =>
      scopedRequest<Lead>(scope, leadPath(id), { method: 'PATCH', body: data }),
    {
      onSuccess: ({ queryClient, scope, data }) => {
        queryClient.setQueryData(queryKeys.leads.detail(scope, data.id), data)
        return invalidateAll(queryClient, leadChangeKeys(scope, data.id))
      },
    }
  )
}

/** `DELETE /leads/:id` (admin). */
export function useDeleteLead() {
  return useScopedMutation(
    (id: string, scope) => scopedRequest<void>(scope, leadPath(id), { method: 'DELETE' }),
    {
      onSuccess: ({ queryClient, scope, vars: id }) => {
        queryClient.removeQueries({ queryKey: queryKeys.leads.detail(scope, id) })
        return invalidateAll(queryClient, [
          queryKeys.leads.lists(scope),
          queryKeys.dashboard(scope),
          queryKeys.analyticsAll(scope),
          queryKeys.workflows.all(scope),
        ])
      },
    }
  )
}

/** `POST /leads/:id/notes` → the new activity. */
export function useAddNote() {
  return useScopedMutation(
    ({ leadId, body }: { leadId: string; body: string }, scope) =>
      scopedRequest<LeadActivity>(scope, `${leadPath(leadId)}/notes`, { method: 'POST', body: { body } }),
    {
      onSuccess: ({ queryClient, scope, vars }) => invalidateAll(queryClient, [queryKeys.leads.activities(scope, vars.leadId)]),
    }
  )
}

/** `POST /leads/:id/qualify` — runs the live AI pipeline now. */
export function useQualifyLead() {
  return useScopedMutation(
    (leadId: string, scope) => scopedRequest<QualifyResult>(scope, `${leadPath(leadId)}/qualify`, { method: 'POST' }),
    {
      onSuccess: ({ queryClient, scope, vars: leadId, data }) => {
        queryClient.setQueryData(queryKeys.leads.detail(scope, leadId), data.lead)
        return invalidateAll(queryClient, [
          ...leadChangeKeys(scope, leadId),
          queryKeys.workflows.all(scope),
          queryKeys.integrations.all(scope),
        ])
      },
      // A failed AI run is still recorded (execution, lead status, usage), so refresh those views too.
      invalidateOnError: (leadId, scope) => [
        ...leadChangeKeys(scope, leadId),
        queryKeys.workflows.all(scope),
        queryKeys.integrations.all(scope),
      ],
    }
  )
}

/** `POST /leads/:id/override` — manual score/priority with a reason. */
export function useOverrideQualification() {
  return useScopedMutation(
    ({ leadId, data }: { leadId: string; data: QualificationOverride }, scope) =>
      scopedRequest<{ lead: Lead; qualification: LeadQualification }>(scope, `${leadPath(leadId)}/override`, {
        method: 'POST',
        body: data,
      }),
    {
      onSuccess: ({ queryClient, scope, vars, data }) => {
        queryClient.setQueryData(queryKeys.leads.detail(scope, vars.leadId), data.lead)
        return invalidateAll(queryClient, leadChangeKeys(scope, vars.leadId))
      },
    }
  )
}
