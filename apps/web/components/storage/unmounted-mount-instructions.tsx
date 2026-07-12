import type { UnmountedBlockDevice } from "@/lib/types/models"

type InstructionTheme = "light" | "dark"

const themeClasses: Record<
  InstructionTheme,
  { item: string; title: string; meta: string; pre: string }
> = {
  light: {
    item: "rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600",
    title: "font-medium text-zinc-900",
    meta: "mt-1 font-mono text-[10px] text-zinc-500",
    pre: "mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-white px-2 py-1.5 font-mono text-[10px] leading-relaxed text-zinc-800",
  },
  dark: {
    item: "rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-zinc-400",
    title: "font-medium text-zinc-200",
    meta: "mt-1 font-mono text-[10px] text-zinc-500",
    pre: "mt-1.5 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-zinc-300",
  },
}

export function UnmountedMountInstructions({
  devices,
  compact = false,
  theme = "light",
}: {
  devices: UnmountedBlockDevice[]
  compact?: boolean
  theme?: InstructionTheme
}) {
  if (!devices.length) return null

  const styles = themeClasses[theme]

  return (
    <ul className="space-y-2">
      {devices.map((device) => (
        <li key={device.id} className={styles.item}>
          <p className={styles.title}>
            {device.device} · {device.sizeLabel}
            {device.filesystem ? ` · ${device.filesystem}` : ""}
            {device.isLuks ? " · LUKS" : ""}
          </p>
          {compact ? (
            <p className={styles.meta}>→ {device.suggestedMountPoint}</p>
          ) : (
            <pre className={styles.pre}>{`sudo mkdir -p ${device.suggestedMountPoint}
sudo mkfs.ext4 -L arciin-data ${device.device}   # only if the disk is empty
echo '${device.device} ${device.suggestedMountPoint} ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
sudo mount -a
sudo chown -R $(id -u):$(id -g) ${device.suggestedMountPoint}
# Then set storage to ${device.suggestedArciinPath}`}</pre>
          )}
        </li>
      ))}
    </ul>
  )
}
