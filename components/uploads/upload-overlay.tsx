"use client"

import { motion, AnimatePresence } from "framer-motion"
import { Upload } from "lucide-react"

import { useUploadStore } from "@/lib/stores/upload-store"

export function UploadOverlay() {
  const overlayVisible = useUploadStore((state) => state.overlayVisible)

  return (
    <AnimatePresence>
      {overlayVisible ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center p-8"
          style={{
            background: "rgba(250,250,252,0.82)",
            backdropFilter: "blur(6px)",
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ duration: 0.18 }}
            className="flex w-full max-w-md flex-col items-center gap-5 rounded-3xl border-2 border-dashed border-primary/40 bg-white/70 px-10 py-12 shadow-xl shadow-primary/5"
          >
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-4 ring-primary/10">
              <Upload className="size-6" />
            </div>
            <div className="space-y-1.5 text-center">
              <p className="text-[17px] font-semibold tracking-tight text-zinc-900">
                Drop files to upload
              </p>
              <p className="text-[13px] leading-relaxed text-zinc-500">
                Arciin will detect the type and place them in the right library.
              </p>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
