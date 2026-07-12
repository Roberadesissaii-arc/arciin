"use client"

import { FeatureGate } from "@/components/license/feature-gate"
import { AppDatabasesPage } from "@/components/database/app-databases-page"

export default function AppDataDatabasesPage() {
  return (
    <FeatureGate feature="developer.app_databases">
      <AppDatabasesPage />
    </FeatureGate>
  )
}
