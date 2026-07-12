"use client"

import { use } from "react"

import { AdminTableDetailPanel } from "@/components/database/admin-table-detail-panel"

export default function TablePage({ params }: { params: Promise<{ table: string }> }) {
  const { table } = use(params)
  return <AdminTableDetailPanel table={table} />
}
