import { useRef, useState } from 'react'
import type { MessageAttachment } from '../types/agent'

interface ChatInputProps {
  onSend: (content: string, enableSearch?: boolean, images?: MessageAttachment[]) => void
  disabled?: boolean
}


const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB
const COMPRESS_THRESHOLD = 2 * 1024 * 1024 // 2MB 以上触发压缩

function compressImage(dataUrl: string, maxWidth = 1920, quality = 0.85): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxWidth / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

async function processImage(file: File, onError?: (msg: string) => void): Promise<{ dataUrl: string; name: string; type: 'image' } | null> {
  if (file.size > MAX_IMAGE_SIZE) {
    onError?.(`图片 "${file.name}" 超过 10MB 限制，请压缩后重试。`)
    return null
  }
  let dataUrl = await fileToDataUrl(file)
  if (file.size > COMPRESS_THRESHOLD) {
    dataUrl = await compressImage(dataUrl)
  }
  return { dataUrl, name: file.name, type: 'image' }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [content, setContent] = useState('')
  const [enableSearch, setEnableSearch] = useState(false)
  const [images, setImages] = useState<MessageAttachment[]>([])
  const [fileError, setFileError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    if ((!content.trim() && images.length === 0) || disabled) return
    onSend(content, enableSearch, images.length > 0 ? images : undefined)
    setContent('')
    setImages([])
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    submit()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const imageFiles = files.filter((f) => f.type.startsWith('image/'))
    const results = await Promise.all(imageFiles.map((f) => processImage(f, (msg) => setFileError(msg))))
    const newImages = results.filter((r): r is NonNullable<typeof r> => r !== null)
    setImages((prev) => [...prev, ...newImages])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index))
  }

  const canSend = content.trim() || images.length > 0

  return (
    <form className="chat-input" onSubmit={handleSubmit}>
      {fileError && (
        <div className="chat-file-error">
          {fileError}
          <button type="button" onClick={() => setFileError('')}>✕</button>
        </div>
      )}
      {images.length > 0 && (
        <div className="image-preview-bar">
          {images.map((img, i) => (
            <div key={i} className="image-preview-item">
              <img src={img.dataUrl} alt={img.name} />
              <button
                type="button"
                className="image-preview-remove"
                onClick={() => removeImage(i)}
                title="移除图片"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="chat-input-toolbar">
        <button
          type="button"
          className={`search-toggle ${enableSearch ? 'active' : ''}`}
          onClick={() => setEnableSearch((v) => !v)}
          title={enableSearch ? '已开启联网搜索' : '点击开启联网搜索'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span>联网搜索</span>
        </button>
        <button
          type="button"
          className="search-toggle"
          onClick={() => fileInputRef.current?.click()}
          title="上传图片"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <span>图片</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>
      <div className="chat-input-row">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            images.length > 0
              ? '描述你的问题（可选），按 Enter 发送…'
              : enableSearch
                ? '输入消息（将联网搜索），按 Enter 发送…'
                : '输入消息，按 Enter 发送，Shift + Enter 换行…'
          }
          rows={1}
          disabled={disabled}
        />
        <button type="submit" disabled={disabled || !canSend}>
          发送
        </button>
      </div>
    </form>
  )
}
