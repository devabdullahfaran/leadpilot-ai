import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface FilterOption {
  value: string
  label: string
}

interface FilterSelectProps {
  value: string
  onValueChange: (value: string) => void
  options: FilterOption[]
  className?: string
  'aria-label': string
}

export function FilterSelect({ value, onValueChange, options, className, ...aria }: FilterSelectProps) {
  return (
    <Select items={options} value={value} onValueChange={(next) => next !== null && onValueChange(String(next))}>
      <SelectTrigger size="sm" className={cn('w-full sm:w-44', className)} {...aria}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
