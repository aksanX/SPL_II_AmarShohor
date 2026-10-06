import { Camera, Circle, Square, Video, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useAppSettings } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { startLiveCapture } from '../lib/api'
import { getCurrentPosition } from '../lib/geo'
import { uploadMedia } from '../lib/media'
import { mediaUrl } from '../lib/supabase'
import type { UploadedMedia } from '../lib/types'
import { Spinner } from './ui'

const MAX_LIVE_VIDEO_SECONDS = 15

type Capture = { token: string; code: string; deadline: number; lat: number; lng: number; accuracy: number }

function pickVideoType() {
  for (const t of ['video/webm;codecs=vp8', 'video/webm', 'video/mp4']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return null
}

function stampText(c: Capture) {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  return [`AmarShohor LIVE · ${c.code}`, `${time} · ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} ±${Math.round(c.accuracy)} m`]
}

/** Draws the camera frame with the live stamp in the bottom-left corner. */
function drawFrame(canvas: HTMLCanvasElement, video: HTMLVideoElement, c: Capture) {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) return
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(video, 0, 0, w, h)
  const lines = stampText(c)
  const size = Math.max(14, Math.round(w / 40))
  ctx.font = `bold ${size}px system-ui, sans-serif`
  const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + size
  const boxH = size * 1.4 * lines.length + size * 0.6
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.fillRect(0, h - boxH, boxW, boxH)
  ctx.fillStyle = '#fff'
  lines.forEach((l, i) => ctx.fillText(l, size / 2, h - boxH + size * 1.4 * (i + 1)))
}

/**
 * In-app camera for live evidence: no gallery. Each photo/video gets a one-time
 * code from the server (tied to time and GPS) that is stamped on it, and is
 * uploaded straight away so the server can check it was taken just now.
 */
