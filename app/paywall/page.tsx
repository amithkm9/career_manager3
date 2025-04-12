import { AppHeader } from "@/components/app-header"
import { Footer } from "@/components/footer"
import { PaywallContent } from "@/components/paywall/paywall-content"

export default function PaywallPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1 container py-12 px-4 md:px-6">
        <PaywallContent />
      </main>
      <Footer />
    </div>
  )
}
