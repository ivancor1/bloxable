'use client'

import { useAppStore } from '@/lib/state/store'

export default function PaywallModal({ onClose }: { onClose: () => void }) {
  const credits = useAppStore((s) => s.credits)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <p>You&apos;re out of free credits.</p>
        <p className="dim">
          Resets daily · {credits.total}/{credits.total} used
        </p>
        <button className="btn" disabled>
          Upgrade — payments not wired in this build
        </button>
      </div>
    </div>
  )
}
