export default function FileRequestLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dashboard-main relative min-h-svh bg-background text-foreground">{children}</div>
  )
}
