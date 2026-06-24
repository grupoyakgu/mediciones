'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  projectId: string
  initialName: string
}

export default function ProjectHeader({ projectId, initialName }: Props) {
  const [name, setName] = useState(initialName)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  function startEdit() {
    setDraft(name)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  async function save() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === name) { setEditing(false); return }
    setSaving(true)
    await fetch(`/api/projects/${projectId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
    setName(trimmed)
    setEditing(false)
    setSaving(false)
    window.dispatchEvent(new Event('projectsChanged'))
    router.refresh()
  }

  function cancel() {
    setEditing(false)
    setDraft(name)
  }

  return (
    <div className="border-b border-gray-200 pb-6">
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
            className="text-xl font-semibold text-gray-900 border border-blue-400 rounded-lg px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0 flex-1 max-w-md"
          />
          <button
            onClick={save}
            disabled={saving || !draft.trim()}
            className="text-sm px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={cancel}
            className="text-sm px-3 py-1 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 group">
          <h1 className="text-xl font-semibold text-gray-900">{name}</h1>
          <button
            onClick={startEdit}
            title="Rename project"
            className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 text-sm px-1.5 py-0.5 rounded hover:bg-gray-100"
          >
            ✎
          </button>
        </div>
      )}
      <p className="text-sm text-gray-500 mt-0.5">Overview · approved invoices only</p>
    </div>
  )
}
