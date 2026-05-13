"use client"

import { useQuery } from "@tanstack/react-query"

import { getActivity } from "@/lib/api/activity"
import { queryKeys } from "@/lib/api/query-keys"

export function useActivity() {
  return useQuery({
    queryKey: queryKeys.activity(),
    queryFn: ({ signal }) => getActivity(signal),
  })
}
