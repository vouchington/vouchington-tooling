import { createElement, useContext, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { inputOtpMockFactory } from './index.mts'

describe('inputOtpMockFactory', () => {
  it('exports the pattern constants', async () => {
    const mock = await inputOtpMockFactory()
    expect(mock.REGEXP_ONLY_DIGITS.test('123')).toBe(true)
    expect(mock.REGEXP_ONLY_DIGITS.test('a')).toBe(false)
    expect(mock.REGEXP_ONLY_DIGITS_AND_CHARS.test('aB1')).toBe(true)
    expect(mock.OTPInput.displayName).toBe('OTPInput')
  })

  it('renders a text input with a string pattern', async () => {
    const { OTPInput } = await inputOtpMockFactory()
    const html = renderToStaticMarkup(
      createElement(OTPInput, { maxLength: 6, pattern: '[0-9]*', containerClassName: 'wrap' }),
    )
    expect(html).toContain('data-input-otp="true"')
    expect(html).toContain('class="wrap"')
    expect(html).toContain('maxLength="6"')
    expect(html).toContain('pattern="[0-9]*"')
  })

  it('converts RegExp patterns, forwards props, renders children and calls onChange(value)', async () => {
    const { OTPInput } = await inputOtpMockFactory()
    const seen: string[] = []
    const render = (OTPInput as unknown as { render: (props: object, ref: null) => ReactElement })
      .render
    const tree = render({ onChange: (value: string) => seen.push(value) }, null)
    const input = (tree.props as { children: ReactElement<{ onChange: Function }>[] }).children[0]
    input?.props.onChange({ target: { value: '42' } })
    const unused = render({}, null)
    ;(
      unused.props as { children: ReactElement<{ onChange: Function }>[] }
    ).children[0]?.props.onChange({
      target: { value: 'x' },
    })
    const html = renderToStaticMarkup(
      createElement(OTPInput, { pattern: /^\d*$/, name: 'code', children: 'kids' }),
    )
    expect(html).toContain('pattern="^\\d*$"')
    expect(html).toContain('name="code"')
    expect(html).toContain('kids')
    expect(seen).toEqual(['42'])
  })

  it('provides eight empty slots through the context', async () => {
    const { OTPInputContext } = await inputOtpMockFactory()
    let slots = 0
    renderToStaticMarkup(
      createElement(() => {
        slots = useContext(OTPInputContext).slots.length
        return null
      }),
    )
    expect(slots).toBe(8)
  })
})
