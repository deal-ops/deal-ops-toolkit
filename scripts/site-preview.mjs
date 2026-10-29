// Serves site/ locally with the headers from site/vercel.json, so checks see the production CSP (site handbook §6).
// Usage: node scripts/site-preview.mjs [port]
import { createServer } from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const ROOT = 'site'
const PORT = Number(process.argv[2] ?? 4180)
const headers = Object.fromEntries(JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')).headers[0].headers.map((h) => [h.key, h.value]))
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

createServer((req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  if (path.endsWith('/')) path += 'index.html'
  const file = join(ROOT, path)
  let size
  try {
    size = statSync(file).size
  } catch {
    res.writeHead(404, headers).end('Not found')
    return
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream'
  const body = readFileSync(file)
  // videos need byte ranges for Safari and for seeking
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '')
  if (range) {
    const start = Number(range[1])
    const end = range[2] ? Number(range[2]) : size - 1
    res.writeHead(206, {
      ...headers,
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    })
    res.end(body.subarray(start, end + 1))
    return
  }
  res.writeHead(200, { ...headers, 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' })
  res.end(body)
}).listen(PORT, () => console.log(`site preview on http://localhost:${PORT}`))