export function LiveCamera({ media, onChange, max = 3, label = 'Take live photo or video' }: {
  media: UploadedMedia[]; onChange: (m: UploadedMedia[]) => void; max?: number; label?: string
}) {
  const { user } = useAuth()
  const toast = useToast()
  const windowSeconds = useAppSettings().data?.live_capture_seconds ?? 120
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const [capture, setCapture] = useState<Capture | null>(null)
  const [state, setState] = useState<'idle' | 'starting' | 'live' | 'recording' | 'uploading'>('idle')
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [recorded, setRecorded] = useState(0)

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCapture(null)
  }
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), [])

  // Keep the stamped preview running and count down the time left to take the shot.
  useEffect(() => {
    if (!capture) return
    let frame = 0
    const tick = () => {
      if (videoRef.current && canvasRef.current) drawFrame(canvasRef.current, videoRef.current, capture)
      frame = requestAnimationFrame(tick)
    }
    tick()
    const timer = setInterval(() => {
      const left = Math.round((capture.deadline - Date.now()) / 1000)
      setSecondsLeft(left)
      if (left <= 0 && !recorderRef.current) {
        stopCamera()
        setState('idle')
        toast.info('The live photo window closed. Open the camera again.')
      }
    }, 500)
    return () => { cancelAnimationFrame(frame); clearInterval(timer) }
  }, [capture]) // eslint-disable-line react-hooks/exhaustive-deps

  async function open() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error(new Error('This browser cannot open the camera. Try Chrome or Safari on your phone.'))
      return
    }
    setState('starting')
    try {
      const pos = await getCurrentPosition()
      const t = await startLiveCapture(pos.lat, pos.lng, pos.accuracy)
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      // Leave a few seconds for the upload inside the server's window.
      setCapture({ token: t.token, code: t.code, deadline: Date.now() + (windowSeconds - 10) * 1000, ...pos })
      setState('live')
    } catch (e) {
      stopCamera()
      setState('idle')
      toast.error(e instanceof DOMException && e.name === 'NotAllowedError'
        ? new Error('Camera permission denied. Allow the camera for this site and try again.') : e)
    }
  }

  async function upload(file: File) {
    if (!user || !capture) return
    setState('uploading')
    const token = capture.token
    stopCamera()
    try {
      const [m] = await uploadMedia(user.id, [file])
      onChange([...media, { ...m, token }])
    } catch (e) {
      toast.error(e)
    } finally {
      setState('idle')
    }
  }

  function takePhoto() {
    canvasRef.current?.toBlob((b) => {
      if (b) upload(new File([b], 'live.jpg', { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.9)
  }

  function startVideo() {
    const type = pickVideoType()
    if (!type || !canvasRef.current) {
      toast.error(new Error('This browser cannot record video. Take a photo instead.'))
      return
    }
    const chunks: Blob[] = []
    const rec = new MediaRecorder(canvasRef.current.captureStream(24), { mimeType: type })
    recorderRef.current = rec
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      recorderRef.current = null
      const base = type.split(';')[0]
      upload(new File(chunks, base === 'video/mp4' ? 'live.mp4' : 'live.webm', { type: base }))
    }
    rec.start(1000)
    setState('recording')
    const started = Date.now()
    const timer = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000)
      setRecorded(s)
      if (s >= MAX_LIVE_VIDEO_SECONDS || rec.state !== 'recording') {
        clearInterval(timer)
        if (rec.state === 'recording') rec.stop()
      }
    }, 250)
  }

  const hasVideo = media.some((m) => m.type === 'video')

  return (
    <div className="space-y-2">
      {media.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {media.map((m) => (
            <div key={m.path} className="relative size-24 overflow-hidden rounded-lg border border-line bg-black/5">
              {m.type === 'video'
                ? <video src={mediaUrl(m.path)} className="size-full object-cover" muted playsInline />
                : <img src={mediaUrl(m.path)} alt="" className="size-full object-cover" />}
              <span className="absolute left-1 top-1 rounded bg-danger px-1 text-[10px] font-bold text-white">LIVE</span>
              <button type="button" aria-label="Remove" onClick={() => onChange(media.filter((x) => x.path !== m.path))}
                className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/60 text-white">
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={capture || state === 'starting' ? 'space-y-2' : 'hidden'}>
        <div className="relative overflow-hidden rounded-lg bg-black">
          {/* Not display:none: some phones stop delivering frames to hidden videos. */}
          <video ref={videoRef} className="pointer-events-none absolute size-px opacity-0" muted playsInline />
          <canvas ref={canvasRef} className="w-full" />
          <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
            {state === 'recording' ? `● ${recorded}s / ${MAX_LIVE_VIDEO_SECONDS}s` : `${Math.max(secondsLeft, 0)}s left`}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {state === 'recording' ? (
            <button type="button" className="btn-danger col-span-2" onClick={() => recorderRef.current?.stop()}>
              <Square className="size-4" /> Stop
            </button>
          ) : (
            <>
              <button type="button" className="btn-danger" onClick={takePhoto} disabled={state !== 'live'}>
                <Camera className="size-4" /> Photo
              </button>
              <button type="button" className="btn-soft" onClick={startVideo} disabled={state !== 'live' || hasVideo || secondsLeft < MAX_LIVE_VIDEO_SECONDS + 5}>
                <Circle className="size-4 text-danger" /> Video
              </button>
            </>
          )}
          <button type="button" className="btn-soft" disabled={state === 'recording'}
            onClick={() => { stopCamera(); setState('idle') }}>Cancel</button>
        </div>
      </div>

      {!capture && media.length < max && (
        <button type="button" className="btn-soft w-full" onClick={open} disabled={state !== 'idle'}>
          {state === 'idle' ? <><Video className="size-4" /> {label}</> : <><Spinner className="size-4" /> {state === 'uploading' ? 'Sending…' : 'Opening camera…'}</>}
        </button>
      )}
      <p className="text-xs text-muted">
        Only photos taken here count: the app stamps a one-time code, the time and your GPS on them. Don't go closer to danger for a photo.
      </p>
    </div>
  )
}
