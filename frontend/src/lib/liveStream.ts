/** A server-sent-events stream that keeps itself connected.
 *
 *  Browsers can drop a stream while a tab is in the background, the laptop sleeps, or the (free) server
 *  restarts, and a dropped EventSource can give up for good. This one reconnects with a growing delay,
 *  and right away when the tab becomes visible again or the network comes back.
 *  Returns a function that closes it for good. */
export function liveStream(
  url: string,
  events: Record<string, (data: unknown) => void>,
  onStatus?: (live: boolean) => void,
) {
  let es: EventSource | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let delay = 1000
  let stopped = false

  const connect = () => {
    if (stopped) return
    if (retry) { clearTimeout(retry); retry = null }
    es?.close()
    es = new EventSource(url)
    es.onopen = () => { delay = 1000; onStatus?.(true) }
    for (const [name, fn] of Object.entries(events)) {
      es.addEventListener(name, (e) => { onStatus?.(true); fn(JSON.parse((e as MessageEvent).data)) })
    }
    es.onerror = () => {
      onStatus?.(false)
      if (es?.readyState === EventSource.CLOSED && !retry) {   // the browser gave up: retry ourselves
        retry = setTimeout(connect, delay)
        delay = Math.min(delay * 2, 30_000)
      }
    }
  }
  const revive = () => {
    if (document.visibilityState === 'visible' && es?.readyState !== EventSource.OPEN) { delay = 1000; connect() }
  }

  connect()
  document.addEventListener('visibilitychange', revive)
  window.addEventListener('online', revive)
  return () => {
    stopped = true
    if (retry) clearTimeout(retry)
    es?.close()
    document.removeEventListener('visibilitychange', revive)
    window.removeEventListener('online', revive)
  }
}
