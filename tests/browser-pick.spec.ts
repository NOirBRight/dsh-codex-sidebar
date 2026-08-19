import { describe, expect, it } from 'vitest'
import { DCS_PICK_SCRIPT } from '../src/browser-pick-script.ts'
import {
  PICK_DRAG_THRESHOLD,
  clampRect,
  mapIframeRect,
  formatElementMark,
  formatLassoMark,
  formatPickContext,
  formatPickLabel,
  formatPickMark,
  formatPointMark,
  injectPickScript,
  isLassoGesture,
  isLoopbackHttpUrl,
  liveUrlFromFrameSrc,
  parsePickProxyPath,
  pickElementName,
  pickProxyPath,
  placePill,
  pointBox,
  rectFromPoints,
  rectsIntersect,
  resolveProxyUpstream,
  shortPickCaption,
} from '../src/browser-pick.ts'

describe('Browser 批注 pick gesture', () => {
  it('ships syntactically valid injected guest JavaScript', () => {
    expect(() => new Function(DCS_PICK_SCRIPT)).not.toThrow()
  })

  it('treats movement under the threshold as a click and 5px+ as 圈选', () => {
    expect(PICK_DRAG_THRESHOLD).toBe(5)
    expect(isLassoGesture(0, 0)).toBe(false)
    expect(isLassoGesture(4, 0)).toBe(false)
    expect(isLassoGesture(4, 2)).toBe(false)
    expect(isLassoGesture(5, 0)).toBe(true)
    expect(isLassoGesture(3, 4)).toBe(true)
    expect(isLassoGesture(-6, 1)).toBe(true)
  })

  it('normalizes drag corners into a rect and clamps it to the overlay', () => {
    expect(rectFromPoints(20, 10, 5, 40)).toEqual({ x: 5, y: 10, w: 15, h: 30 })
    expect(clampRect({ x: -8, y: 2, w: 40, h: 10 }, 20, 20)).toEqual({ x: 0, y: 2, w: 20, h: 10 })
    expect(pointBox(10, 10, 16)).toEqual({ x: 2, y: 2, w: 16, h: 16 })
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 4, h: 4 })).toBe(true)
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 4, h: 4 })).toBe(false)
    expect(mapIframeRect({ x: 10, y: 20, w: 100, h: 40 }, { x: 50, y: 80 }, { x: 50, y: 80 }))
      .toEqual({ x: 10, y: 20, w: 100, h: 40 })
    expect(mapIframeRect({ x: 10, y: 20, w: 100, h: 40 }, { x: 50, y: 80 }, { x: 40, y: 60 }))
      .toEqual({ x: 20, y: 40, w: 100, h: 40 })
  })

  it('formats element, point, and 圈选 marks without inventing selectors', () => {
    expect(formatElementMark('BUTTON', 'go', '', 1)).toBe('button#go')
    expect(formatElementMark('H1', '', 'signin hero', 1)).toBe('h1.signin')
    expect(formatElementMark('A', '', '', 3)).toBe('a:nth-of-type(3)')
    expect(formatPointMark('http://127.0.0.1:1420', 12.4, 40.6)).toBe('http://127.0.0.1:1420 @ 12,41')
    expect(formatLassoMark('http://localhost:5173', { x: 8, y: 16, w: 40, h: 20 })).toBe(
      'http://localhost:5173 @ 8,16 40×20',
    )
    expect(formatLassoMark('http://localhost:5173', { x: 8, y: 16, w: 40, h: 20 }, ['button.submit', 'h1.signin']))
      .toBe('button.submit, h1.signin @ 8,16 40×20')
    expect(formatPickMark({
      mode: 'click',
      origin: 'same',
      url: 'http://localhost:5173',
      x: 4,
      y: 8,
      selector: 'button.submit',
    })).toBe('button.submit')
    expect(formatPickMark({
      mode: 'click',
      origin: 'cross',
      url: 'http://127.0.0.1:1420',
      x: 4,
      y: 8,
    })).toBe('http://127.0.0.1:1420 @ 4,8')
  })

  it('formats Cursor-inspect labels from name then tag', () => {
    expect(formatPickLabel('AssistantMarkdown', 'li')).toBe('AssistantMarkdown · li')
    expect(formatPickLabel('AssistantMarkdown', 'LI')).toBe('AssistantMarkdown · li')
    expect(formatPickLabel('', 'DIV')).toBe('div')
    expect(formatPickLabel('div', 'div')).toBe('div')
    expect(pickElementName({
      tag: 'li',
      reactName: 'AssistantMarkdown',
      id: 'row',
      className: 'item',
    })).toBe('AssistantMarkdown')
    expect(pickElementName({
      tag: 'button',
      name: 'continue',
      id: 'go',
    })).toBe('continue')
    expect(pickElementName({
      tag: 'h1',
      dataAttrs: { 'data-component': 'Hero', 'data-testid': 'title' },
      id: 'hero',
    })).toBe('Hero')
    expect(pickElementName({ tag: 'span', id: 'handle' })).toBe('handle')
    expect(pickElementName({ tag: 'p', className: 'lead muted' })).toBe('lead')
    expect(formatPickContext({
      label: 'AssistantMarkdown · li',
      selector: 'li.item',
      text: '  You can now inspect this row \n and leave a note.  ',
    })).toBe('AssistantMarkdown · li\nli.item\nYou can now inspect this row and leave a note.')
  })

  it('shrinks a pick mark into a thumbnail caption', () => {
    expect(shortPickCaption('AssistantMarkdown · li')).toBe('AssistantMarkdown · li')
    expect(shortPickCaption(
      'div#root, button.focus-ring, label.inline-flex @ 96,83 126x77',
      '圈选',
    )).toBe('圈选')
    expect(shortPickCaption('div#root, button.focus-ring, label.inline-flex, p.px-1 @ 96,83 126x77'))
      .toBe('div#root')
    expect(shortPickCaption('http://127.0.0.1:1420 @ 12,40')).toBe('http://127.0.0.1:1420')
  })

  it('maps a pill to a box corner without leaving the overlay', () => {
    expect(placePill({ x: 40, y: 80, w: 120, h: 24 }, { w: 400, h: 300 })).toEqual({
      x: 40,
      y: 62,
      flip: false,
    })
    expect(placePill({ x: 8, y: 4, w: 80, h: 20 }, { w: 400, h: 300 })).toEqual({
      x: 8,
      y: 24,
      flip: true,
    })
  })

  it('rewrites only loopback URLs onto the pick-proxy path', () => {
    expect(isLoopbackHttpUrl('http://127.0.0.1:1420/chat')).toBe(true)
    expect(isLoopbackHttpUrl('http://localhost:5173')).toBe(true)
    expect(isLoopbackHttpUrl('https://example.com')).toBe(false)
    expect(isLoopbackHttpUrl('https://127.0.0.1:1420')).toBe(false)
    expect(pickProxyPath('http://127.0.0.1:1420/chat?x=1')).toBe('/__dcs/up/127.0.0.1/1420/chat?x=1')
    expect(parsePickProxyPath('/__dcs/up/127.0.0.1/1420/chat')).toEqual({
      host: '127.0.0.1',
      port: 1420,
      path: '/chat',
    })
    expect(parsePickProxyPath('/__dcs/up/example.com/80/x')).toBeUndefined()
    expect(liveUrlFromFrameSrc('/__dcs/up/127.0.0.1/3082/')).toBe('http://127.0.0.1:3082/')
    expect(liveUrlFromFrameSrc('/__dcs/up/127.0.0.1/3082/probe?opened=1#ok')).toBe(
      'http://127.0.0.1:3082/probe?opened=1#ok',
    )
    expect(liveUrlFromFrameSrc('http://127.0.0.1:9/__dcs/up/127.0.0.1/43169/login')).toBe(
      'http://127.0.0.1:43169/login',
    )
    expect(liveUrlFromFrameSrc('https://example.com/x')).toBe('https://example.com/x')
    expect(resolveProxyUpstream({ pathname: '/@vite/client', referer: 'http://127.0.0.1:9/__dcs/up/127.0.0.1/1420/' }))
      .toEqual({ host: '127.0.0.1', port: 1420, path: '/@vite/client' })
    expect(resolveProxyUpstream({ pathname: '/src/App.tsx', cookie: 'dcs_up=localhost:5173' }))
      .toEqual({ host: 'localhost', port: 5173, path: '/src/App.tsx' })
    expect(injectPickScript('<html><head><title>App</title></head><body></body></html>')).toContain('data-dcs-pick')
    expect(injectPickScript('<html><head><title>App</title></head><body></body></html>')).toContain('/__dcs/pick.js')
    expect(injectPickScript('<html><head><script src="/__dcs/pick.js" data-dcs-pick></script></head></html>'))
      .not.toMatch(/data-dcs-pick[\s\S]*data-dcs-pick/)
  })
})
