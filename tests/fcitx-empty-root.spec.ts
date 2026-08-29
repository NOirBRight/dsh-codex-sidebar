import { describe, expect, it } from 'vitest'
import { FCITX_EMPTY_ROOT_SEED, isX11Launcher, stripFcitxSeed } from '../src/client/fcitx-empty-root.ts'

describe('fcitx empty-root bridge', () => {
  it('activates only for the explicit X11 launcher query', () => {
    expect(isX11Launcher({ search: '?dsh-launcher=x11' } as Location)).toBe(true)
    expect(isX11Launcher({ search: '' } as Location)).toBe(false)
    expect(isX11Launcher({ search: '?dsh-launcher=wayland' } as Location)).toBe(false)
  })
  it('removes only the leading private seed', () => {
    expect(stripFcitxSeed(FCITX_EMPTY_ROOT_SEED + '测试')).toBe('测试')
    expect(stripFcitxSeed('测试')).toBe('测试')
    expect(stripFcitxSeed('测' + FCITX_EMPTY_ROOT_SEED + '试')).toBe('测' + FCITX_EMPTY_ROOT_SEED + '试')
  })
})
