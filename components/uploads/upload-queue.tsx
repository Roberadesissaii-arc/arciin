"use client"

import { AnimatePresence, motion } from "framer-motion"
import { CheckCheck, UploadCloud } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useUploadStore } from "@/lib/stores/upload-store"
import { UploadQueueItem } from "@/components/uploads/upload-queue-item"

export function UploadQueue() {
  const queue = useUploadStore((state) => state.queue)
  const clearCompleted = useUploadStore((state) => state.clearCompleted)

  if (!queue.length) {
    return null
  }

  return (
    <motion.aside
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed right-4 bottom-4 z-40 w-[min(28rem,calc(100vw-2rem))]"
    >
      <div className="overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0f0f14] shadow-none backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-2xl bg-white/[0.06] text-zinc-300">
              <UploadCloud className="size-4" />
            </div>
            <div>
              <div className="text-sm font-medium text-white">Upload queue</div>
              <div className="text-xs text-zinc-400">
                {queue.length} item{queue.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-zinc-400 hover:text-white"
            onClick={() => clearCompleted()}
          >
            <CheckCheck className="size-4" />
            Clear done
          </Button>
        </div>
        <div className="scrollbar-hide max-h-[24rem] space-y-3 overflow-y-auto p-4">
          <AnimatePresence initial={false}>
            {queue.map((item) => (
              <UploadQueueItem item={item} key={item.id} />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </motion.aside>
  )
}
