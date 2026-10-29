// Project website motion (docs/en/SITE_HANDBOOK.md §3.4). The page is complete without this file: it only adds classes and
// CSS custom properties (through the CSSOM, which the CSP allows; the HTML carries no style attributes) and plays the clips.
'use strict'

document.documentElement.classList.add('js')

const motion = matchMedia('(prefers-reduced-motion: no-preference)')
const moving = () => motion.matches
const onMotionChange = (fn) => motion.addEventListener('change', fn)
const wide = matchMedia('(min-width: 900px) and (min-height: 620px)')
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

document.addEventListener('DOMContentLoaded', () => {
  rotator()
  reveals()
  navPill()
  navTone()
  scrollEffects()
})

/** Hero: the phrase turns over letter by letter every 4.5 s, once through and back to the first, then stays still. Held while
    the pointer is on the title; never under reduced motion. The matching hero panel lifts with each phrase. */
function rotator() {
  const box = document.querySelector('[data-rotator]')
  if (!box) return
  const phrases = box.dataset.phrases.split('|').map((p) => p.split(':'))
  box.textContent = ''
  const items = phrases.map(([verb, rest]) => {
    const item = document.createElement('span')
    item.className = 'rot__item'
    for (const [text, cls] of [
      [verb, 'rot__verb'],
      [' ' + rest, ''],
    ]) {
      const part = document.createElement('span')
      if (cls) part.className = cls
      for (const c of text) {
        const ch = document.createElement('span')
        ch.className = 'ch'
        ch.textContent = c
        part.append(ch)
      }
      item.append(part)
    }
    box.append(item)
    return item
  })
  // letters are numbered across the whole phrase, so the stagger runs on from the verb into the rest
  for (const item of items) item.querySelectorAll('.ch').forEach((ch, i) => ch.classList.add('d' + Math.min(i, 19)))
  let at = 0
  let turns = 0
  items[0].classList.add('is-on')
  // after the entrance, the first panel lifts; once the phrase is back at the start, all three rest level
  if (moving()) setTimeout(() => lightPanel(0), 1600)
  let held = false
  const title = box.closest('h1')
  title.addEventListener('mouseenter', () => (held = true))
  title.addEventListener('mouseleave', () => (held = false))
  const timer = setInterval(() => {
    if (held || document.hidden || !moving()) return
    const from = items[at]
    at = (at + 1) % items.length
    const to = items[at]
    from.classList.remove('is-on', 'is-in')
    from.classList.add('is-out')
    to.classList.remove('is-out')
    to.classList.add('is-on', 'is-in')
    setTimeout(() => from.classList.remove('is-out'), 220)
    lightPanel(at)
    if (++turns === items.length) {
      clearInterval(timer)
      setTimeout(() => lightPanel(-1), 2400)
    }
  }, 4500)
}

/** Hero illustration: the panel for the verb the headline shows lifts a little (the rotator calls this). */
function lightPanel(i) {
  document.querySelectorAll('[data-scene] [data-step]').forEach((p) => p.classList.toggle('is-lit', Number(p.dataset.step) === i))
}

/** Headings and text float in once as they enter the view. */
function reveals() {
  const els = document.querySelectorAll('[data-reveal]')
  if (!('IntersectionObserver' in window)) return els.forEach((e) => e.classList.add('is-in'))
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        e.target.classList.add('is-in')
        io.unobserve(e.target)
      }
    },
    { rootMargin: '0px 0px -12% 0px' },
  )
  els.forEach((e) => io.observe(e))
}

/** The hover pill slides under the link the pointer or the keyboard is on. */
function navPill() {
  const list = document.querySelector('[data-nav-links]')
  const pill = document.querySelector('[data-nav-pill]')
  if (!list || !pill) return
  const move = (a) => {
    pill.style.setProperty('--pill-x', a.offsetLeft + 'px')
    pill.style.setProperty('--pill-w', a.offsetWidth + 'px')
    list.classList.add('is-hover')
  }
  for (const a of list.querySelectorAll('a')) {
    a.addEventListener('mouseenter', () => move(a))
    a.addEventListener('focus', () => move(a))
  }
  list.addEventListener('mouseleave', () => list.classList.remove('is-hover'))
  list.addEventListener('focusout', (e) => {
    if (!list.contains(e.relatedTarget)) list.classList.remove('is-hover')
  })
}

/** The glass navigation turns dark while a dark section sits under it. The watched band is the nav's own strip, in
    pixels: Intersection Observer resolves percentage margins against the width, not the height. */
