/**
 * Every page of this portal says what it is. It is a vendor-side demo of the
 * licensing authority with no sign-in — not a customer's account. Customers
 * manage licences and release server seats at arciin.com/account.
 */
export const REAL_ACCOUNT_URL = "https://arciin.com/account"

export function DemoBanner() {
  return (
    <div
      role="note"
      className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3.5 sm:px-5"
    >
      <p className="text-[13px] leading-relaxed text-amber-950">
        <span className="font-semibold">Demo portal — this is not your Arciin account. </span>
        <span className="text-amber-900/80">
          It shows a sample customer from the licence server prototype and has no sign-in. Your
          real licences and servers are managed at{" "}
          <a href={REAL_ACCOUNT_URL} className="font-semibold underline underline-offset-2">
            arciin.com/account
          </a>
          .
        </span>
      </p>
    </div>
  )
}
