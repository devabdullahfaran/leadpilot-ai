import { useSearchParams } from 'react-router'
import { PageHeader, usePageTitle } from '@/components/app'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AiTab } from './ai-tab'
import { MembersTab, ProfileTab, SampleDataTab, WorkspaceTab } from './general-tabs'

const TABS = [
  { value: 'workspace', label: 'Workspace', render: () => <WorkspaceTab /> },
  { value: 'profile', label: 'Profile', render: () => <ProfileTab /> },
  { value: 'ai', label: 'AI qualification', render: () => <AiTab /> },
  { value: 'members', label: 'Members', render: () => <MembersTab /> },
  { value: 'sample-data', label: 'Sample data', render: () => <SampleDataTab /> },
] as const

export function SettingsPage() {
  usePageTitle('Settings')
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab = TABS.find((t) => t.value === requested)?.value ?? 'workspace'

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Workspace, profile, AI scoring, members and sample data." />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(params)
          next.set('tab', String(value))
          setParams(next, { replace: true })
        }}
      >
        <div className="overflow-x-auto">
          <TabsList variant="line">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {TABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className="pt-4">
            {t.value === tab ? t.render() : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
