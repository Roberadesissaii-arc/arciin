"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  createFolder,
  deleteFolder,
  getFolders,
  getLibraries,
  getLibrary,
  lockFolder,
  removeFolderLock,
  unlockFolder,
  updateFolder,
  type FolderCredentialInput,
} from "@/lib/api/libraries"
import type { FolderSummary } from "@/lib/types/models"
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
      void queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) && q.queryKey[0] === "folders" && q.queryKey[1] === folder.libraryId,
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
    },
  })
}

function invalidateLibraryFolderTree(queryClient: ReturnType<typeof useQueryClient>, libraryId: string) {
  void queryClient.invalidateQueries({
    predicate: (q) =>
      Array.isArray(q.queryKey) && q.queryKey[0] === "folders" && q.queryKey[1] === libraryId,
  })
  void queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
  void queryClient.invalidateQueries({ queryKey: ["assets"] })
}

export function useUpdateFolder() {
  const queryClient = useQueryClient()

  return useMutation<
    FolderSummary,
    Error,
    { folderId: string; libraryId: string; name?: string; hideFromAllFiles?: boolean }
  >({
    mutationFn: (variables) =>
      updateFolder(variables.folderId, {
        ...(variables.name !== undefined ? { name: variables.name } : {}),
        ...(variables.hideFromAllFiles !== undefined
          ? { hideFromAllFiles: variables.hideFromAllFiles }
          : {}),
      }),
    onSuccess: (_, variables) => {
      invalidateLibraryFolderTree(queryClient, variables.libraryId)
      void queryClient.invalidateQueries({ queryKey: ["assets"] })
    },
  })
}

export function useDeleteFolder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (variables: { folderId: string; libraryId: string }) => deleteFolder(variables.folderId),
    onSuccess: (_, variables) => {
      invalidateLibraryFolderTree(queryClient, variables.libraryId)
    },
  })
}

export function useLockFolder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (variables: { folderId: string; libraryId: string; input: FolderCredentialInput }) =>
      lockFolder(variables.folderId, variables.input),
    onSuccess: (_, variables) => {
      invalidateLibraryFolderTree(queryClient, variables.libraryId)
    },
  })
}

export function useUnlockFolder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (variables: { folderId: string; libraryId: string; input: FolderCredentialInput }) =>
      unlockFolder(variables.folderId, variables.input),
    onSuccess: (_, variables) => {
      invalidateLibraryFolderTree(queryClient, variables.libraryId)
      void queryClient.invalidateQueries({ queryKey: ["assets"] })
    },
  })
}

export function useRemoveFolderLock() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (variables: { folderId: string; libraryId: string; input: FolderCredentialInput }) =>
      removeFolderLock(variables.folderId, variables.input),
    onSuccess: (_, variables) => {
      invalidateLibraryFolderTree(queryClient, variables.libraryId)
    },
  })
}
