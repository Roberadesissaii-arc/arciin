import { redirect } from "next/navigation"

/** Old route — password recovery now lives at /forgot-password. */
export default function LegacyForgotPasswordPage() {
  redirect("/forgot-password")
}
