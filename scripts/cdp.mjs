/**
 * A minimal Chrome DevTools Protocol client — just enough to drive the real app
 * with *native* input events. Synthetic dispatchEvent() clicks differ from real
 * ones in focus handling and event ordering, which is exactly where UI bugs
 * hide, so the test harness must not use them.
 */
import { OUT_DIR } from './outdir.mjs'
import { createConnection } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'

/** Chrome's location, overridable for non-macOS or Chromium installs. */
export const CHROME_PATH =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export async function launchChrome({
  port = 9222,
  headless = true,
  userDataDir = `${OUT_DIR}/chrome-cdp`,
} = {}) {
  const chrome = spawn(CHROME_PATH, [
    ...(headless ? ['--headless=new'] : []),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-gpu',
    'about:blank',
  ])
  chrome.on('error', (e) => {
    throw e
  })

  // Wait for the debugging endpoint to come up.
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) return chrome
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('Chrome debugging port never opened')
}

export async function openPage(url, port = 9222) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  })
  const target = await res.json()
  const ws = await connectWs(target.webSocketDebuggerUrl)
  return new Session(ws)
}

class Session {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    ws.onMessage((text) => {
      const msg = JSON.parse(text)
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message))
      else p.resolve(msg.result)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`))
      }, 30_000)
    })
  }

  /** Evaluate an expression in the page and return its JSON value. */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? 'evaluation failed')
    }
    return r.result.value
  }

  /** A real mouse click: press and release at viewport coordinates. */
  async click(x, y) {
    const base = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 }
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
    await sleep(30)
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
    await sleep(60)
  }

  async typeText(text) {
    await this.send('Input.insertText', { text })
    await sleep(60)
  }

  /** Viewport centre of the first element matching a selector. */
  async centreOf(selector) {
    return this.eval(`
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
    `)
  }

  close() {
    this.ws.close()
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Bare-bones RFC 6455 client: handshake, then masked text frames. */
function connectWs(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const key = randomBytes(16).toString('base64')
    const socket = createConnection(
      { host: u.hostname, port: Number(u.port || 80) },
      () => {
        socket.write(
          `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
            `Host: ${u.host}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Key: ${key}\r\n` +
            'Sec-WebSocket-Version: 13\r\n\r\n',
        )
      },
    )
    socket.on('error', reject)

    let buffer = Buffer.alloc(0)
    let handshakeDone = false
    let onMessage = () => {}
    const expected = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64')

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])

      if (!handshakeDone) {
        const end = buffer.indexOf('\r\n\r\n')
        if (end === -1) return
        const headers = buffer.subarray(0, end).toString()
        if (!headers.includes(expected)) {
          reject(new Error('websocket handshake rejected'))
          return
        }
        buffer = buffer.subarray(end + 4)
        handshakeDone = true
        resolve({
          send: (text) => socket.write(encodeFrame(text)),
          onMessage: (fn) => (onMessage = fn),
          close: () => socket.destroy(),
        })
      }

      // Decode as many complete frames as the buffer holds.
      for (;;) {
        if (buffer.length < 2) return
        const len0 = buffer[1] & 0x7f
        let offset = 2
        let length = len0
        if (len0 === 126) {
          if (buffer.length < 4) return
          length = buffer.readUInt16BE(2)
          offset = 4
        } else if (len0 === 127) {
          if (buffer.length < 10) return
          length = Number(buffer.readBigUInt64BE(2))
          offset = 10
        }
        if (buffer.length < offset + length) return
        const payload = buffer.subarray(offset, offset + length).toString('utf8')
        buffer = buffer.subarray(offset + length)
        if ((buffer[0] & 0x0f) !== 0x8) onMessage(payload)
      }
    })
  })
}

function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8')
  const mask = randomBytes(4)
  let header
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length])
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 0x80 | 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }
  const masked = Buffer.from(payload)
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4]
  return Buffer.concat([header, mask, masked])
}
