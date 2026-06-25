'use client'

export default function PricingListPage() {
  return (
    <div className="max-w-3xl mx-auto py-16 px-4 text-center">
      <div className="bg-white rounded-xl border border-gray-200 p-12">
        <p className="text-4xl mb-4">$</p>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Pricing Projects</h1>
        <p className="text-sm text-gray-500">
          Select a pricing project from the sidebar, or click the <strong>+</strong> button to create a new one.
        </p>
      </div>
    </div>
  )
}
