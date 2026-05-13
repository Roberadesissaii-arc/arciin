"use client"

import { motion, AnimatePresence } from "framer-motion"
import { Upload } from "lucide-react"

import { UploadDestinationReview } from "@/components/uploads/upload-destination-review"
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
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="w-full max-w-2xl rounded-[2rem] border border-[#FF4B33]/20 bg-[radial-gradient(circle_at_top_right,rgba(255,75,51,0.18),transparent_45%),rgba(9,9,11,0.96)] p-8 shadow-[0_0_80px_rgba(255,75,51,0.14)]"
          >
            <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-3xl bg-primary text-white shadow-[0_0_40px_rgba(255,75,51,0.2)]">
              <Upload className="size-7" />
            </div>
            <div className="space-y-3 text-center">
              <h2 className="text-3xl font-semibold tracking-tight text-white">
                Drop files anywhere.
              </h2>
              <p className="mx-auto max-w-xl text-sm leading-6 text-zinc-400">
                Arciin will detect the type and place them in the right library.
              </p>
            </div>
            <div className="mt-8">
              <UploadDestinationReview />
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
