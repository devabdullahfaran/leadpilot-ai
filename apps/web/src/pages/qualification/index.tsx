import { useAiSettings } from '@/api'
import { PageHeader } from '@/components/app'
import { PipelineSection } from './pipeline'
import { QueueSection } from './queue'
import { RecentRunsSection } from './recent-runs'
import { RubricSection } from './rubric'
import { RunSection } from './run-section'

export function QualificationPage() {
  const settings = useAiSettings()

  return (
    <div className="space-y-6">
      <PageHeader title="AI Qualification" description="How leads are scored, the leads waiting for review, and on-demand AI runs." />
      <PipelineSection />
      <QueueSection settings={settings.data} />
      <RunSection settings={settings.data} />
      <RubricSection query={settings} />
      <RecentRunsSection />
    </div>
  )
}
