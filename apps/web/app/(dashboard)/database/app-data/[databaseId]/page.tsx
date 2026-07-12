"use client"

import { use } from "react"

import { AppDatabaseDetailPage } from "@/components/database/app-database-detail-page"

export default function AppDataDatabaseDetailPage({
  params,
}: {
  params: Promise<{ databaseId: string }>
}) {
  const { databaseId } = use(params)
  return <AppDatabaseDetailPage key={databaseId} databaseId={databaseId} />
}
