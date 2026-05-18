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
          className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-white/70 p-8 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ duration: 0.18 }}
            className="flex w-full max-w-md flex-col items-center gap-5 rounded-3xl border-2 border-dashed border-[#FF4F12]/50 bg-white px-10 py-12 shadow-2xl shadow-black/10"
          >
            <div className="flex size-14 items-center justify-center rounded-2xl bg-[#FF4F12]/10 text-[#FF4F12] ring-4 ring-[#FF4F12]/15">
              <Upload className="size-6" />
            </div>
            <div className="space-y-1.5 text-center">
              <p className="text-[17px] font-semibold tracking-tight text-zinc-950">
                Drop files to upload
              </p>
              <p className="text-[13px] leading-relaxed text-zinc-600">
                Arciin will detect the type and place them in the right library.
              </p>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
