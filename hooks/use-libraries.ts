"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { createFolder, getFolders, getLibraries, getLibrary } from "@/lib/api/libraries"
import { queryKeys } from "@/lib/api/query-keys"
import type { CreateFolderInput } from "@/lib/types/models"

export function useLibraries() {
  return useQuery({
    queryKey: queryKeys.libraries,
    queryFn: ({ signal }) => getLibraries(signal),
  })
}

export function useLibrary(libraryId: string) {
  return useQuery({
    queryKey: queryKeys.library(libraryId),
    queryFn: ({ signal }) => getLibrary(libraryId, signal),
    enabled: Boolean(libraryId),
  })
}

export function useFolders(libraryId: string, folderId?: string | null) {
  return useQuery({
    queryKey: queryKeys.folders(libraryId, folderId),
    queryFn: ({ signal }) => getFolders(libraryId, signal),
    enabled: Boolean(libraryId),
  })
}

export function useCreateFolder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateFolderInput) => createFolder(input),
    onSuccess: (folder) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.folders(folder.libraryId, folder.parentFolderId),
      })
    },
  })
}
