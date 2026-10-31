import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { Option } from './lib'

interface SimpleSelectProps {
  value: string
  onValueChange: (value: string) => void
  options: Option[]
  placeholder?: string
  disabled?: boolean
  size?: 'sm' | 'default'
  className?: string
  id?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

/** Single-value select over string options; accepts the props FormField injects. */
export function SimpleSelect({ value, onValueChange, options, placeholder, disabled, size, className, ...aria }: SimpleSelectProps) {
  return (
    <Select
      items={options}
      value={value === '' ? null : value}
      onValueChange={(next) => next !== null && onValueChange(String(next))}
      disabled={disabled}
    >
      <SelectTrigger size={size} className={cn('w-full', className)} {...aria}>
        <SelectValue placeholder={placeholder} />
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
