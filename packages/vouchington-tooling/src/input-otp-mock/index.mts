import type { ComponentType, InputHTMLAttributes, ReactNode } from 'react'

type InputOtpProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'pattern'> & {
  children?: ReactNode
  onChange?: (value: string) => void
  containerClassName?: string
  pattern?: string | RegExp
}

const SLOT_COUNT = 8

/**
 * Factory for `vi.mock(import('input-otp'), inputOtpMockFactory)`. The real library schedules a
 * password-manager timeout that can fire after jsdom teardown ("window is not defined"); this
 * renders a plain text input that forwards `onChange(value)` instead.
 */
export async function inputOtpMockFactory() {
  const React = await import('react')
  const OTPInputContext = React.createContext({
    slots: Array.from({ length: SLOT_COUNT }, () => ({
      char: '',
      hasFakeCaret: false,
      isActive: false,
    })),
  })
  const OTPInput = React.forwardRef<HTMLInputElement, InputOtpProps>(function OTPInputMock(
    { children, maxLength, onChange, containerClassName, pattern, ...rest },
    ref,
  ) {
    const source = pattern instanceof RegExp ? pattern.source : pattern
    return React.createElement(
      'div',
      { 'data-input-otp': true, maxLength, className: containerClassName },
      React.createElement('input', {
        type: 'text',
        maxLength,
        ref,
        onChange: (event: { target: { value: string } }) => onChange?.(event.target.value),
        pattern: source,
        ...rest,
      }),
      children,
    )
  }) as ComponentType<InputOtpProps>
  OTPInput.displayName = 'OTPInput'
  return {
    OTPInput,
    OTPInputContext,
    REGEXP_ONLY_DIGITS: /^\d*$/,
    REGEXP_ONLY_DIGITS_AND_CHARS: /^[a-zA-Z0-9]*$/,
  }
}