function navTone() {
  const nav = document.querySelector('[data-nav]')
  const dark = document.querySelectorAll('[data-tone="dark"]')
  if (!nav || !dark.length || !('IntersectionObserver' in window)) return
  let io
  const watch = () => {
    if (io) io.disconnect()
    const r = nav.getBoundingClientRect()
    const mid = Math.round(r.top + r.height / 2)
    const under = new Set()
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) under.add(e.target)
          else under.delete(e.target)
        nav.classList.toggle('is-dark', under.size > 0)
      },
      { rootMargin: `-${mid}px 0px -${Math.max(0, innerHeight - mid - 1)}px 0px` },
    )
    dark.forEach((d) => io.observe(d))
  }
  watch()
  addEventListener('resize', watch)
}

/** Scroll-linked work, done once per frame: the step deck and which clip plays. */
function scrollEffects() {
  const deck = document.querySelector('[data-deck]')
  const cards = deck ? [...deck.querySelectorAll('[data-card]')] : []
  const cardsBox = deck && deck.querySelector('.deck__cards')
  const links = deck ? [...deck.querySelectorAll('[data-deck-link]')] : []
  const videos = cards.map((c) => c.querySelector('[data-video]'))
  let visible = new Set()
  let active = -1
  let queued = false

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries)
        if (e.isIntersecting) visible.add(e.target)
        else visible.delete(e.target)
      queue()
    })
    videos.forEach((v) => v && io.observe(v))
  }

  const pinned = () => wide.matches && motion.matches

  // Each clip plays once from the start whenever its card becomes the one to watch (pinned: the top card once it is 75 %
  // up; unpinned: in view), then rests on its last frame. A hidden tab only pauses it, so it resumes
  // where it was.
  const turn = new Map()
  function play(i) {
    videos.forEach((v, j) => {
      if (!v) return
      const mine = visible.has(v) && (pinned() ? j === i : true)
      if (mine && !turn.get(v)) {
        v.currentTime = 0
        if (v.preload === 'none') v.preload = 'auto'
      }
      turn.set(v, mine)
      if (mine && moving() && !document.hidden && !v.ended) v.play().catch(() => {})
      else v.pause()
    })
  }

  function frame() {
    queued = false
    if (!deck) return
    if (!pinned()) {
      for (const c of cards) for (const k of ['--ty', '--s', '--dim']) c.style.removeProperty(k)
      play(-1)
      return
    }
    const rect = deck.getBoundingClientRect()
    const run = deck.offsetHeight - innerHeight
    const p = clamp(-rect.top / run, 0, 1) * (cards.length - 1)
    // Card i comes up from below the stage as p goes i − 1 → i (cards later in the page paint on top, so no z-index swap
    // and no cut); once covered it steps back 14 px and 4 % per card above it, and darkens, so its top edge peeks out.
    const below = cardsBox.offsetHeight + 48
    cards.forEach((c, i) => {
      const up = i === 0 ? 1 : easeInOut(clamp(p - (i - 1), 0, 1))
      const back = easeInOut(clamp(p - i, 0, 1)) + easeInOut(clamp(p - i - 1, 0, 1))
      c.style.setProperty('--ty', ((1 - up) * below - back * 14).toFixed(2) + 'px')
      c.style.setProperty('--s', (1 - back * 0.04).toFixed(4))
      c.style.setProperty('--dim', Math.min(back, 1).toFixed(3))
    })
    const now = clamp(Math.round(p), 0, cards.length - 1)
    // the clip to watch: the top card that is at least 75 % up
    let watch = 0
    for (let i = 1; i < cards.length; i++) if (p - (i - 1) >= 0.75) watch = i
    links.forEach((a, i) => a.querySelector('.deck__bar > span').style.setProperty('--fill', clamp(p - i + 1, 0, 1).toFixed(3)))
    // aria-current only changes when the step does, so screen readers are not told on every frame
    if (now !== active)
      links.forEach((a, i) => {
        if (i === now) a.setAttribute('aria-current', 'step')
        else a.removeAttribute('aria-current')
      })
    play(watch)
    active = now
  }

  function queue() {
    if (queued) return
    queued = true
    requestAnimationFrame(frame)
  }

  // the step links scroll to where that card is fully up, not to the card's own (stacked) position
  links.forEach((a, i) => {
    a.addEventListener('click', (e) => {
      if (!pinned()) return
      e.preventDefault()
      const run = deck.offsetHeight - innerHeight
      const top = deck.getBoundingClientRect().top + scrollY + (run * i) / (cards.length - 1)
      scrollTo({ top, behavior: 'smooth' })
    })
  })

  addEventListener('scroll', queue, { passive: true })
  addEventListener('resize', queue)
  onMotionChange(queue)
  document.addEventListener('visibilitychange', queue)
  wide.addEventListener('change', queue)
  queue()
}
