'use client'

import { useParams, useRouter } from 'next/navigation'
import { useChat } from '@/hooks/useChat'
import { useEffect, useRef, useState } from 'react'

export default function SessionPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()  // ← add this
  const { messages, isStreaming, error, sendMessage, cancelStream } = useChat(id)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

const endSession = async () => {
  if (isStreaming) return
  
  try {
    // Generate journal entry
    await fetch('/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: id, messages }),
    })
    router.push(`/journal/${id}`)
  } catch (err) {
    console.error('Failed to end session:', err)
  }
}

  // Auto-scroll to bottom on new tokens
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async () => {
    const trimmed = input.trim()
    if (!trimmed) return
    setInput('')
    await sendMessage(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex flex-col h-screen bg-stone-950 text-stone-100">

        <div className="border-b border-stone-800 px-4 py-3 flex justify-between items-center">
  <h1 className="font-serif text-amber-400 text-sm tracking-widest uppercase">
    Lost Mine of Phandelver
  </h1>
  <button
    onClick={endSession}
    disabled={isStreaming || messages.length === 0}
    className="text-stone-500 hover:text-stone-300 text-xs disabled:opacity-30 transition-colors"
  >
    End Session →
  </button>
</div>
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.length === 0 && (
          <p className="text-center text-stone-500 italic mt-20">
            Your adventure begins. What do you do?
          </p>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`max-w-2xl mx-auto ${
              msg.role === 'user' ? 'text-right' : 'text-left'
            }`}
          >
            {msg.role === 'assistant' ? (
              <div className="prose prose-invert prose-stone max-w-none font-serif text-stone-200 leading-relaxed">
                {msg.content}
                {msg.streaming && (
                  <span className="inline-block w-2 h-4 ml-1 bg-amber-400 animate-pulse" />
                )}
              </div>
            ) : (
              <span className="inline-block bg-stone-800 text-stone-300 px-4 py-2 rounded-lg text-sm">
                {msg.content}
              </span>
            )}
          </div>
        ))}

        {error && (
          <p className="text-center text-red-400 text-sm">{error}</p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-stone-800 px-4 py-4">
        <div className="max-w-2xl mx-auto flex gap-3 items-end">
          <textarea
            className="flex-1 bg-stone-900 border border-stone-700 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-500 resize-none focus:outline-none focus:border-amber-600 text-sm"
            rows={2}
            placeholder="What do you do?"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button
              onClick={cancelStream}
              className="px-4 py-3 bg-stone-700 hover:bg-stone-600 text-stone-300 rounded-lg text-sm transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="px-4 py-3 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white rounded-lg text-sm transition-colors"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}