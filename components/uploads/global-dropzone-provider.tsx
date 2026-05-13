"use client"

import { useCallback, useEffect } from "react"

import { UploadOverlay } from "@/components/uploads/upload-overlay"
import { UploadQueue } from "@/components/uploads/upload-queue"
import { useGlobalDropzone } from "@/hooks/use-global-dropzone"
import { useUploadOrchestrator } from "@/hooks/use-upload-orchestrator"

export function GlobalDropzoneProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const uploadFiles = useUploadOrchestrator()

  const handleFiles = useCallback(
    (files: File[]) => {
      void uploadFiles(files)
    },
    [uploadFiles]
  )

  useGlobalDropzone(handleFiles)

  useEffect(() => {
    const onSelected = (event: Event) => {
      const customEvent = event as CustomEvent<File[]>

      if (customEvent.detail?.length) {
        handleFiles(customEvent.detail)
      }
    }

    window.addEventListener("arciin:files-selected", onSelected as EventListener)

    return () => {
      window.removeEventListener("arciin:files-selected", onSelected as EventListener)
    }
  }, [handleFiles])

  return (
    <>
      {children}
      <UploadOverlay />
      <UploadQueue />
    </>
  )
}
