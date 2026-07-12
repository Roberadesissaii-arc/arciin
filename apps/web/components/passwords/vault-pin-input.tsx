"use client"

import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp"
import { Label } from "@/components/ui/label"

const SLOT_CLASS =
  "relative flex size-9 items-center justify-center rounded-md border border-border bg-muted/60 text-[15px] font-semibold tabular-nums text-foreground shadow-sm outline-none transition-all first:rounded-md last:rounded-md data-[active=true]:z-10 data-[active=true]:border-primary/50 data-[active=true]:ring-2 data-[active=true]:ring-primary/20"

const GROUP_CLASS =
  "flex items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-1 ring-1 ring-black/[0.04]"

export function VaultPinInput({
  id,
  label,
  value,
  onChange,
  disabled,
  onComplete,
}: {
  id?: string
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  onComplete?: () => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[13px] font-medium text-foreground">
        {label}
      </Label>
      <InputOTP
        id={id}
        maxLength={6}
        value={value}
        disabled={disabled}
        onChange={onChange}
        onComplete={onComplete}
        containerClassName="justify-start"
      >
        <div className="flex items-center gap-2">
          <InputOTPGroup className={GROUP_CLASS}>
            <InputOTPSlot index={0} className={SLOT_CLASS} />
            <InputOTPSlot index={1} className={SLOT_CLASS} />
            <InputOTPSlot index={2} className={SLOT_CLASS} />
          </InputOTPGroup>
          <InputOTPSeparator className="text-muted-foreground" />
          <InputOTPGroup className={GROUP_CLASS}>
            <InputOTPSlot index={3} className={SLOT_CLASS} />
            <InputOTPSlot index={4} className={SLOT_CLASS} />
            <InputOTPSlot index={5} className={SLOT_CLASS} />
          </InputOTPGroup>
        </div>
      </InputOTP>
    </div>
  )
}
