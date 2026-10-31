// HTTP Request nodes run with "Never Error" + "Full Response" and onError=continueRegularOutput, so their
// output item is either { statusCode, headers, body } or { error } (timeouts / network failures).
function redact(text) {
  return String(text)
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/AIza[0-9A-Za-z_-]+/g, '[redacted]')
    .replace(/https:\/\/hooks\.slack\.com\/[^\s"']+/g, '[redacted-slack-url]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
}

function truncate(text, max) {
  const s = String(text)
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function errorText(error) {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    for (const key of ['message', 'description', 'code']) {
      if (typeof error[key] === 'string' && error[key]) return error[key]
    }
  }
  return 'Request failed'
}

function httpResult(item) {
  if (!item || typeof item !== 'object') return { ok: false, status: null, body: null, error: 'No response' }
  if (!('statusCode' in item)) {
    return { ok: false, status: null, body: null, error: truncate(redact(errorText(item.error)), 500) }
  }
  const status = typeof item.statusCode === 'number' ? item.statusCode : Number(item.statusCode) || null
  const ok = status !== null && status >= 200 && status < 300
  if (ok) return { ok, status, body: item.body ?? null, error: null }
  let detail = ''
  const body = item.body
  if (body && typeof body === 'object') {
    detail = body.message || (body.error && body.error.message) || body.msg || body.hint || ''
  } else if (typeof body === 'string') {
    detail = body
  }
  const error = `HTTP ${status ?? 'error'}${detail ? `: ${detail}` : ''}`
  return { ok, status, body: body ?? null, error: truncate(redact(error), 500) }
}
